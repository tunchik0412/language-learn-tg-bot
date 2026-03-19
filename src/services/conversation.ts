import { prisma } from './database.js';
import { aiService } from './ai/index.js';
import { SUPPORTED_LANGUAGES, type ConversationScenario } from '../types/index.js';
import type { Prisma } from '@prisma/client';

// JSON-compatible message type for database storage
interface StoredMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  translation?: string;
  timestamp?: string; // ISO string
}

/**
 * Conversation practice service
 */
export class ConversationService {
  /**
   * Available conversation scenarios
   */
  private scenarios: ConversationScenario[] = [
    { id: 'restaurant', name: 'At a Restaurant', description: 'Order food and interact with staff', difficulty: 1, context: 'You are at a restaurant and want to order a meal.' },
    { id: 'shopping', name: 'Shopping', description: 'Buy items at a store', difficulty: 1, context: 'You are at a clothing store looking for a new shirt.' },
    { id: 'directions', name: 'Asking for Directions', description: 'Navigate around town', difficulty: 2, context: 'You are lost and need to find the train station.' },
    { id: 'hotel', name: 'Hotel Check-in', description: 'Check into a hotel', difficulty: 2, context: 'You are checking into a hotel for a 3-night stay.' },
    { id: 'doctor', name: 'Doctor Visit', description: 'Describe symptoms to a doctor', difficulty: 3, context: 'You are at the doctor with a headache and fever.' },
    { id: 'job_interview', name: 'Job Interview', description: 'Practice for a job interview', difficulty: 4, context: 'You are interviewing for a position at a tech company.' },
    { id: 'making_friends', name: 'Making Friends', description: 'Casual conversation with new people', difficulty: 2, context: 'You meet someone new at a party and want to get to know them.' },
    { id: 'phone_call', name: 'Phone Call', description: 'Handle a phone conversation', difficulty: 3, context: 'You need to call customer service about a problem with your order.' },
    { id: 'apartment', name: 'Renting an Apartment', description: 'Inquire about renting', difficulty: 3, context: 'You are looking at an apartment to rent and have questions.' },
    { id: 'emergency', name: 'Emergency Situation', description: 'Handle emergency situations', difficulty: 4, context: 'You need to report an emergency to the police.' },
  ];

  /**
   * Get available scenarios
   */
  getScenarios(difficulty?: number): ConversationScenario[] {
    if (difficulty) {
      return this.scenarios.filter(s => s.difficulty === difficulty);
    }
    return this.scenarios;
  }

  /**
   * Start a new conversation
   */
  async startConversation(
    telegramId: bigint,
    scenarioId: string,
    languagePair: string
  ): Promise<{
    conversationId: string;
    scenario: ConversationScenario;
    firstMessage: StoredMessage;
  }> {
    const user = await prisma.user.findUnique({
      where: { telegramId },
    });

    if (!user) throw new Error('User not found');

    const scenario = this.scenarios.find(s => s.id === scenarioId);
    if (!scenario) throw new Error('Scenario not found');

    const [nativeLang, targetLang] = languagePair.split('-');
    const nativeName = SUPPORTED_LANGUAGES[nativeLang] || nativeLang;
    const targetName = SUPPORTED_LANGUAGES[targetLang] || targetLang;

    // Generate initial AI message
    const systemPrompt = `You are a native ${targetName} speaker helping a ${nativeName} speaker practice conversation.

Scenario: ${scenario.name}
Context: ${scenario.context}

Instructions:
1. Speak ONLY in ${targetName}
2. Keep responses conversational and realistic (2-4 sentences max)
3. Match the difficulty level (${scenario.difficulty}/5)
4. After each response, provide a JSON translation in this format:
{"translation": "English translation here"}

Start the conversation naturally as someone the learner would interact with in this scenario.`;

    const response = await aiService.generateWithFallback(
      telegramId,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Start the conversation. Remember to include the translation JSON after your message.' },
      ]
    );

    const { message, translation } = this.parseAIMessage(response.content);

    const firstMessage: StoredMessage = {
      role: 'assistant',
      content: message,
      translation,
      timestamp: new Date().toISOString(),
    };

    // Create conversation in database
    const conversation = await prisma.conversation.create({
      data: {
        userId: user.id,
        languagePair,
        scenario: scenarioId,
        messages: [firstMessage] as unknown as Prisma.InputJsonValue,
        isActive: true,
      },
    });

    return {
      conversationId: conversation.id,
      scenario,
      firstMessage,
    };
  }

  /**
   * Continue a conversation
   */
  async continueConversation(
    telegramId: bigint,
    conversationId: string,
    userMessage: string
  ): Promise<{
    aiResponse: StoredMessage;
    feedback?: string;
  }> {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { user: true },
    });

    if (!conversation) throw new Error('Conversation not found');
    if (conversation.user.telegramId !== telegramId) throw new Error('Not authorized');

    const [nativeLang, targetLang] = conversation.languagePair.split('-');
    const nativeName = SUPPORTED_LANGUAGES[nativeLang] || nativeLang;
    const targetName = SUPPORTED_LANGUAGES[targetLang] || targetLang;

    const scenario = this.scenarios.find(s => s.id === conversation.scenario);
    const messages = conversation.messages as unknown as StoredMessage[];

    // Add user's message
    const userMsg: StoredMessage = {
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString(),
    };

    // Build chat history for AI
    const systemPrompt = `You are a native ${targetName} speaker in a conversation practice session.
Scenario: ${scenario?.name || 'General conversation'}
Context: ${scenario?.context || 'A casual conversation'}

Continue the conversation naturally. 
- Respond ONLY in ${targetName}
- Keep responses conversational (2-4 sentences)
- If the user makes grammar/vocabulary mistakes, gently correct them
- After your response, provide JSON: {"translation": "...", "feedback": "..." (optional feedback on user's message)}`;

    const chatMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user' as const, content: userMessage },
    ];

    const response = await aiService.generateWithFallback(
      telegramId,
      chatMessages
    );

    const { message, translation, feedback } = this.parseAIMessage(response.content);

    const aiResponse: StoredMessage = {
      role: 'assistant',
      content: message,
      translation,
      timestamp: new Date().toISOString(),
    };

    // Update conversation
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        messages: [...messages, userMsg, aiResponse] as unknown as Prisma.InputJsonValue,
      },
    });

    return { aiResponse, feedback };
  }

  /**
   * End a conversation and get summary
   */
  async endConversation(
    telegramId: bigint,
    conversationId: string
  ): Promise<{
    summary: string;
    wordsLearned: string[];
    suggestions: string[];
  }> {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { user: true },
    });

    if (!conversation) throw new Error('Conversation not found');

    const messages = conversation.messages as unknown as StoredMessage[];
    const [, targetLang] = conversation.languagePair.split('-');
    const targetName = SUPPORTED_LANGUAGES[targetLang] || targetLang;

    // Generate summary
    const summaryPrompt = `Analyze this ${targetName} conversation practice and provide:
1. A brief summary of how the learner did
2. 5-10 useful words/phrases they should remember
3. 2-3 specific suggestions for improvement

Conversation:
${messages.map(m => `${m.role}: ${m.content}`).join('\n')}

Respond in JSON format:
{
  "summary": "...",
  "wordsLearned": ["word1 - translation", "word2 - translation", ...],
  "suggestions": ["suggestion1", "suggestion2", ...]
}`;

    const response = await aiService.generateWithFallback(
      telegramId,
      [{ role: 'user', content: summaryPrompt }]
    );

    // Mark conversation as inactive
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { isActive: false },
    });

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          summary: parsed.summary || 'Great practice session!',
          wordsLearned: parsed.wordsLearned || [],
          suggestions: parsed.suggestions || [],
        };
      }
    } catch {
      // Parsing failed
    }

    return {
      summary: 'Great conversation practice! Keep it up.',
      wordsLearned: [],
      suggestions: ['Continue practicing daily', 'Try more challenging scenarios'],
    };
  }

  /**
   * Get user's active conversation
   */
  async getActiveConversation(telegramId: bigint) {
    const user = await prisma.user.findUnique({
      where: { telegramId },
    });

    if (!user) return null;

    return prisma.conversation.findFirst({
      where: {
        userId: user.id,
        isActive: true,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });
  }

  /**
   * Parse AI message to extract translation and feedback
   */
  private parseAIMessage(content: string): {
    message: string;
    translation?: string;
    feedback?: string;
  } {
    // Try to find JSON at the end
    const jsonMatch = content.match(/\{[\s\S]*\}$/);
    
    if (jsonMatch) {
      const messageText = content.slice(0, jsonMatch.index).trim();
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          message: messageText,
          translation: parsed.translation,
          feedback: parsed.feedback,
        };
      } catch {
        return { message: content };
      }
    }

    return { message: content };
  }
}

export const conversationService = new ConversationService();
