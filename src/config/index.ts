import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';

dotenvConfig();

const envSchema = z.object({
  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  
  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  
  // Redis (optional)
  REDIS_URL: z.string().optional().default('redis://localhost:6379'),
  REDIS_ENABLED: z.string().transform(v => v === 'true').default('false'),
  
  // Encryption
  ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY must be at least 32 characters'),
  
  // AI Providers (optional fallbacks)
  DEFAULT_AI_PROVIDER: z.enum(['gemini', 'openai', 'claude']).default('gemini'),
  GEMINI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  
  // Webhook (optional)
  BOT_WEBHOOK_DOMAIN: z.string().optional(),
  BOT_WEBHOOK_PORT: z.string().transform(Number).default('3000'),
  USE_WEBHOOK: z.string().transform(v => v === 'true').default('false'),
  
  // Environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parseEnv = () => {
  const result = envSchema.safeParse(process.env);
  
  if (!result.success) {
    console.error('❌ Invalid environment variables:');
    console.error(result.error.format());
    process.exit(1);
  }
  
  return result.data;
};

export const config = parseEnv();
console.log('✅ Environment variables loaded successfully', config);

export type Config = typeof config;
