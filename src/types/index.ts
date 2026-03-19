import type { User, Lesson, Exercise, Progress, Vocabulary, Schedule, Achievement } from '@prisma/client';
import type { Context } from 'telegraf';

// Re-export Prisma types
export type { User, Lesson, Exercise, Progress, Vocabulary, Schedule, Achievement };

// AI Provider Types
export type AIProvider = 'gemini' | 'openai' | 'claude';

export interface AITokens {
  gemini?: string;
  openai?: string;
  claude?: string;
}

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIResponse {
  content: string;
  provider: AIProvider;
  tokensUsed?: number;
}

// Lesson Types
export type LessonType = 
  | 'vocabulary'
  | 'grammar'
  | 'conversation'
  | 'reading'
  | 'pronunciation'
  | 'culture';

export type LessonDuration = 'quick' | 'standard' | 'deep';

export type ProficiencyLevel = 'beginner' | 'intermediate' | 'advanced';

export interface LessonContent {
  introduction: string;
  sections: LessonSection[];
  summary?: string;
  tips?: string[];
}

export interface LessonSection {
  title: string;
  content: string;
  examples?: Example[];
}

export interface Example {
  original: string;
  translation: string;
  pronunciation?: string;
  notes?: string;
}

// Exercise Types
export type ExerciseType = 
  | 'multiple_choice'
  | 'fill_blank'
  | 'translation'
  | 'matching'
  | 'free_response'
  | 'listening'
  | 'speaking';

export interface ExerciseData {
  type: ExerciseType;
  question: string;
  options?: string[];
  correctAnswer: string;
  explanation?: string;
  hints?: string[];
}

// Schedule Types
export type ScheduleFrequency = 'daily' | 'weekdays' | 'weekends' | 'custom';

export interface ScheduleConfig {
  frequency: ScheduleFrequency;
  daysOfWeek?: number[]; // 0-6, Sunday = 0
  preferredTime: string; // HH:mm
  lessonDuration: LessonDuration;
  lessonTypes?: LessonType[];
}

// Conversation Types
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  translation?: string;
  timestamp?: Date;
}

export interface ConversationScenario {
  id: string;
  name: string;
  description: string;
  difficulty: number;
  context: string;
}

// Progress & Analytics Types
export interface UserStats {
  totalLessons: number;
  totalWords: number;
  totalTime: number;
  currentStreak: number;
  longestStreak: number;
  accuracy: number;
  level: number;
  xp: number;
}

export interface DailyProgress {
  date: Date;
  lessonsCompleted: number;
  wordsLearned: number;
  timeSpent: number;
  correctExercises: number;
  totalExercises: number;
}

// Bot Context Types
export interface BotSession {
  userId?: string;
  currentLesson?: string;
  currentExercise?: number;
  awaitingInput?: 'api_token' | 'timezone' | 'schedule_time' | 'answer';
  tempData?: Record<string, unknown>;
}

export interface BotContext extends Context {
  session?: BotSession;
}

// Language Data
export interface LanguagePair {
  native: string;
  nativeCode: string;
  target: string;
  targetCode: string;
}

// Supported languages
export const SUPPORTED_LANGUAGES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  uk: 'Ukrainian',
  ja: 'Japanese',
  zh: 'Chinese',
  ko: 'Korean',
  ar: 'Arabic',
  hi: 'Hindi',
  nl: 'Dutch',
  sv: 'Swedish',
  pl: 'Polish',
  tr: 'Turkish',
};

// Achievement definitions
export const ACHIEVEMENT_DEFINITIONS: Record<string, { name: string; description: string; icon: string; xpReward: number }> = {
  first_lesson: { name: 'First Steps', description: 'Completed your first lesson', icon: '🎓', xpReward: 50 },
  streak_3: { name: 'Getting Started', description: '3 day learning streak', icon: '🔥', xpReward: 100 },
  streak_7: { name: 'Week Warrior', description: '7 day learning streak', icon: '💪', xpReward: 250 },
  streak_30: { name: 'Monthly Master', description: '30 day learning streak', icon: '🏆', xpReward: 1000 },
  words_50: { name: 'Vocabulary Builder', description: 'Learned 50 words', icon: '📚', xpReward: 150 },
  words_100: { name: 'Word Wizard', description: 'Learned 100 words', icon: '✨', xpReward: 300 },
  words_500: { name: 'Lexicon Legend', description: 'Learned 500 words', icon: '🌟', xpReward: 1500 },
  lessons_10: { name: 'Dedicated Learner', description: 'Completed 10 lessons', icon: '📖', xpReward: 200 },
  lessons_50: { name: 'Knowledge Seeker', description: 'Completed 50 lessons', icon: '🎯', xpReward: 750 },
  perfect_lesson: { name: 'Perfect Score', description: 'Got 100% on a lesson', icon: '💯', xpReward: 100 },
  speed_learner: { name: 'Speed Learner', description: 'Completed 5 lessons in one day', icon: '⚡', xpReward: 200 },
  conversation_master: { name: 'Conversation Master', description: 'Completed 10 conversation lessons', icon: '💬', xpReward: 300 },
};

// Error Types
export class AIProviderError extends Error {
  constructor(
    message: string,
    public provider: AIProvider,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}

export class TokenError extends Error {
  constructor(message: string, public provider: AIProvider) {
    super(message);
    this.name = 'TokenError';
  }
}
