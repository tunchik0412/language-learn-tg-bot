import { Markup } from 'telegraf';
import { bot, BotContext } from './index.js';
import { userService } from '../services/user.js';
import { aiService } from '../services/ai/index.js';
import { progressService } from '../services/progress.js';
import { SUPPORTED_LANGUAGES, type AIProvider } from '../types/index.js';

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
 * /start command - Welcome message and initial setup
 */
bot.command('start', async (ctx: BotContext) => {
  await tryDeleteMessage(ctx);
  const firstName = ctx.from?.first_name || 'there';
  
  const welcomeMessage = `
🌍 *Welcome to Language Learning Bot, ${firstName}!*

I'm your AI-powered language learning assistant. I can help you:

📚 Learn vocabulary with contextual examples
📝 Practice grammar with interactive exercises
💬 Practice conversations in realistic scenarios
📖 Improve reading comprehension
🗣️ Learn proper pronunciation
🌎 Discover cultural insights

*Get Started:*
1. Use /setlanguage to choose what to learn
2. Use /settings to configure your AI provider
3. Use /lesson to start your first lesson!

Type /help for all available commands.
  `;

  await ctx.replyWithMarkdown(welcomeMessage);
});

/**
 * /help command - Show all available commands
 */
bot.command('help', async (ctx: BotContext) => {
  await tryDeleteMessage(ctx);
  const helpMessage = `
📖 *Available Commands*

*Learning:*
/lesson - Start a new lesson
/vocabulary - Practice vocabulary
/grammar - Grammar exercises
/conversation - Conversation practice
/reading - Reading comprehension
/review - Review learned words

*Language Settings:*
/setlanguage - Set your target language
/languages - View your active languages
/level - Change proficiency level

*Progress:*
/progress - View your learning progress
/stats - Detailed statistics
/achievements - View earned achievements
/streak - Check your learning streak

*Scheduling:*
/schedule - Set up lesson reminders
/pause - Pause scheduled lessons
/resume - Resume scheduled lessons

*Settings:*
/settings - Bot settings & AI configuration
/settoken - Configure AI API key
/timezone - Set your timezone

*Help:*
/help - Show this help message
/about - About this bot
  `;

  await ctx.replyWithMarkdown(helpMessage);
});

/**
 * /setlanguage command - Set target language
 */
bot.command('setlanguage', async (ctx: BotContext) => {
  await tryDeleteMessage(ctx);
  const languageButtons = Object.entries(SUPPORTED_LANGUAGES)
    .map(([code, name]) => Markup.button.callback(`${name}`, `lang_target_${code}`));
  
  const keyboard = Markup.inlineKeyboard(
    // Arrange in rows of 3
    Array.from({ length: Math.ceil(languageButtons.length / 3) }, (_, i) =>
      languageButtons.slice(i * 3, i * 3 + 3)
    )
  );

  await ctx.reply('🌍 What language would you like to learn?', keyboard);
});

// Language selection callback
bot.action(/^lang_target_(.+)$/, async (ctx) => {
  const targetLang = ctx.match[1];
  ctx.session.tempData = { targetLanguage: targetLang };
  
  const languageButtons = Object.entries(SUPPORTED_LANGUAGES)
    .filter(([code]) => code !== targetLang)
    .map(([code, name]) => Markup.button.callback(`${name}`, `lang_native_${code}`));
  
  const keyboard = Markup.inlineKeyboard(
    Array.from({ length: Math.ceil(languageButtons.length / 3) }, (_, i) =>
      languageButtons.slice(i * 3, i * 3 + 3)
    )
  );

  await ctx.editMessageText('🏠 What is your native language?', keyboard);
});

// Native language selection callback
bot.action(/^lang_native_(.+)$/, async (ctx) => {
  const nativeLang = ctx.match[1];
  const targetLang = ctx.session.tempData?.targetLanguage as string;
  
  ctx.session.tempData = { ...ctx.session.tempData, nativeLanguage: nativeLang };

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🌱 Beginner', 'level_beginner')],
    [Markup.button.callback('📈 Intermediate', 'level_intermediate')],
    [Markup.button.callback('🎓 Advanced', 'level_advanced')],
  ]);

  const targetName = SUPPORTED_LANGUAGES[targetLang] || targetLang;
  await ctx.editMessageText(
    `📊 What's your current level in ${targetName}?`,
    keyboard
  );
});

// Proficiency level selection callback
bot.action(/^level_(.+)$/, async (ctx) => {
  const level = ctx.match[1];
  const targetLang = ctx.session.tempData?.targetLanguage as string;
  const nativeLang = ctx.session.tempData?.nativeLanguage as string;
  
  if (!targetLang || !nativeLang) {
    await ctx.reply('Something went wrong. Please use /setlanguage to start again.');
    return;
  }

  await userService.setLanguage(
    BigInt(ctx.from!.id),
    targetLang,
    nativeLang,
    level
  );

  const targetName = SUPPORTED_LANGUAGES[targetLang] || targetLang;
  const nativeName = SUPPORTED_LANGUAGES[nativeLang] || nativeLang;

  await ctx.editMessageText(
    `✅ Great! You're set up to learn *${targetName}* from *${nativeName}* at the *${level}* level.\n\n` +
    `Use /lesson to start your first lesson, or /settings to configure your AI provider.`,
    { parse_mode: 'Markdown' }
  );

  ctx.session.tempData = undefined;
});

/**
 * /settings command - Show settings menu
 */
bot.command('settings', async (ctx: BotContext) => {
  await tryDeleteMessage(ctx);
  const telegramId = BigInt(ctx.from!.id);
  const providers = await aiService.getUserProviders(telegramId);
  
  const configuredStr = providers.configured.length > 0
    ? providers.configured.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(', ')
    : 'None';
  
  const preferredStr = providers.preferred
    ? providers.preferred.charAt(0).toUpperCase() + providers.preferred.slice(1)
    : 'Not set';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🔑 Set API Key', 'settings_token')],
    [Markup.button.callback('🤖 Choose AI Provider', 'settings_provider')],
    [Markup.button.callback('🌍 Set Timezone', 'settings_timezone')],
    [Markup.button.callback('📊 View Languages', 'settings_languages')],
  ]);

  await ctx.reply(
    `⚙️ *Settings*\n\n` +
    `*AI Provider:* ${preferredStr}\n` +
    `*Configured Keys:* ${configuredStr}\n` +
    `*Available:* ${providers.available.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(', ') || 'None'}`,
    { parse_mode: 'Markdown', ...keyboard }
  );
});

// Settings: Choose provider to set token
bot.action('settings_token', async (ctx) => {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🔷 Gemini (Google)', 'settoken_gemini')],
    [Markup.button.callback('🟢 OpenAI (ChatGPT)', 'settoken_openai')],
    [Markup.button.callback('🟠 Claude (Anthropic)', 'settoken_claude')],
    [Markup.button.callback('◀️ Back', 'settings_back')],
  ]);

  await ctx.editMessageText(
    '🔑 *Set API Key*\n\nChoose which AI provider to configure:',
    { parse_mode: 'Markdown', ...keyboard }
  );
});

// Token input for each provider
bot.action(/^settoken_(.+)$/, async (ctx) => {
  const provider = ctx.match[1] as AIProvider;
  ctx.session.awaitingInput = 'api_token';
  ctx.session.tempData = { provider };

  const providerInfo: Record<string, string> = {
    gemini: 'Get your API key from: https://aistudio.google.com/apikey',
    openai: 'Get your API key from: https://platform.openai.com/api-keys',
    claude: 'Get your API key from: https://console.anthropic.com/settings/keys',
  };

  await ctx.editMessageText(
    `🔑 *Set ${provider.charAt(0).toUpperCase() + provider.slice(1)} API Key*\n\n` +
    `${providerInfo[provider]}\n\n` +
    `Please send your API key now. Your key will be encrypted and stored securely.\n\n` +
    `Send /cancel to cancel.`,
    { parse_mode: 'Markdown' }
  );
});

// Handle text input for API token
bot.on('text', async (ctx, next) => {
  if (ctx.session.awaitingInput === 'api_token' && ctx.session.tempData?.provider) {
    const provider = ctx.session.tempData.provider as AIProvider;
    const token = ctx.message.text.trim();

    if (token === '/cancel') {
      ctx.session.awaitingInput = undefined;
      ctx.session.tempData = undefined;
      await ctx.reply('Cancelled. Use /settings to try again.');
      return;
    }

    // Delete the message containing the token for security
    try {
      await ctx.deleteMessage();
    } catch {
      // May fail if bot doesn't have delete permission
    }

    await ctx.reply('🔄 Validating your API key...');

    const result = await aiService.setUserToken(
      BigInt(ctx.from!.id),
      provider,
      token
    );

    ctx.session.awaitingInput = undefined;
    ctx.session.tempData = undefined;

    if (result.success) {
      await ctx.reply(`✅ ${result.message}\n\nYou can now use /lesson to start learning!`);
    } else {
      await ctx.reply(`❌ ${result.message}\n\nPlease try again with /settings.`);
    }
    return;
  }

  return next();
});

// Choose preferred provider
bot.action('settings_provider', async (ctx) => {
  const telegramId = BigInt(ctx.from!.id);
  const { available, preferred } = await aiService.getUserProviders(telegramId);

  if (available.length === 0) {
    await ctx.editMessageText(
      'No AI providers available. Please set up an API key first.',
      Markup.inlineKeyboard([[Markup.button.callback('🔑 Set API Key', 'settings_token')]])
    );
    return;
  }

  const buttons = available.map(provider => {
    const isPreferred = provider === preferred;
    const icon = provider === 'gemini' ? '🔷' : provider === 'openai' ? '🟢' : '🟠';
    const label = `${icon} ${provider.charAt(0).toUpperCase() + provider.slice(1)}${isPreferred ? ' ✓' : ''}`;
    return [Markup.button.callback(label, `prefer_${provider}`)];
  });

  buttons.push([Markup.button.callback('◀️ Back', 'settings_back')]);

  await ctx.editMessageText(
    '🤖 *Choose Your Preferred AI Provider:*',
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
  );
});

// Set preferred provider
bot.action(/^prefer_(.+)$/, async (ctx) => {
  const provider = ctx.match[1] as AIProvider;
  await aiService.setPreferredProvider(BigInt(ctx.from!.id), provider);
  
  await ctx.editMessageText(
    `✅ ${provider.charAt(0).toUpperCase() + provider.slice(1)} is now your preferred AI provider!`,
    Markup.inlineKeyboard([[Markup.button.callback('◀️ Back to Settings', 'settings_back')]])
  );
});

bot.action('settings_back', async (ctx) => {
  // Re-show settings menu
  const telegramId = BigInt(ctx.from!.id);
  const providers = await aiService.getUserProviders(telegramId);
  
  const configuredStr = providers.configured.length > 0
    ? providers.configured.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(', ')
    : 'None';
  
  const preferredStr = providers.preferred
    ? providers.preferred.charAt(0).toUpperCase() + providers.preferred.slice(1)
    : 'Not set';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🔑 Set API Key', 'settings_token')],
    [Markup.button.callback('🤖 Choose AI Provider', 'settings_provider')],
    [Markup.button.callback('🌍 Set Timezone', 'settings_timezone')],
    [Markup.button.callback('📊 View Languages', 'settings_languages')],
  ]);

  await ctx.editMessageText(
    `⚙️ *Settings*\n\n` +
    `*AI Provider:* ${preferredStr}\n` +
    `*Configured Keys:* ${configuredStr}\n` +
    `*Available:* ${providers.available.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(', ') || 'None'}`,
    { parse_mode: 'Markdown', ...keyboard }
  );
});

/**
 * /progress command - Show user's learning progress
 */
bot.command('progress', async (ctx: BotContext) => {
  await tryDeleteMessage(ctx);
  const telegramId = BigInt(ctx.from!.id);
  const stats = await progressService.getUserStats(telegramId);
  
  if (!stats) {
    await ctx.reply(
      'No progress yet! Start learning with /lesson to track your progress.'
    );
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

Keep up the great work! 💪
  `;

  await ctx.replyWithMarkdown(progressMessage);
});

/**
 * /languages command - Show active languages
 */
bot.command('languages', async (ctx: BotContext) => {
  await tryDeleteMessage(ctx);
  const telegramId = BigInt(ctx.from!.id);
  const languages = await userService.getActiveLanguages(telegramId);

  if (languages.length === 0) {
    await ctx.reply(
      'You haven\'t set up any languages yet. Use /setlanguage to get started!'
    );
    return;
  }

  const languageList = languages.map(l => {
    const target = SUPPORTED_LANGUAGES[l.targetLanguage] || l.targetLanguage;
    const native = SUPPORTED_LANGUAGES[l.nativeLanguage] || l.nativeLanguage;
    return `• ${target} (from ${native}) - ${l.proficiencyLevel}`;
  }).join('\n');

  await ctx.reply(
    `📚 *Your Languages*\n\n${languageList}\n\nUse /setlanguage to add more languages.`,
    { parse_mode: 'Markdown' }
  );
});

// View languages in settings
bot.action('settings_languages', async (ctx) => {
  const telegramId = BigInt(ctx.from!.id);
  const languages = await userService.getActiveLanguages(telegramId);

  if (languages.length === 0) {
    await ctx.editMessageText(
      'You haven\'t set up any languages yet.',
      Markup.inlineKeyboard([
        [Markup.button.callback('➕ Add Language', 'add_language')],
        [Markup.button.callback('◀️ Back', 'settings_back')],
      ])
    );
    return;
  }

  const languageList = languages.map(l => {
    const target = SUPPORTED_LANGUAGES[l.targetLanguage] || l.targetLanguage;
    const native = SUPPORTED_LANGUAGES[l.nativeLanguage] || l.nativeLanguage;
    return `• ${target} (from ${native}) - ${l.proficiencyLevel}`;
  }).join('\n');

  await ctx.editMessageText(
    `📚 *Your Languages*\n\n${languageList}`,
    { 
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('➕ Add Language', 'add_language')],
        [Markup.button.callback('◀️ Back', 'settings_back')],
      ])
    }
  );
});

bot.action('add_language', async (ctx) => {
  const languageButtons = Object.entries(SUPPORTED_LANGUAGES)
    .map(([code, name]) => Markup.button.callback(`${name}`, `lang_target_${code}`));
  
  const keyboard = Markup.inlineKeyboard(
    Array.from({ length: Math.ceil(languageButtons.length / 3) }, (_, i) =>
      languageButtons.slice(i * 3, i * 3 + 3)
    )
  );

  await ctx.editMessageText('🌍 What language would you like to learn?', keyboard);
});

// Timezone setting
bot.action('settings_timezone', async (ctx) => {
  ctx.session.awaitingInput = 'timezone';
  
  await ctx.editMessageText(
    '🌍 *Set Your Timezone*\n\n' +
    'Please send your timezone in one of these formats:\n' +
    '• `America/New_York`\n' +
    '• `Europe/London`\n' +
    '• `Asia/Tokyo`\n' +
    '• `UTC+5` or `UTC-8`\n\n' +
    'Find your timezone: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones\n\n' +
    'Send /cancel to cancel.',
    { parse_mode: 'Markdown' }
  );
});

// Handle timezone input
bot.on('text', async (ctx, next) => {
  if (ctx.session.awaitingInput === 'timezone') {
    const timezone = ctx.message.text.trim();

    // Delete the user's input message
    await tryDeleteMessage(ctx);

    if (timezone === '/cancel') {
      ctx.session.awaitingInput = undefined;
      await ctx.reply('Cancelled. Use /settings to try again.');
      return;
    }

    // Basic validation - check if it looks like a valid timezone
    const validTimezonePattern = /^[A-Za-z_]+\/[A-Za-z_]+$|^UTC[+-]\d{1,2}$/;
    if (!validTimezonePattern.test(timezone)) {
      await ctx.reply(
        'Invalid timezone format. Please use formats like `America/New_York` or `UTC+5`.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    await userService.updateTimezone(BigInt(ctx.from!.id), timezone);
    ctx.session.awaitingInput = undefined;

    await ctx.reply(`✅ Timezone set to *${timezone}*`, { parse_mode: 'Markdown' });
    return;
  }

  return next();
});

/**
 * /about command
 */
bot.command('about', async (ctx: BotContext) => {
  await tryDeleteMessage(ctx);
  await ctx.reply(
    `🌍 *Language Learning Bot*\n\n` +
    `An AI-powered language learning assistant that helps you master new languages ` +
    `through interactive lessons, vocabulary building, grammar exercises, and conversation practice.\n\n` +
    `*Features:*\n` +
    `• Multiple AI providers (Gemini, ChatGPT, Claude)\n` +
    `• Personalized lessons based on your level\n` +
    `• Spaced repetition for vocabulary\n` +
    `• Progress tracking & achievements\n` +
    `• Scheduled lesson reminders\n\n` +
    `Use /help to see all available commands.`,
    { parse_mode: 'Markdown' }
  );
});

export { bot };
