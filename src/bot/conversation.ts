import { Markup } from 'telegraf';
import { bot, BotContext } from './index.js';
import { conversationService } from '../services/conversation.js';
import { userService } from '../services/user.js';
import { SUPPORTED_LANGUAGES } from '../types/index.js';

/**
 * Enhanced conversation practice handlers
 */

// Start conversation practice from /conversation command
bot.action(/^start_conversation_(.+)$/, async (ctx) => {
  const scenarioId = ctx.match[1];
  const telegramId = BigInt(ctx.from!.id);
  
  const languages = await userService.getActiveLanguages(telegramId);
  if (languages.length === 0) {
    await ctx.editMessageText('Please set up a language first using /setlanguage');
    return;
  }

  // Use first active language
  const lang = languages[0];
  const languagePair = `${lang.nativeLanguage}-${lang.targetLanguage}`;

  await ctx.editMessageText('🎭 Starting conversation practice...');

  try {
    const { conversationId, scenario, firstMessage } = await conversationService.startConversation(
      telegramId,
      scenarioId,
      languagePair
    );

    ctx.session.tempData = { activeConversation: conversationId };

    const targetName = SUPPORTED_LANGUAGES[lang.targetLanguage] || lang.targetLanguage;

    let message = `🎭 *${scenario.name}*\n`;
    message += `_${scenario.description}_\n\n`;
    message += `---\n\n`;
    message += `🤖 *Partner:*\n${firstMessage.content}\n`;
    if (firstMessage.translation) {
      message += `\n_Translation: ${firstMessage.translation}_\n`;
    }
    message += `\n---\n\n`;
    message += `💬 Reply in ${targetName} to continue the conversation.\n`;
    message += `Type /endchat to finish and get feedback.`;

    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Failed to start conversation:', error);
    await ctx.reply('Failed to start conversation. Please check your AI settings with /settings.');
  }
});

// Handle conversation messages
bot.on('text', async (ctx, next) => {
  const telegramId = BigInt(ctx.from!.id);
  
  // Check if user has an active conversation
  const activeConv = await conversationService.getActiveConversation(telegramId);
  if (!activeConv) {
    return next();
  }

  // Skip if it's a command
  if (ctx.message.text.startsWith('/')) {
    return next();
  }

  const userMessage = ctx.message.text.trim();

  try {
    await ctx.sendChatAction('typing');

    const { aiResponse, feedback } = await conversationService.continueConversation(
      telegramId,
      activeConv.id,
      userMessage
    );

    let message = `🤖 *Partner:*\n${aiResponse.content}\n`;
    if (aiResponse.translation) {
      message += `\n_Translation: ${aiResponse.translation}_\n`;
    }
    if (feedback) {
      message += `\n💡 *Feedback:* ${feedback}\n`;
    }
    message += `\n---\n💬 Continue or type /endchat to finish.`;

    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Conversation error:', error);
    await ctx.reply('Sorry, there was an error. Try again or /endchat to finish.');
  }
});

// End conversation command
bot.command('endchat', async (ctx: BotContext) => {
  const telegramId = BigInt(ctx.from!.id);
  
  const activeConv = await conversationService.getActiveConversation(telegramId);
  if (!activeConv) {
    await ctx.reply('No active conversation to end.');
    return;
  }

  await ctx.reply('📝 Analyzing your conversation...');

  try {
    const { summary, wordsLearned, suggestions } = await conversationService.endConversation(
      telegramId,
      activeConv.id
    );

    let message = `🎭 *Conversation Complete!*\n\n`;
    message += `📊 *Summary:*\n${summary}\n\n`;
    
    if (wordsLearned.length > 0) {
      message += `📚 *Words & Phrases to Remember:*\n`;
      wordsLearned.forEach(word => {
        message += `• ${word}\n`;
      });
      message += '\n';
    }

    if (suggestions.length > 0) {
      message += `💡 *Suggestions for Improvement:*\n`;
      suggestions.forEach(suggestion => {
        message += `• ${suggestion}\n`;
      });
    }

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🎭 Practice Again', 'show_scenarios')],
      [Markup.button.callback('📚 Try a Lesson', 'lesson_again')],
    ]);

    await ctx.reply(message, { parse_mode: 'Markdown', ...keyboard });
  } catch (error) {
    console.error('Error ending conversation:', error);
    await ctx.reply('Conversation ended. Great practice!');
  }

  ctx.session.tempData = undefined;
});

// Show conversation scenarios
bot.action('show_scenarios', async (ctx) => {
  const scenarios = conversationService.getScenarios();
  
  // Group by difficulty
  const beginner = scenarios.filter(s => s.difficulty <= 2);
  const intermediate = scenarios.filter(s => s.difficulty === 3);
  const advanced = scenarios.filter(s => s.difficulty >= 4);

  const buttons: ReturnType<typeof Markup.button.callback>[][] = [];

  if (beginner.length > 0) {
    buttons.push([Markup.button.callback('--- 🌱 Beginner ---', 'noop')]);
    beginner.forEach(s => {
      buttons.push([Markup.button.callback(`${s.name}`, `start_conversation_${s.id}`)]);
    });
  }

  if (intermediate.length > 0) {
    buttons.push([Markup.button.callback('--- 📈 Intermediate ---', 'noop')]);
    intermediate.forEach(s => {
      buttons.push([Markup.button.callback(`${s.name}`, `start_conversation_${s.id}`)]);
    });
  }

  if (advanced.length > 0) {
    buttons.push([Markup.button.callback('--- 🎓 Advanced ---', 'noop')]);
    advanced.forEach(s => {
      buttons.push([Markup.button.callback(`${s.name}`, `start_conversation_${s.id}`)]);
    });
  }

  await ctx.editMessageText(
    '🎭 *Choose a Conversation Scenario*\n\n' +
    'Practice real-world conversations with an AI partner.',
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
  );
});

// No-op for divider buttons
bot.action('noop', async (ctx) => {
  await ctx.answerCbQuery();
});

// Update the conversation command handler
bot.command('conversation', async (ctx: BotContext) => {
  const telegramId = BigInt(ctx.from!.id);
  
  // Check for active conversation
  const activeConv = await conversationService.getActiveConversation(telegramId);
  if (activeConv) {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('Continue Current', 'continue_conv')],
      [Markup.button.callback('End & Start New', 'end_start_new')],
    ]);
    
    await ctx.reply(
      'You have an active conversation. What would you like to do?',
      keyboard
    );
    return;
  }

  const languages = await userService.getActiveLanguages(telegramId);
  if (languages.length === 0) {
    await ctx.reply('Please set up a language first using /setlanguage');
    return;
  }

  // Show scenarios
  const scenarios = conversationService.getScenarios();
  const buttons = scenarios.slice(0, 6).map(s => [
    Markup.button.callback(`${s.name}`, `start_conversation_${s.id}`)
  ]);
  buttons.push([Markup.button.callback('See More Scenarios', 'show_scenarios')]);

  await ctx.reply(
    '🎭 *Conversation Practice*\n\n' +
    'Choose a scenario to practice real-world conversations:',
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
  );
});

bot.action('continue_conv', async (ctx) => {
  await ctx.editMessageText(
    'Continue your conversation! Just type your message.\n\n' +
    'Type /endchat to finish and get feedback.'
  );
});

bot.action('end_start_new', async (ctx) => {
  const telegramId = BigInt(ctx.from!.id);
  const activeConv = await conversationService.getActiveConversation(telegramId);
  
  if (activeConv) {
    await conversationService.endConversation(telegramId, activeConv.id);
  }

  // Show scenarios
  const scenarios = conversationService.getScenarios();
  const buttons = scenarios.slice(0, 6).map(s => [
    Markup.button.callback(`${s.name}`, `start_conversation_${s.id}`)
  ]);

  await ctx.editMessageText(
    '🎭 *Choose a New Scenario*\n\n' +
    'Select a conversation scenario to practice:',
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
  );
});

export { bot };
