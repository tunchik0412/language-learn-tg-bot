import { Markup } from 'telegraf';
import { bot, BotContext } from './index.js';
import { lessonService } from '../services/lesson.js';
import { userService } from '../services/user.js';
import { progressService } from '../services/progress.js';
import { vocabularyService } from '../services/vocabulary.js';
import { SUPPORTED_LANGUAGES, type LessonType, type LessonDuration } from '../types/index.js';

/**
 * Escape Markdown special characters for Telegram
 */
function escapeMarkdown(text: string): string {
  // Escape underscores that are used as blanks (e.g., ___ becomes \_\_\_)
  return text.replace(/_{2,}/g, match => match.split('').map(() => '\\_').join(''));
}

/**
 * Strip Markdown formatting for fallback plain text
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*([^*]+)\*/g, '$1')  // *bold*
    .replace(/_([^_]+)_/g, '$1')      // _italic_
    .replace(/\\_/g, '_')             // escaped underscores
    .replace(/`([^`]+)`/g, '$1');     // `code`
}

/**
 * Safely send a message with Markdown, falling back to plain text if parsing fails
 */
async function safeSendMarkdown(
  ctx: BotContext,
  text: string,
  extra?: Parameters<BotContext['reply']>[1]
) {
  try {
    return await ctx.reply(text, { ...extra, parse_mode: 'Markdown' });
  } catch (error) {
    if (error instanceof Error && error.message.includes("can't parse entities")) {
      console.warn('Markdown parsing failed, falling back to plain text');
      const plainText = stripMarkdown(text);
      return await ctx.reply(plainText, { ...extra, parse_mode: undefined });
    }
    throw error;
  }
}

/**
 * Safely edit a message with Markdown, falling back to plain text if parsing fails
 */
async function safeEditMessage(
  ctx: BotContext,
  text: string,
  extra?: Parameters<BotContext['editMessageText']>[1]
) {
  try {
    return await ctx.editMessageText(text, { ...extra, parse_mode: 'Markdown' });
  } catch (error) {
    if (error instanceof Error && error.message.includes("can't parse entities")) {
      console.warn('Markdown parsing failed, falling back to plain text');
      const plainText = stripMarkdown(text);
      return await ctx.editMessageText(plainText, { ...extra, parse_mode: undefined });
    }
    throw error;
  }
}

/**
 * Safely try to delete a message (won't throw if it fails)
 */
async function tryDeleteMessage(ctx: BotContext, messageId?: number): Promise<void> {
  try {
    if (messageId) {
      await ctx.telegram.deleteMessage(ctx.chat!.id, messageId);
    } else if (ctx.message) {
      await ctx.deleteMessage();
    }
  } catch {
    // Silently fail - message may already be deleted or bot lacks permission
  }
}

/**
 * /lesson command - Start a new lesson
 */
bot.command('lesson', async (ctx: BotContext) => {
  await tryDeleteMessage(ctx);
  const telegramId = BigInt(ctx.from!.id);
  const languages = await userService.getActiveLanguages(telegramId);

  if (languages.length === 0) {
    await ctx.reply(
      'Please set up a language first using /setlanguage'
    );
    return;
  }

  // If only one language, skip selection
  if (languages.length === 1) {
    const lang = languages[0];
    ctx.session.tempData = {
      languagePair: `${lang.nativeLanguage}-${lang.targetLanguage}`,
      proficiencyLevel: lang.proficiencyLevel,
    };
    await showLessonTypeSelection(ctx);
    return;
  }

  // Multiple languages - let user choose
  const buttons = languages.map(l => {
    const target = SUPPORTED_LANGUAGES[l.targetLanguage] || l.targetLanguage;
    return [Markup.button.callback(
      target,
      `lesson_lang_${l.nativeLanguage}-${l.targetLanguage}_${l.proficiencyLevel}`
    )];
  });

  await ctx.reply(
    '📚 Which language would you like to practice?',
    Markup.inlineKeyboard(buttons)
  );
});

// Language selection for lesson
bot.action(/^lesson_lang_(.+)_(.+)$/, async (ctx) => {
  const languagePair = ctx.match[1];
  const proficiencyLevel = ctx.match[2];
  
  ctx.session.tempData = { languagePair, proficiencyLevel };
  await showLessonTypeSelection(ctx);
});

async function showLessonTypeSelection(ctx: BotContext) {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📖 Vocabulary', 'lesson_type_vocabulary')],
    [Markup.button.callback('📝 Grammar', 'lesson_type_grammar')],
    [Markup.button.callback('💬 Conversation', 'lesson_type_conversation')],
    [Markup.button.callback('📚 Reading', 'lesson_type_reading')],
    [Markup.button.callback('🗣️ Pronunciation', 'lesson_type_pronunciation')],
    [Markup.button.callback('🌍 Culture', 'lesson_type_culture')],
  ]);

  if (ctx.callbackQuery) {
    await ctx.editMessageText('📚 What type of lesson would you like?', keyboard);
  } else {
    await ctx.reply('📚 What type of lesson would you like?', keyboard);
  }
}

// Lesson type selection
bot.action(/^lesson_type_(.+)$/, async (ctx) => {
  const lessonType = ctx.match[1] as LessonType;
  ctx.session.tempData = { ...ctx.session.tempData, lessonType };

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('⚡ Quick (5 min)', 'lesson_duration_quick')],
    [Markup.button.callback('📖 Standard (15 min)', 'lesson_duration_standard')],
    [Markup.button.callback('🎓 Deep Dive (30 min)', 'lesson_duration_deep')],
  ]);

  await ctx.editMessageText('⏱️ How much time do you have?', keyboard);
});

// Duration selection and lesson generation
bot.action(/^lesson_duration_(.+)$/, async (ctx) => {
  const duration = ctx.match[1] as LessonDuration;
  const { languagePair, proficiencyLevel, lessonType } = ctx.session.tempData as {
    languagePair: string;
    proficiencyLevel: string;
    lessonType: LessonType;
  };

  // Store message ID to delete later
  const loadingMsg = ctx.callbackQuery?.message?.message_id;
  await ctx.editMessageText('🔄 Generating your personalized lesson...');

  try {
    const { lesson, content } = await lessonService.generateLesson(
      BigInt(ctx.from!.id),
      {
        languagePair,
        lessonType,
        duration,
        proficiencyLevel: proficiencyLevel as 'beginner' | 'intermediate' | 'advanced',
      }
    );

    // Delete the "Generating..." message
    if (loadingMsg) {
      await tryDeleteMessage(ctx, loadingMsg);
    }

    ctx.session.currentLesson = lesson.id;
    ctx.session.currentExercise = 0;

    // Format and send lesson content
    let message = `📚 *${lesson.title}*\n\n`;
    message += `${content.introduction}\n\n`;

    for (const section of content.sections || []) {
      message += `*${section.title}*\n`;
      message += `${section.content}\n\n`;

      if (section.examples && section.examples.length > 0) {
        for (const example of section.examples) {
          message += `• ${example.original}\n`;
          message += `  _${example.translation}_\n`;
          if (example.pronunciation) {
            message += `  🔊 ${example.pronunciation}\n`;
          }
          if (example.notes) {
            message += `  💡 ${example.notes}\n`;
          }
          message += '\n';
        }
      }
    }

    if (content.summary) {
      message += `📝 *Summary:* ${content.summary}\n\n`;
    }

    if (content.tips && content.tips.length > 0) {
      message += `💡 *Tips:*\n`;
      content.tips.forEach(tip => {
        message += `• ${tip}\n`;
      });
    }

    // Send in chunks if too long
    const maxLength = 4000;
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📝 Start Exercises', `start_exercises_${lesson.id}`)],
      [Markup.button.callback('📖 Another Lesson', 'lesson_again')],
    ]);

    if (message.length > maxLength) {
      const parts = splitMessage(message, maxLength);
      for (let i = 0; i < parts.length - 1; i++) {
        await safeSendMarkdown(ctx, parts[i]);
      }
      await safeSendMarkdown(ctx, parts[parts.length - 1], keyboard);
    } else {
      await safeSendMarkdown(ctx, message, keyboard);
    }
  } catch (error) {
    console.error('Lesson generation error:', error);
    await ctx.reply(
      '❌ Failed to generate lesson. Please check your AI provider settings with /settings and try again.'
    );
  }

  ctx.session.tempData = undefined;
});

// Split long messages
function splitMessage(text: string, maxLength: number): string[] {
  const parts: string[] = [];
  let current = '';

  const lines = text.split('\n');
  for (const line of lines) {
    if ((current + line + '\n').length > maxLength) {
      if (current) parts.push(current.trim());
      current = line + '\n';
    } else {
      current += line + '\n';
    }
  }
  if (current) parts.push(current.trim());

  return parts;
}

// Start exercises
bot.action(/^start_exercises_(.+)$/, async (ctx) => {
  const lessonId = ctx.match[1];
  ctx.session.currentLesson = lessonId;
  ctx.session.currentExercise = 0;

  // Answer the callback but keep the lesson content visible
  await ctx.answerCbQuery('Starting exercises...');
  
  // Send exercise as a NEW message (don't edit lesson content)
  await sendNextExercise(ctx, lessonId, 0, true);
});

// Send exercise to user
async function sendNextExercise(ctx: BotContext, lessonId: string, index: number, isNewMessage = false) {
  const lesson = await lessonService.getLesson(lessonId);
  if (!lesson || !lesson.exercises[index]) {
    // No more exercises - complete the lesson
    await completeCurrentLesson(ctx, lessonId);
    return;
  }

  const exercise = lesson.exercises[index];
  const total = lesson.exercises.length;

  // Escape underscores in exercise question (blanks like ___ break Markdown)
  const escapedQuestion = escapeMarkdown(exercise.question);
  let message = `📝 *Exercise ${index + 1}/${total}*\n\n`;
  message += escapedQuestion;

  if (exercise.type === 'multiple_choice' && exercise.options) {
    const options = exercise.options as string[];
    // Store options in session for later retrieval (callback data has 64 byte limit)
    ctx.session.tempData = { ...ctx.session.tempData, exerciseOptions: options, exerciseId: exercise.id };
    
    const buttons = options.map((opt, i) => {
      // Truncate display text if too long, use index in callback
      const displayText = opt.length > 30 ? opt.slice(0, 27) + '...' : opt;
      return [
        Markup.button.callback(
          `${String.fromCharCode(65 + i)}. ${displayText}`,
          `ans_${exercise.id}_${i}`
        ),
      ];
    });
    buttons.push([Markup.button.callback('💡 Hint', `hint_${exercise.id}`)]);

    if (isNewMessage) {
      await safeSendMarkdown(ctx, message, Markup.inlineKeyboard(buttons));
    } else {
      await safeEditMessage(ctx, message, Markup.inlineKeyboard(buttons));
    }
  } else if (exercise.type === 'fill_blank' || exercise.type === 'translation') {
    ctx.session.awaitingInput = 'answer';
    ctx.session.tempData = { exerciseId: exercise.id, lessonId, exerciseIndex: index };

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('💡 Hint', `hint_${exercise.id}`)],
      [Markup.button.callback('⏭️ Skip', `skip_${exercise.id}`)],
    ]);

    if (isNewMessage) {
      await safeSendMarkdown(ctx, message + '\n\n_Type your answer:_', keyboard);
    } else {
      await safeEditMessage(ctx, message + '\n\n_Type your answer:_', keyboard);
    }
  }
}

// Handle multiple choice answer (using option index)
bot.action(/^ans_([^_]+)_(\d+)$/, async (ctx) => {
  const exerciseId = ctx.match[1];
  const optionIndex = parseInt(ctx.match[2], 10);
  
  // Get the actual answer from stored options
  const options = ctx.session.tempData?.exerciseOptions as string[] | undefined;
  const userAnswer = options?.[optionIndex] || '';

  await processAnswer(ctx, exerciseId, userAnswer);
});

// Handle text answer for fill_blank and translation
bot.on('text', async (ctx, next) => {
  if (ctx.session.awaitingInput === 'answer' && ctx.session.tempData?.exerciseId) {
    const exerciseId = ctx.session.tempData.exerciseId as string;
    const userAnswer = ctx.message.text.trim();

    // Delete the user's answer message to keep chat clean
    await tryDeleteMessage(ctx);

    ctx.session.awaitingInput = undefined;
    await processAnswer(ctx, exerciseId, userAnswer);
    return;
  }

  return next();
});

// Process any answer
async function processAnswer(ctx: BotContext, exerciseId: string, userAnswer: string) {
  const result = await lessonService.submitAnswer(exerciseId, userAnswer);
  const lessonId = ctx.session.currentLesson!;
  const currentIndex = ctx.session.currentExercise || 0;

  // Escape dynamic content that could break Markdown
  const correctAnswerEscaped = escapeMarkdown(result.correctAnswer || '');
  let message = result.isCorrect 
    ? '✅ *Correct!*\n\n'
    : `❌ *Incorrect*\n\nThe correct answer was: *${correctAnswerEscaped}*\n\n`;

  if (result.explanation) {
    message += `💡 ${escapeMarkdown(result.explanation)}\n`;
  }

  ctx.session.currentExercise = currentIndex + 1;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('➡️ Next Exercise', `next_exercise_${lessonId}_${currentIndex + 1}`)],
  ]);

  if (ctx.callbackQuery) {
    await safeEditMessage(ctx, message, keyboard);
  } else {
    await safeSendMarkdown(ctx, message, keyboard);
  }
}

// Next exercise
bot.action(/^next_exercise_(.+)_(\d+)$/, async (ctx) => {
  const lessonId = ctx.match[1];
  const index = parseInt(ctx.match[2]);

  await sendNextExercise(ctx, lessonId, index);
});

// Show hint
bot.action(/^hint_(.+)$/, async (ctx) => {
  const exerciseId = ctx.match[1];
  const exercise = await lessonService.getLesson(ctx.session.currentLesson!);
  const ex = exercise?.exercises.find(e => e.id === exerciseId);

  if (ex?.hints) {
    const hints = ex.hints as string[];
    await ctx.answerCbQuery(`💡 Hint: ${hints[0]}`, { show_alert: true });
  } else {
    await ctx.answerCbQuery('No hints available for this exercise.', { show_alert: true });
  }
});

// Skip exercise
bot.action(/^skip_(.+)$/, async (ctx) => {
  const lessonId = ctx.session.currentLesson!;
  const currentIndex = (ctx.session.currentExercise || 0) + 1;
  ctx.session.currentExercise = currentIndex;

  await sendNextExercise(ctx, lessonId, currentIndex);
});

// Complete lesson
async function completeCurrentLesson(ctx: BotContext, lessonId: string) {
  const lesson = await lessonService.getLesson(lessonId);
  if (!lesson) return;

  // Calculate score
  const exercises = lesson.exercises;
  const totalExercises = exercises.length;
  const correctExercises = exercises.filter(e => e.isCorrect === true).length;
  const score = totalExercises > 0 
    ? Math.round((correctExercises / totalExercises) * 100)
    : 100;

  // Complete the lesson
  await lessonService.completeLesson(lessonId, score);

  // Update progress
  await progressService.updateLessonProgress(
    BigInt(ctx.from!.id),
    lesson.languagePair,
    {
      score,
      wordsLearned: 5, // Estimate based on lesson type
      timeSpent: 10, // Estimate in minutes
      correctExercises,
      totalExercises,
    }
  );

  const message = `
🎉 *Lesson Complete!*

📊 *Score:* ${score}%
✅ *Correct:* ${correctExercises}/${totalExercises}

Keep up the great work! 💪
  `;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📚 Another Lesson', 'lesson_again')],
    [Markup.button.callback('📊 View Progress', 'view_progress')],
  ]);

  if (ctx.callbackQuery) {
    await safeEditMessage(ctx, message, keyboard);
  } else {
    await safeSendMarkdown(ctx, message, keyboard);
  }

  ctx.session.currentLesson = undefined;
  ctx.session.currentExercise = undefined;
}

// Another lesson
bot.action('lesson_again', async (ctx) => {
  const telegramId = BigInt(ctx.from!.id);
  const languages = await userService.getActiveLanguages(telegramId);

  if (languages.length === 1) {
    const lang = languages[0];
    ctx.session.tempData = {
      languagePair: `${lang.nativeLanguage}-${lang.targetLanguage}`,
      proficiencyLevel: lang.proficiencyLevel,
    };
    await showLessonTypeSelection(ctx);
  } else {
    // Show language selection again - redirect to lesson command behavior
    const buttons = languages.map(l => {
      const target = SUPPORTED_LANGUAGES[l.targetLanguage] || l.targetLanguage;
      return [Markup.button.callback(
        target,
        `lesson_lang_${l.nativeLanguage}-${l.targetLanguage}_${l.proficiencyLevel}`
      )];
    });

    await ctx.editMessageText(
      '📚 Which language would you like to practice?',
      Markup.inlineKeyboard(buttons)
    );
  }
});

// View progress from lesson complete
bot.action('view_progress', async (ctx) => {
  const telegramId = BigInt(ctx.from!.id);
  const stats = await progressService.getUserStats(telegramId);
  
  if (!stats) {
    await ctx.editMessageText('No progress yet!');
    return;
  }

  const progressMessage = `
📊 *Your Learning Progress*

🔥 *Streak:* ${stats.currentStreak} days (Best: ${stats.longestStreak})
📚 *Lessons Completed:* ${stats.totalLessons}
📝 *Words Learned:* ${stats.totalWords}
⏱️ *Total Time:* ${Math.floor(stats.totalTime / 60)}h ${stats.totalTime % 60}m
🎯 *Accuracy:* ${stats.accuracy}%
⭐ *Level:* ${stats.level}
✨ *XP:* ${stats.xp}
  `;

  await ctx.editMessageText(progressMessage, { parse_mode: 'Markdown' });
});

/**
 * Quick lesson type commands
 */
bot.command('vocabulary', async (ctx: BotContext) => {
  await tryDeleteMessage(ctx);
  await startQuickLesson(ctx, 'vocabulary');
});

bot.command('grammar', async (ctx: BotContext) => {
  await tryDeleteMessage(ctx);
  await startQuickLesson(ctx, 'grammar');
});

bot.command('conversation', async (ctx: BotContext) => {
  await tryDeleteMessage(ctx);
  await startQuickLesson(ctx, 'conversation');
});

bot.command('reading', async (ctx: BotContext) => {
  await tryDeleteMessage(ctx);
  await startQuickLesson(ctx, 'reading');
});

async function startQuickLesson(ctx: BotContext, lessonType: LessonType) {
  const telegramId = BigInt(ctx.from!.id);
  const languages = await userService.getActiveLanguages(telegramId);

  if (languages.length === 0) {
    await ctx.reply('Please set up a language first using /setlanguage');
    return;
  }

  const lang = languages[0]; // Use first active language
  ctx.session.tempData = {
    languagePair: `${lang.nativeLanguage}-${lang.targetLanguage}`,
    proficiencyLevel: lang.proficiencyLevel,
    lessonType,
  };

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('⚡ Quick (5 min)', 'lesson_duration_quick')],
    [Markup.button.callback('📖 Standard (15 min)', 'lesson_duration_standard')],
    [Markup.button.callback('🎓 Deep Dive (30 min)', 'lesson_duration_deep')],
  ]);

  await ctx.reply(`⏱️ ${lessonType.charAt(0).toUpperCase() + lessonType.slice(1)} lesson - How much time do you have?`, keyboard);
}

/**
 * /review command - Review vocabulary
 */
bot.command('review', async (ctx: BotContext) => {
  await tryDeleteMessage(ctx);
  const telegramId = BigInt(ctx.from!.id);
  const dueWords = await vocabularyService.getDueForReview(telegramId);

  if (dueWords.length === 0) {
    await ctx.reply(
      '✨ No words due for review right now! Complete more lessons to build your vocabulary.'
    );
    return;
  }

  ctx.session.tempData = { reviewWords: dueWords, currentReviewIndex: 0 };
  await sendReviewCard(ctx, dueWords[0]);
});

async function sendReviewCard(ctx: BotContext, word: Awaited<ReturnType<typeof vocabularyService.getDueForReview>>[0]) {
  const message = `
📖 *Vocabulary Review*

*${word.word}*
${word.pronunciation ? `🔊 ${word.pronunciation}` : ''}

What does this word mean?
  `;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('👁️ Show Answer', `review_show_${word.id}`)],
    [Markup.button.callback('⏭️ Skip', `review_skip`)],
  ]);

  if (ctx.callbackQuery) {
    await ctx.editMessageText(message, { parse_mode: 'Markdown', ...keyboard });
  } else {
    await ctx.reply(message, { parse_mode: 'Markdown', ...keyboard });
  }
}

bot.action(/^review_show_(.+)$/, async (ctx) => {
  const wordId = ctx.match[1];
  const reviewWords = ctx.session.tempData?.reviewWords as Awaited<ReturnType<typeof vocabularyService.getDueForReview>>;
  const word = reviewWords?.find(w => w.id === wordId);

  if (!word) return;

  const message = `
📖 *${word.word}*
${word.pronunciation ? `🔊 ${word.pronunciation}` : ''}

✅ *Translation:* ${word.translation}
${word.exampleSentence ? `📝 *Example:* ${word.exampleSentence}` : ''}
${word.exampleTranslation ? `_${word.exampleTranslation}_` : ''}

How well did you know this?
  `;

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('😕 Hard', `review_rate_${wordId}_1`),
      Markup.button.callback('🤔 Medium', `review_rate_${wordId}_3`),
      Markup.button.callback('😊 Easy', `review_rate_${wordId}_5`),
    ],
  ]);

  await ctx.editMessageText(message, { parse_mode: 'Markdown', ...keyboard });
});

bot.action(/^review_rate_(.+)_(\d)$/, async (ctx) => {
  const wordId = ctx.match[1];
  const quality = parseInt(ctx.match[2]);

  await vocabularyService.updateReview(wordId, quality);

  const reviewWords = ctx.session.tempData?.reviewWords as Awaited<ReturnType<typeof vocabularyService.getDueForReview>>;
  const currentIndex = (ctx.session.tempData?.currentReviewIndex as number) + 1;

  if (currentIndex >= reviewWords.length) {
    await ctx.editMessageText(
      '🎉 *Review Complete!*\n\nGreat job reviewing your vocabulary!',
      { parse_mode: 'Markdown' }
    );
    ctx.session.tempData = undefined;
    return;
  }

  ctx.session.tempData = { ...ctx.session.tempData, currentReviewIndex: currentIndex };
  await sendReviewCard(ctx, reviewWords[currentIndex]);
});

bot.action('review_skip', async (ctx) => {
  const reviewWords = ctx.session.tempData?.reviewWords as Awaited<ReturnType<typeof vocabularyService.getDueForReview>>;
  const currentIndex = (ctx.session.tempData?.currentReviewIndex as number) + 1;

  if (currentIndex >= reviewWords.length) {
    await ctx.editMessageText('Review session ended.');
    ctx.session.tempData = undefined;
    return;
  }

  ctx.session.tempData = { ...ctx.session.tempData, currentReviewIndex: currentIndex };
  await sendReviewCard(ctx, reviewWords[currentIndex]);
});

export { bot };
