import { Telegraf, Context, session } from 'telegraf';
import { config } from '../config/index.js';
import { userService } from '../services/user.js';
import type { BotSession } from '../types/index.js';

// Extend Context with session
export interface BotContext extends Context {
  session: BotSession;
}

// Create bot instance
export const bot = new Telegraf<BotContext>(config.TELEGRAM_BOT_TOKEN);

// Session middleware
bot.use(session({
  defaultSession: (): BotSession => ({})
}));

// User registration middleware - runs for every message
bot.use(async (ctx, next) => {
  if (ctx.from) {
    try {
      await userService.getOrCreateUser(
        BigInt(ctx.from.id),
        {
          username: ctx.from.username,
          firstName: ctx.from.first_name,
          lastName: ctx.from.last_name,
        }
      );
    } catch (error) {
      console.error('Failed to register user:', error);
    }
  }
  return next();
});

// Error handling middleware
bot.catch((error, ctx) => {
  console.error('Bot error:', error);
  ctx.reply('An error occurred. Please try again or use /help for assistance.')
    .catch(console.error);
});
