# Vercel Deployment Guide

## Prerequisites

1. A [Vercel account](https://vercel.com/signup)
2. [Vercel CLI](https://vercel.com/cli) installed: `npm i -g vercel`
3. A PostgreSQL database (recommend [Neon](https://neon.tech) or [Supabase](https://supabase.com) - both have free tiers)

## Step 1: Set Up Database

1. Create a PostgreSQL database on Neon/Supabase
2. Get the connection string (format: `postgresql://user:pass@host:port/dbname`)

## Step 2: Configure Environment Variables

In the Vercel dashboard (or via CLI), set these environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `TELEGRAM_BOT_TOKEN` | ✅ | Get from [@BotFather](https://t.me/BotFather) |
| `ENCRYPTION_KEY` | ✅ | 32+ char random string for encrypting API keys |
| `OPENAI_API_KEY` | ❌ | For OpenAI provider |
| `ANTHROPIC_API_KEY` | ❌ | For Claude provider |
| `GEMINI_API_KEY` | ❌ | For Gemini provider (free tier available) |

Generate an encryption key:
```bash
openssl rand -hex 32
```

## Step 3: Deploy to Vercel

### Option A: Vercel CLI

```bash
# Login to Vercel
vercel login

# Deploy (first time - will prompt for project setup)
vercel

# Deploy to production
vercel --prod
```

### Option B: GitHub Integration

1. Push your code to GitHub
2. Go to [Vercel Dashboard](https://vercel.com/new)
3. Import your repository
4. Vercel auto-detects settings from `vercel.json`
5. Add environment variables in the dashboard
6. Deploy

## Step 4: Set Webhook

After deployment, set the Telegram webhook to your Vercel URL:

```bash
# Replace with your actual Vercel URL
npx ts-node scripts/set-webhook.ts https://your-project.vercel.app/api/webhook
```

Or using curl:
```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://your-project.vercel.app/api/webhook"
```

## Step 5: Verify

1. Send `/start` to your bot
2. Check Vercel function logs for any errors

## Switching Between Development Modes

### For local development (polling mode):
```bash
# Delete webhook to enable polling
npx ts-node scripts/set-webhook.ts --delete

# Run locally
docker-compose up
```

### For production (webhook mode):
```bash
# Set webhook back
npx ts-node scripts/set-webhook.ts https://your-project.vercel.app/api/webhook
```

## Troubleshooting

### Check webhook status:
```bash
npx ts-node scripts/set-webhook.ts --info
```

### Common issues:

1. **Bot not responding**: Check webhook is set correctly
2. **Database errors**: Verify `DATABASE_URL` is correct and database is accessible
3. **Function timeout**: Vercel free tier has 10s limit; AI requests might timeout

### View logs:
- Vercel Dashboard → Your Project → Functions tab → View logs

## Database Migrations

Run Prisma migrations before first deployment:

```bash
# Generate Prisma client
npx prisma generate

# Push schema to database
npx prisma db push
```

For subsequent schema changes, use migrations:
```bash
npx prisma migrate deploy
```
