import { prisma } from './database.js';
import { aiService } from './ai/index.js';
import { SUPPORTED_LANGUAGES, type LessonType, type LessonDuration, type ProficiencyLevel, type LessonContent, type ExerciseData } from '../types/index.js';

/**
 * Lesson generation and management service
 */
export class LessonService {
  /**
   * Generate a new lesson using AI
   */
  async generateLesson(
    telegramId: bigint,
    options: {
      languagePair: string;
      lessonType: LessonType;
      duration: LessonDuration;
      proficiencyLevel: ProficiencyLevel;
      topic?: string;
    }
  ): Promise<{ lesson: Awaited<ReturnType<typeof prisma.lesson.create>>; content: LessonContent }> {
    const user = await prisma.user.findUnique({
      where: { telegramId },
    });

    if (!user) throw new Error('User not found');

    const [nativeLang, targetLang] = options.languagePair.split('-');
    const nativeName = SUPPORTED_LANGUAGES[nativeLang] || nativeLang;
    const targetName = SUPPORTED_LANGUAGES[targetLang] || targetLang;

    // Build the prompt based on lesson type and duration
    const prompt = this.buildLessonPrompt(
      nativeName,
      targetName,
      options.lessonType,
      options.duration,
      options.proficiencyLevel,
      options.topic
    );

    // Generate lesson content using AI
    const response = await aiService.generateWithFallback(
      telegramId,
      [
        {
          role: 'system',
          content: `You are an expert language teacher specializing in teaching ${targetName} to ${nativeName} speakers. 
You create engaging, educational content tailored to the student's level.
You MUST respond with valid JSON only - no markdown, no code blocks, no extra text.
Include phonetic pronunciations for ${targetName} words when helpful.`,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      { responseFormat: 'json' }
    );

    // Parse the AI response
    const content = this.parseAIResponse(response.content);
    const title = this.generateLessonTitle(options.lessonType, options.topic, content);
    const difficulty = this.getDifficultyFromLevel(options.proficiencyLevel);

    // Create the lesson in database
    const lesson = await prisma.lesson.create({
      data: {
        userId: user.id,
        languagePair: options.languagePair,
        lessonType: options.lessonType,
        title,
        content: content as object,
        difficulty,
        duration: options.duration,
        aiProvider: response.provider,
      },
    });

    // Generate exercises for the lesson
    const exercises = await this.generateExercises(
      telegramId,
      lesson.id,
      content,
      options
    );

    // Create exercises in database
    for (let i = 0; i < exercises.length; i++) {
      await prisma.exercise.create({
        data: {
          lessonId: lesson.id,
          type: exercises[i].type,
          question: exercises[i].question,
          options: exercises[i].options ?? undefined,
          correctAnswer: exercises[i].correctAnswer,
          explanation: exercises[i].explanation,
          hints: exercises[i].hints ?? undefined,
          order: i + 1,
        },
      });
    }

    return { lesson, content };
  }

  /**
   * Build the prompt for generating lesson content
   */
  private buildLessonPrompt(
    nativeLang: string,
    targetLang: string,
    lessonType: LessonType,
    duration: LessonDuration,
    level: ProficiencyLevel,
    topic?: string
  ): string {
    const durationConfig = {
      quick: { words: 5, sections: 1, examples: 2 },
      standard: { words: 10, sections: 2, examples: 3 },
      deep: { words: 20, sections: 4, examples: 5 },
    };

    const config = durationConfig[duration];
    const topicStr = topic ? ` about "${topic}"` : '';

    const baseInstructions = `Create a ${level} level ${lessonType} lesson for learning ${targetLang} from ${nativeLang}${topicStr}.`;

    const typeInstructions: Record<LessonType, string> = {
      vocabulary: `
Focus on teaching ${config.words} useful vocabulary words.
Group words by category (verbs, nouns, adjectives, etc.) into sections.
For EACH word, add it as an example with:
- "original": The word in ${targetLang} with usage example sentence
- "translation": Translation in ${nativeLang} (word + sentence translation)
- "pronunciation": Phonetic pronunciation
- "notes": Usage tips or memory hints`,

      grammar: `
Explain a grammar concept appropriate for ${level} learners.
Include:
- Clear explanation of the rule
- When and how to use it
- ${config.examples} example sentences showing the grammar in use
- Common mistakes to avoid
- Practice patterns`,

      conversation: `
Create a realistic conversation scenario.
Include:
- Setting and context description
- A dialogue between 2 people (${config.sections * 4} exchanges)
- Each line in ${targetLang} with ${nativeLang} translation
- Key phrases to learn
- Cultural notes about the conversation`,

      reading: `
Create a short reading passage appropriate for ${level} level.
Include:
- A ${duration === 'quick' ? '50' : duration === 'standard' ? '150' : '300'} word text in ${targetLang}
- Full translation in ${nativeLang}
- Vocabulary list with definitions
- Comprehension questions
- Grammar points highlighted in the text`,

      pronunciation: `
Create a pronunciation lesson focusing on sounds difficult for ${nativeLang} speakers.
Include:
- Target sounds or patterns
- Words demonstrating each sound
- Phonetic transcriptions
- Common mistakes
- Practice exercises (minimal pairs, tongue twisters)`,

      culture: `
Create an engaging cultural lesson about ${targetLang}-speaking regions.
Include:
- Cultural topic or custom explanation
- Relevant vocabulary with translations
- How this affects language use
- Interesting facts
- Phrases or expressions related to the topic`,
    };

    return `${baseInstructions}

${typeInstructions[lessonType]}

IMPORTANT: Respond with ONLY valid JSON, no markdown code blocks. Use this exact structure:
{
  "introduction": "Brief introduction in ${nativeLang}",
  "sections": [
    {
      "title": "Section title",
      "content": "Section description",
      "examples": [
        {
          "original": "Word or phrase in ${targetLang}: Example sentence using it",
          "translation": "Word translation: Sentence translation in ${nativeLang}",
          "pronunciation": "/phonetic/",
          "notes": "Usage tips"
        }
      ]
    }
  ],
  "summary": "Key takeaways",
  "tips": ["Tip 1", "Tip 2"]
}`;
  }

  /**
   * Parse AI response to lesson content
   */
  private parseAIResponse(response: string): LessonContent {
    try {
      // Try to extract JSON from the response (remove markdown code blocks if present)
      let cleanResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return this.normalizeContent(parsed);
      }
      throw new Error('No JSON found in response');
    } catch (error) {
      console.error('Failed to parse AI response:', error);
      // Fallback structure if parsing fails
      return {
        introduction: response.slice(0, 200),
        sections: [
          {
            title: 'Lesson Content',
            content: response,
          },
        ],
      };
    }
  }

  /**
   * Normalize AI response to match expected LessonContent structure
   */
  private normalizeContent(parsed: Record<string, unknown>): LessonContent {
    const sections = (parsed.sections as Record<string, unknown>[] || []).map(section => {
      const examples = (section.examples as Record<string, unknown>[] || []).map(ex => ({
        original: (ex.original || ex.english || ex.word || '') as string,
        translation: (ex.translation || ex.ukrainian || ex.meaning || '') as string,
        pronunciation: (ex.pronunciation || '') as string,
        notes: (ex.notes || ex.usagenotes || ex.usage_notes || '') as string,
      }));

      return {
        title: (section.title || '') as string,
        content: (section.content || section.description || '') as string,
        examples,
      };
    });

    return {
      introduction: (parsed.introduction || parsed.intro || '') as string,
      sections,
      summary: (parsed.summary || '') as string,
      tips: (parsed.tips || []) as string[],
    };
  }

  /**
   * Generate exercises for a lesson
   */
  private async generateExercises(
    telegramId: bigint,
    lessonId: string,
    content: LessonContent,
    options: {
      languagePair: string;
      lessonType: LessonType;
      duration: LessonDuration;
      proficiencyLevel: ProficiencyLevel;
    }
  ): Promise<ExerciseData[]> {
    const exerciseCount = {
      quick: 3,
      standard: 5,
      deep: 10,
    };

    const count = exerciseCount[options.duration];
    const [nativeLang, targetLang] = options.languagePair.split('-');
    const nativeName = SUPPORTED_LANGUAGES[nativeLang] || nativeLang;
    const targetName = SUPPORTED_LANGUAGES[targetLang] || targetLang;

    const prompt = `Based on this ${options.lessonType} lesson content, create ${count} interactive exercises to test understanding.

Lesson content:
${JSON.stringify(content)}

Create exercises appropriate for ${options.proficiencyLevel} learners.
Mix exercise types: multiple choice, fill in the blank, translation.

Respond with valid JSON array:
[
  {
    "type": "multiple_choice|fill_blank|translation",
    "question": "The question text",
    "options": ["A", "B", "C", "D"],  // only for multiple_choice
    "correctAnswer": "The correct answer",
    "explanation": "Why this is correct",
    "hints": ["Hint 1", "Hint 2"]
  }
]`;

    try {
      const response = await aiService.generateWithFallback(
        telegramId,
        [
          {
            role: 'system',
            content: `You are creating language learning exercises. 
Generate clear, unambiguous questions with definitive correct answers.
For multiple choice, always include exactly 4 options.
For fill_blank, use ___ to indicate where the answer goes.
For translation, ask to translate a ${nativeName} phrase to ${targetName} or vice versa.`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ]
      );

      // Parse exercises
      const jsonMatch = response.content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as ExerciseData[];
      }
    } catch (error) {
      console.error('Failed to generate exercises:', error);
    }

    // Fallback exercises
    return [
      {
        type: 'multiple_choice',
        question: 'What did you learn in this lesson?',
        options: ['Vocabulary', 'Grammar', 'Conversation', 'Everything!'],
        correctAnswer: 'Everything!',
        explanation: 'Great job completing this lesson!',
      },
    ];
  }

  /**
   * Generate a title for the lesson
   */
  private generateLessonTitle(
    lessonType: LessonType,
    topic: string | undefined,
    content: LessonContent
  ): string {
    if (topic) {
      return `${lessonType.charAt(0).toUpperCase() + lessonType.slice(1)}: ${topic}`;
    }

    // Try to extract a title from the content
    if (content.sections?.[0]?.title) {
      return content.sections[0].title;
    }

    const typeNames: Record<LessonType, string> = {
      vocabulary: 'Vocabulary Building',
      grammar: 'Grammar Practice',
      conversation: 'Conversation Skills',
      reading: 'Reading Comprehension',
      pronunciation: 'Pronunciation Practice',
      culture: 'Cultural Insights',
    };

    return typeNames[lessonType] || 'Language Lesson';
  }

  /**
   * Convert proficiency level to difficulty number
   */
  private getDifficultyFromLevel(level: ProficiencyLevel): number {
    const mapping: Record<ProficiencyLevel, number> = {
      beginner: 1,
      intermediate: 3,
      advanced: 5,
    };
    return mapping[level];
  }

  /**
   * Get a lesson by ID with exercises
   */
  async getLesson(lessonId: string) {
    return prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        exercises: {
          orderBy: { order: 'asc' },
        },
      },
    });
  }

  /**
   * Get user's recent lessons
   */
  async getRecentLessons(telegramId: bigint, limit = 10) {
    const user = await prisma.user.findUnique({
      where: { telegramId },
    });

    if (!user) return [];

    return prisma.lesson.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Get incomplete lessons
   */
  async getIncompleteLessons(telegramId: bigint) {
    const user = await prisma.user.findUnique({
      where: { telegramId },
    });

    if (!user) return [];

    return prisma.lesson.findMany({
      where: {
        userId: user.id,
        completed: false,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Complete a lesson
   */
  async completeLesson(lessonId: string, score: number): Promise<void> {
    await prisma.lesson.update({
      where: { id: lessonId },
      data: {
        completed: true,
        completedAt: new Date(),
        score,
      },
    });
  }

  /**
   * Submit an exercise answer
   */
  async submitAnswer(
    exerciseId: string,
    userAnswer: string
  ): Promise<{ isCorrect: boolean; explanation?: string; correctAnswer: string }> {
    const exercise = await prisma.exercise.findUnique({
      where: { id: exerciseId },
    });

    if (!exercise) {
      throw new Error('Exercise not found');
    }

    // Normalize answers for comparison
    const normalize = (str: string) => str.toLowerCase().trim();
    const isCorrect = normalize(userAnswer) === normalize(exercise.correctAnswer);

    await prisma.exercise.update({
      where: { id: exerciseId },
      data: {
        userAnswer,
        isCorrect,
        answeredAt: new Date(),
      },
    });

    return {
      isCorrect,
      explanation: exercise.explanation || undefined,
      correctAnswer: exercise.correctAnswer,
    };
  }
}

export const lessonService = new LessonService();
