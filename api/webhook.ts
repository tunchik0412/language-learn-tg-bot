import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initBot, getBot } from '../src/bot/vercel.js';

// Initialize bot handlers (only once per cold start)
let initialized = false;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Only accept POST requests
    if (req.method !== 'POST') {
      return res.status(200).json({ ok: true, method: req.method });
    }

    // Initialize bot if not done yet
    if (!initialized) {
      await initBot();
      initialized = true;
    }

    const bot = getBot();
    
    // Process the update
    await bot.handleUpdate(req.body);

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(200).json({ ok: true }); // Return 200 to prevent Telegram retries
  }
}
