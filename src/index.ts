import { config } from './config/index.js';
import { bot } from './bot/index.js';
import { connectDatabase, disconnectDatabase } from './services/database.js';
import { scheduleService } from './services/schedule.js';
import { initializeScheduleNotifications } from './bot/schedule.js';

// Import all bot command handlers
import './bot/commands.js';
import './bot/lessons.js';
import './bot/schedule.js';
import './bot/conversation.js';

async function main() {
  console.log('🚀 Starting Language Learning Bot...');
  
  // Log token status for debugging
  const token = config.TELEGRAM_BOT_TOKEN;
  if (token) {
    const masked = token.slice(0, 5) + '...' + token.slice(-4);
    console.log(`🔑 Bot token: ${masked} (length: ${token.length})`);
  } else {
    console.log('❌ TELEGRAM_BOT_TOKEN is not set!');
  }

  try {
    // Connect to database
    await connectDatabase();

    // Initialize schedule notifications
    initializeScheduleNotifications();

    // Start daily tasks (streak reset, etc.)
    scheduleService.startDailyTasks();

    // Initialize existing schedules
    await scheduleService.initializeSchedules();

    // Start the bot
    if (config.USE_WEBHOOK && config.BOT_WEBHOOK_DOMAIN) {
      // Webhook mode for production
      const webhookPath = `/bot${config.TELEGRAM_BOT_TOKEN}`;
      await bot.launch({
        webhook: {
          domain: config.BOT_WEBHOOK_DOMAIN,
          port: config.BOT_WEBHOOK_PORT,
          hookPath: webhookPath,
        },
      });
      console.log(`✅ Bot started in webhook mode on ${config.BOT_WEBHOOK_DOMAIN}`);
    } else {
      // Polling mode for development
      await bot.launch();
      console.log('✅ Bot started in polling mode');
    }

    console.log(`🤖 Bot username: @${bot.botInfo?.username}`);
    console.log(`📅 Active schedules: ${scheduleService.getActiveScheduleCount()}`);

  } catch (error) {
    console.error('❌ Failed to start bot:', error);
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  
  bot.stop(signal);
  await disconnectDatabase();
  
  console.log('Goodbye! 👋');
  process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start the bot
main();
