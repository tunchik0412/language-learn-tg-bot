# Language Learning Telegram Bot 🌍

An AI-powered Telegram bot for learning languages through interactive lessons, vocabulary building, grammar exercises, and conversation practice.

## Features

### 🤖 AI Integration
- **Multiple AI Providers**: Choose between Gemini, OpenAI ChatGPT, or Anthropic Claude
- **Secure Token Storage**: User API tokens are encrypted using AES-256
- **Automatic Fallback**: If one AI provider fails, the bot tries others
- **Personalized Content**: AI generates lessons tailored to your level

### 📚 Language Learning
- **Multiple Lesson Types**:
  - 📖 Vocabulary building with contextual examples
  - 📝 Grammar explanations and exercises
  - 💬 Conversation practice scenarios
  - 📚 Reading comprehension
  - 🗣️ Pronunciation guides
  - 🌍 Cultural notes

### 📈 Progress Tracking
- Track words learned and lessons completed
- Maintain learning streaks
- Earn achievements and XP
- Spaced repetition for vocabulary review

### ⏰ Smart Scheduling
- Set daily, weekly, or custom lesson reminders
- Timezone support
- Pause/resume schedules
- Suggested optimal learning times based on activity

## Tech Stack

- **Runtime**: Node.js 18+ (LTS)
- **Language**: TypeScript
- **Bot Framework**: Telegraf.js
- **Database**: PostgreSQL with Prisma ORM
- **AI Providers**: Google Gemini, OpenAI, Anthropic Claude
- **Scheduling**: node-cron
- **Encryption**: crypto-js (AES-256)

## Quick Start

### Prerequisites

- Node.js 18 or higher
- PostgreSQL database
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- At least one AI provider API key

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd language-learn-tg-bot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

4. **Set up database**
   ```bash
   # Generate Prisma client
   npm run db:generate
   
   # Push schema to database
   npm run db:push
   ```

5. **Start the bot**
   ```bash
   # Development mode (with hot reload)
   npm run dev
   
   # Production mode
   npm run build
   npm start
   ```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `TELEGRAM_BOT_TOKEN` | Bot token from BotFather | Yes |
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `ENCRYPTION_KEY` | 32+ character key for encrypting tokens | Yes |
| `DEFAULT_AI_PROVIDER` | Default AI provider (gemini/openai/claude) | No |
| `GEMINI_API_KEY` | Google Gemini API key (fallback) | No |
| `OPENAI_API_KEY` | OpenAI API key (fallback) | No |
| `ANTHROPIC_API_KEY` | Anthropic API key (fallback) | No |
| `USE_WEBHOOK` | Use webhook mode (true/false) | No |
| `BOT_WEBHOOK_DOMAIN` | Webhook domain (if using webhook) | No |

## Bot Commands

### Getting Started
- `/start` - Welcome message and setup
- `/help` - List all commands
- `/setlanguage` - Set your target language

### Learning
- `/lesson` - Start a new lesson
- `/vocabulary` - Vocabulary lesson
- `/grammar` - Grammar lesson
- `/conversation` - Conversation practice
- `/reading` - Reading comprehension
- `/review` - Review vocabulary (spaced repetition)

### Progress
- `/progress` - View learning progress
- `/stats` - Detailed statistics
- `/achievements` - View earned achievements
- `/streak` - Check learning streak

### Scheduling
- `/schedule` - Set up lesson reminders
- `/pause` - Pause all schedules
- `/resume` - Resume schedules

### Settings
- `/settings` - Bot settings & AI configuration
- `/languages` - View active languages
- `/timezone` - Set timezone

## Project Structure

```
src/
├── bot/
│   ├── index.ts       # Bot initialization
│   ├── commands.ts    # Basic bot commands
│   ├── lessons.ts     # Lesson-related handlers
│   └── schedule.ts    # Schedule handlers
├── config/
│   └── index.ts       # Configuration management
├── services/
│   ├── ai/
│   │   ├── base.ts    # AI provider interface
│   │   ├── gemini.ts  # Gemini implementation
│   │   ├── openai.ts  # OpenAI implementation
│   │   ├── claude.ts  # Claude implementation
│   │   └── index.ts   # AI service with fallback
│   ├── database.ts    # Database connection
│   ├── encryption.ts  # Token encryption
│   ├── user.ts        # User management
│   ├── lesson.ts      # Lesson generation
│   ├── vocabulary.ts  # Vocabulary & spaced repetition
│   ├── progress.ts    # Progress tracking
│   └── schedule.ts    # Scheduling service
├── types/
│   └── index.ts       # TypeScript types
└── index.ts           # Entry point
```

## Database Schema

The bot uses PostgreSQL with the following main tables:
- **User**: User profiles and settings
- **UserLanguage**: User's language learning preferences
- **Lesson**: Generated lessons
- **Exercise**: Interactive exercises
- **Vocabulary**: User's vocabulary with spaced repetition
- **Progress**: Learning progress per language
- **Schedule**: Lesson schedules
- **Achievement**: Earned achievements
- **ActivityLog**: User activity tracking

## API Key Setup

### Gemini (Google)
1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Create a new API key
3. Add to bot via `/settings` → Set API Key → Gemini

### OpenAI
1. Go to [OpenAI Platform](https://platform.openai.com/api-keys)
2. Create a new API key
3. Add to bot via `/settings` → Set API Key → OpenAI

### Anthropic (Claude)
1. Go to [Anthropic Console](https://console.anthropic.com/settings/keys)
2. Create a new API key
3. Add to bot via `/settings` → Set API Key → Claude

## Deployment

### Docker (Recommended)

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

CMD ["npm", "start"]
```

### PM2

```bash
npm run build
pm2 start dist/index.js --name language-bot
```

### Webhook Setup (Production)

For production, use webhook mode by setting:
```env
USE_WEBHOOK=true
BOT_WEBHOOK_DOMAIN=https://your-domain.com
BOT_WEBHOOK_PORT=3000
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run type checking: `npm run typecheck`
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues and feature requests, please open an issue on GitHub.
