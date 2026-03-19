import { Markup } from 'telegraf';
import { bot, BotContext } from './index.js';
import { scheduleService, type ScheduleData } from '../services/schedule.js';
import { userService } from '../services/user.js';
import { SUPPORTED_LANGUAGES, type LessonType, type LessonDuration, type ScheduleFrequency } from '../types/index.js';

/**
 * Initialize schedule notifications
 */
export function initializeScheduleNotifications(): void {
  scheduleService.setNotifyCallback(async (telegramId: bigint, schedule: ScheduleData) => {
    try {
      const [, targetLang] = schedule.languagePair.split('-');
      const targetName = SUPPORTED_LANGUAGES[targetLang] || targetLang;

      const durationText = {
        quick: '5 minute',
        standard: '15 minute',
        deep: '30 minute',
      };

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📚 Start Lesson', `scheduled_lesson_${schedule.id}`)],
        [Markup.button.callback('⏰ Remind Me Later', `remind_later_${schedule.id}`)],
        [Markup.button.callback('⏸️ Pause Schedule', `pause_schedule_${schedule.id}`)],
      ]);

      await bot.telegram.sendMessage(
        telegramId.toString(),
        `🔔 *Time for your ${targetName} lesson!*\n\n` +
        `Ready for a ${durationText[schedule.lessonDuration]} study session?\n\n` +
        `Let's keep your streak going! 🔥`,
        { parse_mode: 'Markdown', ...keyboard }
      );
    } catch (error) {
      console.error(`Failed to send schedule notification to ${telegramId}:`, error);
    }
  });
}

/**
 * /schedule command - Set up lesson schedules
 */
bot.command('schedule', async (ctx: BotContext) => {
  const telegramId = BigInt(ctx.from!.id);
  const schedules = await scheduleService.getUserSchedules(telegramId);
  const languages = await userService.getActiveLanguages(telegramId);

  if (languages.length === 0) {
    await ctx.reply('Please set up a language first using /setlanguage');
    return;
  }

  if (schedules.length === 0) {
    await ctx.reply(
      '⏰ *Schedule Your Learning*\n\n' +
      'Set up regular reminders to build a consistent learning habit.\n\n' +
      'Tap below to create your first schedule!',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('➕ Create Schedule', 'create_schedule')],
        ]),
      }
    );
    return;
  }

  // Show existing schedules
  let message = '⏰ *Your Learning Schedules*\n\n';
  const buttons: ReturnType<typeof Markup.button.callback>[][] = [];

  for (const schedule of schedules) {
    const [, targetLang] = schedule.languagePair.split('-');
    const targetName = SUPPORTED_LANGUAGES[targetLang] || targetLang;
    const days = (schedule.daysOfWeek as number[]).map(d => 
      ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]
    ).join(', ');
    
    const status = !schedule.active 
      ? '❌ Inactive' 
      : schedule.pausedUntil && schedule.pausedUntil > new Date() 
        ? '⏸️ Paused' 
        : '✅ Active';

    message += `*${targetName}*\n`;
    message += `📅 ${days} at ${schedule.preferredTime}\n`;
    message += `⏱️ ${schedule.lessonDuration} lessons\n`;
    message += `${status}\n\n`;

    buttons.push([Markup.button.callback(`⚙️ ${targetName}`, `manage_schedule_${schedule.id}`)]);
  }

  buttons.push([Markup.button.callback('➕ Add Schedule', 'create_schedule')]);

  await ctx.reply(message, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

// Create new schedule
bot.action('create_schedule', async (ctx) => {
  const telegramId = BigInt(ctx.from!.id);
  const languages = await userService.getActiveLanguages(telegramId);

  if (languages.length === 1) {
    const lang = languages[0];
    ctx.session.tempData = {
      scheduleLanguagePair: `${lang.nativeLanguage}-${lang.targetLanguage}`,
    };
    await showFrequencySelection(ctx);
    return;
  }

  const buttons = languages.map(l => {
    const target = SUPPORTED_LANGUAGES[l.targetLanguage] || l.targetLanguage;
    return [Markup.button.callback(
      target,
      `schedule_lang_${l.nativeLanguage}-${l.targetLanguage}`
    )];
  });

  await ctx.editMessageText(
    '📚 Which language do you want to schedule?',
    Markup.inlineKeyboard(buttons)
  );
});

// Language selection for schedule
bot.action(/^schedule_lang_(.+)$/, async (ctx) => {
  const languagePair = ctx.match[1];
  ctx.session.tempData = { scheduleLanguagePair: languagePair };
  await showFrequencySelection(ctx);
});

async function showFrequencySelection(ctx: BotContext) {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📅 Every Day', 'schedule_freq_daily')],
    [Markup.button.callback('💼 Weekdays (Mon-Fri)', 'schedule_freq_weekdays')],
    [Markup.button.callback('🏖️ Weekends (Sat-Sun)', 'schedule_freq_weekends')],
    [Markup.button.callback('🔧 Custom Days', 'schedule_freq_custom')],
  ]);

  await ctx.editMessageText('📅 How often would you like to learn?', keyboard);
}

// Frequency selection
bot.action(/^schedule_freq_(.+)$/, async (ctx) => {
  const frequency = ctx.match[1] as ScheduleFrequency;
  
  if (frequency === 'custom') {
    // Show day picker
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('Sun', 'schedule_day_0'),
        Markup.button.callback('Mon', 'schedule_day_1'),
        Markup.button.callback('Tue', 'schedule_day_2'),
        Markup.button.callback('Wed', 'schedule_day_3'),
      ],
      [
        Markup.button.callback('Thu', 'schedule_day_4'),
        Markup.button.callback('Fri', 'schedule_day_5'),
        Markup.button.callback('Sat', 'schedule_day_6'),
      ],
      [Markup.button.callback('✅ Done', 'schedule_days_done')],
    ]);

    ctx.session.tempData = { 
      ...ctx.session.tempData, 
      scheduleFrequency: 'custom',
      scheduleDays: [] as number[],
    };

    await ctx.editMessageText(
      '📅 Select the days you want to learn (tap to toggle):',
      keyboard
    );
    return;
  }

  ctx.session.tempData = { ...ctx.session.tempData, scheduleFrequency: frequency };
  await showTimeSelection(ctx);
});

// Custom day selection
bot.action(/^schedule_day_(\d)$/, async (ctx) => {
  const day = parseInt(ctx.match[1]);
  const days = (ctx.session.tempData?.scheduleDays as number[]) || [];
  
  const index = days.indexOf(day);
  if (index === -1) {
    days.push(day);
  } else {
    days.splice(index, 1);
  }
  
  ctx.session.tempData = { ...ctx.session.tempData, scheduleDays: days };

  // Update button labels to show selection
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback(days.includes(0) ? '✓ Sun' : 'Sun', 'schedule_day_0'),
      Markup.button.callback(days.includes(1) ? '✓ Mon' : 'Mon', 'schedule_day_1'),
      Markup.button.callback(days.includes(2) ? '✓ Tue' : 'Tue', 'schedule_day_2'),
      Markup.button.callback(days.includes(3) ? '✓ Wed' : 'Wed', 'schedule_day_3'),
    ],
    [
      Markup.button.callback(days.includes(4) ? '✓ Thu' : 'Thu', 'schedule_day_4'),
      Markup.button.callback(days.includes(5) ? '✓ Fri' : 'Fri', 'schedule_day_5'),
      Markup.button.callback(days.includes(6) ? '✓ Sat' : 'Sat', 'schedule_day_6'),
    ],
    [Markup.button.callback('✅ Done', 'schedule_days_done')],
  ]);

  const selectedDays = days.sort().map(d => dayNames[d]).join(', ') || 'None';
  await ctx.editMessageText(
    `📅 Select the days you want to learn:\n\nSelected: ${selectedDays}`,
    keyboard
  );
});

bot.action('schedule_days_done', async (ctx) => {
  const days = (ctx.session.tempData?.scheduleDays as number[]) || [];
  
  if (days.length === 0) {
    await ctx.answerCbQuery('Please select at least one day', { show_alert: true });
    return;
  }

  await showTimeSelection(ctx);
});

async function showTimeSelection(ctx: BotContext) {
  const telegramId = BigInt(ctx.from!.id);
  const suggestedTimes = await scheduleService.suggestOptimalTimes(telegramId);

  const timeButtons = suggestedTimes.map(time => [
    Markup.button.callback(`🕐 ${time}`, `schedule_time_${time}`),
  ]);

  timeButtons.push([Markup.button.callback('⌨️ Enter Custom Time', 'schedule_time_custom')]);

  await ctx.editMessageText(
    '⏰ When would you like your daily reminder?\n\n' +
    '_Based on your activity, here are some suggested times:_',
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(timeButtons) }
  );
}

// Time selection
bot.action(/^schedule_time_(.+)$/, async (ctx) => {
  const time = ctx.match[1];
  
  if (time === 'custom') {
    ctx.session.awaitingInput = 'schedule_time';
    await ctx.editMessageText(
      'Please enter your preferred time in 24-hour format (e.g., 09:00 or 18:30):'
    );
    return;
  }

  ctx.session.tempData = { ...ctx.session.tempData, scheduleTime: time };
  await showDurationSelection(ctx);
});

// Handle custom time input
bot.on('text', async (ctx, next) => {
  if (ctx.session.awaitingInput === 'schedule_time') {
    const time = ctx.message.text.trim();
    
    // Validate time format
    if (!/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time)) {
      await ctx.reply('Invalid time format. Please use HH:MM format (e.g., 09:00 or 18:30)');
      return;
    }

    ctx.session.awaitingInput = undefined;
    ctx.session.tempData = { ...ctx.session.tempData, scheduleTime: time };
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('⚡ Quick (5 min)', 'schedule_dur_quick')],
      [Markup.button.callback('📖 Standard (15 min)', 'schedule_dur_standard')],
      [Markup.button.callback('🎓 Deep Dive (30 min)', 'schedule_dur_deep')],
    ]);

    await ctx.reply('⏱️ How long should each lesson be?', keyboard);
    return;
  }

  return next();
});

async function showDurationSelection(ctx: BotContext) {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('⚡ Quick (5 min)', 'schedule_dur_quick')],
    [Markup.button.callback('📖 Standard (15 min)', 'schedule_dur_standard')],
    [Markup.button.callback('🎓 Deep Dive (30 min)', 'schedule_dur_deep')],
  ]);

  await ctx.editMessageText('⏱️ How long should each lesson be?', keyboard);
}

// Duration selection and create schedule
bot.action(/^schedule_dur_(.+)$/, async (ctx) => {
  const duration = ctx.match[1] as LessonDuration;
  const tempData = ctx.session.tempData as {
    scheduleLanguagePair: string;
    scheduleFrequency: ScheduleFrequency;
    scheduleDays?: number[];
    scheduleTime: string;
  };

  try {
    await scheduleService.createSchedule(BigInt(ctx.from!.id), {
      languagePair: tempData.scheduleLanguagePair,
      frequency: tempData.scheduleFrequency,
      daysOfWeek: tempData.scheduleDays,
      preferredTime: tempData.scheduleTime,
      lessonDuration: duration,
    });

    const [, targetLang] = tempData.scheduleLanguagePair.split('-');
    const targetName = SUPPORTED_LANGUAGES[targetLang] || targetLang;

    await ctx.editMessageText(
      `✅ *Schedule Created!*\n\n` +
      `📚 *Language:* ${targetName}\n` +
      `⏰ *Time:* ${tempData.scheduleTime}\n` +
      `⏱️ *Duration:* ${duration} lessons\n\n` +
      `You'll receive reminders to help you stay consistent. Use /schedule to manage your schedules.`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Failed to create schedule:', error);
    await ctx.editMessageText('Failed to create schedule. Please try again with /schedule.');
  }

  ctx.session.tempData = undefined;
});

// Manage individual schedule
bot.action(/^manage_schedule_(.+)$/, async (ctx) => {
  const scheduleId = ctx.match[1];
  const schedules = await scheduleService.getUserSchedules(BigInt(ctx.from!.id));
  const schedule = schedules.find(s => s.id === scheduleId);

  if (!schedule) {
    await ctx.editMessageText('Schedule not found.');
    return;
  }

  const [, targetLang] = schedule.languagePair.split('-');
  const targetName = SUPPORTED_LANGUAGES[targetLang] || targetLang;
  const isPaused = schedule.pausedUntil && schedule.pausedUntil > new Date();
  const isActive = schedule.active && !isPaused;

  const buttons: ReturnType<typeof Markup.button.callback>[][] = [];
  
  if (isActive) {
    buttons.push([Markup.button.callback('⏸️ Pause', `pause_schedule_${scheduleId}`)]);
  } else if (isPaused) {
    buttons.push([Markup.button.callback('▶️ Resume', `resume_schedule_${scheduleId}`)]);
  } else {
    buttons.push([Markup.button.callback('✅ Activate', `activate_schedule_${scheduleId}`)]);
  }

  buttons.push([Markup.button.callback('⏰ Change Time', `change_time_${scheduleId}`)]);
  buttons.push([Markup.button.callback('🗑️ Delete', `delete_schedule_${scheduleId}`)]);
  buttons.push([Markup.button.callback('◀️ Back', 'back_to_schedules')]);

  await ctx.editMessageText(
    `⚙️ *Manage ${targetName} Schedule*\n\n` +
    `⏰ Time: ${schedule.preferredTime}\n` +
    `⏱️ Duration: ${schedule.lessonDuration}\n` +
    `Status: ${isActive ? '✅ Active' : isPaused ? '⏸️ Paused' : '❌ Inactive'}`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
  );
});

// Pause schedule
bot.action(/^pause_schedule_(.+)$/, async (ctx) => {
  const scheduleId = ctx.match[1];
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('1 Day', `pause_for_${scheduleId}_1`)],
    [Markup.button.callback('3 Days', `pause_for_${scheduleId}_3`)],
    [Markup.button.callback('1 Week', `pause_for_${scheduleId}_7`)],
    [Markup.button.callback('2 Weeks', `pause_for_${scheduleId}_14`)],
    [Markup.button.callback('◀️ Cancel', `manage_schedule_${scheduleId}`)],
  ]);

  await ctx.editMessageText('⏸️ How long would you like to pause?', keyboard);
});

bot.action(/^pause_for_(.+)_(\d+)$/, async (ctx) => {
  const scheduleId = ctx.match[1];
  const days = parseInt(ctx.match[2]);
  
  const untilDate = new Date();
  untilDate.setDate(untilDate.getDate() + days);
  
  await scheduleService.pauseSchedule(scheduleId, untilDate);
  
  await ctx.editMessageText(
    `⏸️ Schedule paused until ${untilDate.toLocaleDateString()}\n\nUse /schedule to resume.`
  );
});

// Resume schedule
bot.action(/^resume_schedule_(.+)$/, async (ctx) => {
  const scheduleId = ctx.match[1];
  await scheduleService.resumeSchedule(scheduleId);
  await ctx.editMessageText('▶️ Schedule resumed! You\'ll receive your next reminder as scheduled.');
});

// Activate schedule
bot.action(/^activate_schedule_(.+)$/, async (ctx) => {
  const scheduleId = ctx.match[1];
  await scheduleService.activateSchedule(scheduleId);
  await ctx.editMessageText('✅ Schedule activated!');
});

// Delete schedule
bot.action(/^delete_schedule_(.+)$/, async (ctx) => {
  const scheduleId = ctx.match[1];
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🗑️ Yes, Delete', `confirm_delete_${scheduleId}`)],
    [Markup.button.callback('◀️ Cancel', `manage_schedule_${scheduleId}`)],
  ]);

  await ctx.editMessageText('Are you sure you want to delete this schedule?', keyboard);
});

bot.action(/^confirm_delete_(.+)$/, async (ctx) => {
  const scheduleId = ctx.match[1];
  await scheduleService.deleteSchedule(scheduleId);
  await ctx.editMessageText('🗑️ Schedule deleted.');
});

// Change time
bot.action(/^change_time_(.+)$/, async (ctx) => {
  const scheduleId = ctx.match[1];
  ctx.session.awaitingInput = 'schedule_time';
  ctx.session.tempData = { updateScheduleId: scheduleId };
  
  await ctx.editMessageText(
    'Enter new time in 24-hour format (e.g., 09:00 or 18:30):'
  );
});

// Handle time update
bot.on('text', async (ctx, next) => {
  if (ctx.session.awaitingInput === 'schedule_time' && ctx.session.tempData?.updateScheduleId) {
    const scheduleId = ctx.session.tempData.updateScheduleId as string;
    const time = ctx.message.text.trim();
    
    if (!/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time)) {
      await ctx.reply('Invalid time format. Please use HH:MM format.');
      return;
    }

    await scheduleService.updateSchedule(scheduleId, { preferredTime: time });
    
    ctx.session.awaitingInput = undefined;
    ctx.session.tempData = undefined;
    
    await ctx.reply(`✅ Schedule time updated to ${time}`);
    return;
  }

  return next();
});

// Back to schedules list
bot.action('back_to_schedules', async (ctx) => {
  const telegramId = BigInt(ctx.from!.id);
  const schedules = await scheduleService.getUserSchedules(telegramId);

  if (schedules.length === 0) {
    await ctx.editMessageText(
      '⏰ No schedules found. Create one to get started!',
      Markup.inlineKeyboard([[Markup.button.callback('➕ Create Schedule', 'create_schedule')]])
    );
    return;
  }

  let message = '⏰ *Your Learning Schedules*\n\n';
  const buttons: ReturnType<typeof Markup.button.callback>[][] = [];

  for (const schedule of schedules) {
    const [, targetLang] = schedule.languagePair.split('-');
    const targetName = SUPPORTED_LANGUAGES[targetLang] || targetLang;
    buttons.push([Markup.button.callback(`⚙️ ${targetName}`, `manage_schedule_${schedule.id}`)]);
  }

  buttons.push([Markup.button.callback('➕ Add Schedule', 'create_schedule')]);

  await ctx.editMessageText(message, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

// Handle scheduled lesson start
bot.action(/^scheduled_lesson_(.+)$/, async (ctx) => {
  const scheduleId = ctx.match[1];
  const schedules = await scheduleService.getUserSchedules(BigInt(ctx.from!.id));
  const schedule = schedules.find(s => s.id === scheduleId);

  if (!schedule) return;

  const languages = await userService.getActiveLanguages(BigInt(ctx.from!.id));
  const [nativeLang, targetLang] = schedule.languagePair.split('-');
  const langConfig = languages.find(l => 
    l.nativeLanguage === nativeLang && l.targetLanguage === targetLang
  );

  ctx.session.tempData = {
    languagePair: schedule.languagePair,
    proficiencyLevel: langConfig?.proficiencyLevel || 'intermediate',
  };

  // Show lesson type selection
  const lessonTypes = (schedule.lessonTypes as LessonType[]) || ['vocabulary', 'grammar', 'conversation'];
  const buttons = lessonTypes.map(type => [
    Markup.button.callback(
      `${type.charAt(0).toUpperCase() + type.slice(1)}`,
      `lesson_type_${type}`
    ),
  ]);

  await ctx.editMessageText('📚 What type of lesson would you like?', Markup.inlineKeyboard(buttons));
});

// Remind later
bot.action(/^remind_later_(.+)$/, async (ctx) => {
  await ctx.editMessageText(
    '⏰ Okay! I\'ll remind you again at your next scheduled time.\n\n' +
    'You can also start a lesson anytime with /lesson'
  );
});

/**
 * /pause command - Pause all schedules
 */
bot.command('pause', async (ctx: BotContext) => {
  const telegramId = BigInt(ctx.from!.id);
  const schedules = await scheduleService.getUserSchedules(telegramId);
  const activeSchedules = schedules.filter(s => s.active && !s.pausedUntil);

  if (activeSchedules.length === 0) {
    await ctx.reply('You don\'t have any active schedules to pause.');
    return;
  }

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('Pause All (1 week)', 'pause_all_7')],
    [Markup.button.callback('Pause All (2 weeks)', 'pause_all_14')],
    [Markup.button.callback('Manage Individual', 'back_to_schedules')],
  ]);

  await ctx.reply(
    `You have ${activeSchedules.length} active schedule(s). How would you like to pause them?`,
    keyboard
  );
});

bot.action(/^pause_all_(\d+)$/, async (ctx) => {
  const days = parseInt(ctx.match[1]);
  const telegramId = BigInt(ctx.from!.id);
  const schedules = await scheduleService.getUserSchedules(telegramId);
  
  const untilDate = new Date();
  untilDate.setDate(untilDate.getDate() + days);

  for (const schedule of schedules) {
    if (schedule.active) {
      await scheduleService.pauseSchedule(schedule.id, untilDate);
    }
  }

  await ctx.editMessageText(
    `⏸️ All schedules paused until ${untilDate.toLocaleDateString()}\n\nUse /resume to resume.`
  );
});

/**
 * /resume command - Resume all schedules
 */
bot.command('resume', async (ctx: BotContext) => {
  const telegramId = BigInt(ctx.from!.id);
  const schedules = await scheduleService.getUserSchedules(telegramId);
  const pausedSchedules = schedules.filter(s => s.pausedUntil && s.pausedUntil > new Date());

  if (pausedSchedules.length === 0) {
    await ctx.reply('You don\'t have any paused schedules.');
    return;
  }

  for (const schedule of pausedSchedules) {
    await scheduleService.resumeSchedule(schedule.id);
  }

  await ctx.reply(`▶️ Resumed ${pausedSchedules.length} schedule(s)!`);
});

export { bot };
