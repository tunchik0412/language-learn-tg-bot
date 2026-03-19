/**
 * Bot initialization for Vercel serverless environment
 */
import { Telegraf } from 'telegraf';
import { connectDatabase } from '../services/database.js';
import type { BotContext } from './index.js';

// Import the bot instance (this also triggers handler registration via side effects)
import { bot } from './index.js';

// Import handlers to register them
import './commands.js';
import './lessons.js';
import './schedule.js';
import './conversation.js';

let isInitialized = false;

/**
 * Initialize bot for serverless environment
 */
export async function initBot(): Promise<void> {
  if (isInitialized) return;

  // Connect to database
  await connectDatabase();

  isInitialized = true;
  console.log('✅ Bot initialized for Vercel');
}

/**
 * Get the bot instance
 */
export function getBot(): Telegraf<BotContext> {
  return bot;
}

/**
 * Set up webhook for the bot
 * Run this once to configure Telegram to send updates to your Vercel URL
 */
export async function setWebhook(webhookUrl: string): Promise<void> {
  await bot.telegram.setWebhook(webhookUrl);
  console.log(`✅ Webhook set to: ${webhookUrl}`);
}
