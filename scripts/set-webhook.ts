#!/usr/bin/env ts-node
/**
 * Script to set or delete Telegram webhook
 * Usage: 
 *   Set webhook:    npx ts-node scripts/set-webhook.ts https://your-domain.vercel.app/api/webhook
 *   Delete webhook: npx ts-node scripts/set-webhook.ts --delete
 */

import 'dotenv/config';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TELEGRAM_BOT_TOKEN) {
  console.error('Error: TELEGRAM_BOT_TOKEN environment variable is not set');
  process.exit(1);
}

async function setWebhook(url: string): Promise<void> {
  const response = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        url,
        allowed_updates: ['message', 'callback_query']
      })
    }
  );
  
  const result = await response.json();
  
  if (result.ok) {
    console.log('✅ Webhook set successfully!');
    console.log(`   URL: ${url}`);
  } else {
    console.error('❌ Failed to set webhook:', result.description);
    process.exit(1);
  }
}

async function deleteWebhook(): Promise<void> {
  const response = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook`
  );
  
  const result = await response.json();
  
  if (result.ok) {
    console.log('✅ Webhook deleted successfully!');
    console.log('   Bot is now in polling mode (for local development)');
  } else {
    console.error('❌ Failed to delete webhook:', result.description);
    process.exit(1);
  }
}

async function getWebhookInfo(): Promise<void> {
  const response = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo`
  );
  
  const result = await response.json();
  console.log('\n📋 Current webhook info:');
  console.log(JSON.stringify(result.result, null, 2));
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  
  if (!arg) {
    console.log('Usage:');
    console.log('  Set webhook:    npx ts-node scripts/set-webhook.ts <webhook-url>');
    console.log('  Delete webhook: npx ts-node scripts/set-webhook.ts --delete');
    console.log('  Get info:       npx ts-node scripts/set-webhook.ts --info');
    console.log('\nExample:');
    console.log('  npx ts-node scripts/set-webhook.ts https://your-app.vercel.app/api/webhook');
    process.exit(0);
  }
  
  if (arg === '--delete') {
    await deleteWebhook();
  } else if (arg === '--info') {
    await getWebhookInfo();
  } else if (arg.startsWith('http')) {
    await setWebhook(arg);
  } else {
    console.error('Error: Invalid argument. Use a URL, --delete, or --info');
    process.exit(1);
  }
  
  await getWebhookInfo();
}

main().catch(console.error);
