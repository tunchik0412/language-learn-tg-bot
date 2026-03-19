import { prisma } from './database.js';
import { ACHIEVEMENT_DEFINITIONS, type UserStats } from '../types/index.js';

/**
 * Progress tracking service
 */
export class ProgressService {
  /**
   * Get user's overall stats
   */
  async getUserStats(telegramId: bigint): Promise<UserStats | null> {
    const user = await prisma.user.findUnique({
      where: { telegramId },
      include: {
        progress: true,
        lessons: {
          where: { completed: true },
        },
        vocabulary: true,
      },
    });

    if (!user) return null;

    const allProgress = user.progress;
    if (allProgress.length === 0) {
      return {
        totalLessons: 0,
        totalWords: 0,
        totalTime: 0,
        currentStreak: 0,
        longestStreak: 0,
        accuracy: 0,
        level: 1,
        xp: 0,
      };
    }

    // Aggregate across all language pairs
    const totalLessons = allProgress.reduce((sum, p) => sum + p.lessonsCompleted, 0);
    const totalWords = allProgress.reduce((sum, p) => sum + p.wordsLearned, 0);
    const totalTime = allProgress.reduce((sum, p) => sum + p.totalTime, 0);
    const totalCorrect = allProgress.reduce((sum, p) => sum + p.exercisesCorrect, 0);
    const totalExercises = allProgress.reduce((sum, p) => sum + p.exercisesTotal, 0);
    const totalXp = allProgress.reduce((sum, p) => sum + p.xp, 0);
    
    // Get the best streak across all languages
    const currentStreak = Math.max(...allProgress.map(p => p.streak), 0);
    const longestStreak = Math.max(...allProgress.map(p => p.longestStreak), 0);
    const maxLevel = Math.max(...allProgress.map(p => p.level), 1);

    const accuracy = totalExercises > 0 
      ? Math.round((totalCorrect / totalExercises) * 100) 
      : 0;

    return {
      totalLessons,
      totalWords,
      totalTime,
      currentStreak,
      longestStreak,
      accuracy,
      level: maxLevel,
      xp: totalXp,
    };
  }

  /**
   * Update progress after completing a lesson
   */
  async updateLessonProgress(
    telegramId: bigint,
    languagePair: string,
    lessonData: {
      score: number;
      wordsLearned: number;
      timeSpent: number;
      correctExercises: number;
      totalExercises: number;
    }
  ): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { telegramId },
    });

    if (!user) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get or create progress record
    const progress = await prisma.progress.upsert({
      where: {
        userId_languagePair: {
          userId: user.id,
          languagePair,
        },
      },
      update: {},
      create: {
        userId: user.id,
        languagePair,
      },
    });

    // Calculate streak
    let newStreak = progress.streak;
    const lastActive = progress.lastActive;
    
    if (lastActive) {
      const lastActiveDate = new Date(lastActive);
      lastActiveDate.setHours(0, 0, 0, 0);
      
      const daysDiff = Math.floor((today.getTime() - lastActiveDate.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysDiff === 0) {
        // Same day, no streak change
      } else if (daysDiff === 1) {
        // Consecutive day
        newStreak += 1;
      } else {
        // Streak broken
        newStreak = 1;
      }
    } else {
      newStreak = 1;
    }

    // Calculate XP
    const xpEarned = this.calculateXP(lessonData.score, lessonData.wordsLearned, newStreak);
    const newXp = progress.xp + xpEarned;
    const newLevel = this.calculateLevel(newXp);

    // Update progress
    await prisma.progress.update({
      where: {
        userId_languagePair: {
          userId: user.id,
          languagePair,
        },
      },
      data: {
        lessonsCompleted: { increment: 1 },
        wordsLearned: { increment: lessonData.wordsLearned },
        totalTime: { increment: lessonData.timeSpent },
        exercisesCorrect: { increment: lessonData.correctExercises },
        exercisesTotal: { increment: lessonData.totalExercises },
        streak: newStreak,
        longestStreak: Math.max(progress.longestStreak, newStreak),
        xp: newXp,
        level: newLevel,
        lastActive: new Date(),
      },
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: user.id,
        activityType: 'lesson_complete',
        metadata: {
          languagePair,
          score: lessonData.score,
          xpEarned,
          newStreak,
        },
      },
    });

    // Check for achievements
    await this.checkAchievements(user.id, progress.id, {
      streak: newStreak,
      lessonsCompleted: progress.lessonsCompleted + 1,
      wordsLearned: progress.wordsLearned + lessonData.wordsLearned,
      score: lessonData.score,
    });
  }

  /**
   * Calculate XP earned from a lesson
   */
  private calculateXP(score: number, wordsLearned: number, streak: number): number {
    const baseXP = 10;
    const scoreBonus = Math.floor(score / 10); // Up to 10 XP for 100%
    const wordBonus = wordsLearned * 2; // 2 XP per word
    const streakMultiplier = Math.min(1 + (streak * 0.1), 2); // Up to 2x at 10+ streak
    
    return Math.floor((baseXP + scoreBonus + wordBonus) * streakMultiplier);
  }

  /**
   * Calculate level from XP
   */
  private calculateLevel(xp: number): number {
    // Each level requires progressively more XP
    // Level 1: 0-100, Level 2: 100-250, Level 3: 250-500, etc.
    let level = 1;
    let xpNeeded = 100;
    let totalXpNeeded = 0;

    while (xp >= totalXpNeeded + xpNeeded) {
      totalXpNeeded += xpNeeded;
      level++;
      xpNeeded = Math.floor(xpNeeded * 1.5);
    }

    return level;
  }

  /**
   * Check and award achievements
   */
  private async checkAchievements(
    userId: string,
    progressId: string,
    data: {
      streak: number;
      lessonsCompleted: number;
      wordsLearned: number;
      score: number;
    }
  ): Promise<void> {
    const achievementsToCheck = [
      { type: 'first_lesson', condition: data.lessonsCompleted >= 1 },
      { type: 'streak_3', condition: data.streak >= 3 },
      { type: 'streak_7', condition: data.streak >= 7 },
      { type: 'streak_30', condition: data.streak >= 30 },
      { type: 'words_50', condition: data.wordsLearned >= 50 },
      { type: 'words_100', condition: data.wordsLearned >= 100 },
      { type: 'words_500', condition: data.wordsLearned >= 500 },
      { type: 'lessons_10', condition: data.lessonsCompleted >= 10 },
      { type: 'lessons_50', condition: data.lessonsCompleted >= 50 },
      { type: 'perfect_lesson', condition: data.score === 100 },
    ];

    for (const achievement of achievementsToCheck) {
      if (achievement.condition) {
        const def = ACHIEVEMENT_DEFINITIONS[achievement.type];
        if (def) {
          await this.awardAchievement(userId, achievement.type, def);
        }
      }
    }
  }

  /**
   * Award an achievement to a user
   */
  private async awardAchievement(
    userId: string,
    type: string,
    definition: { name: string; description: string; icon: string; xpReward: number }
  ): Promise<boolean> {
    try {
      await prisma.achievement.create({
        data: {
          userId,
          type,
          name: definition.name,
          description: definition.description,
          icon: definition.icon,
          xpReward: definition.xpReward,
        },
      });

      // Add XP reward
      await prisma.progress.updateMany({
        where: { userId },
        data: {
          xp: { increment: definition.xpReward },
        },
      });

      return true;
    } catch {
      // Achievement already exists (unique constraint)
      return false;
    }
  }

  /**
   * Get user's achievements
   */
  async getAchievements(telegramId: bigint): Promise<Array<{
    name: string;
    description: string;
    icon: string;
    earnedAt: Date;
  }>> {
    const user = await prisma.user.findUnique({
      where: { telegramId },
      include: {
        achievements: {
          orderBy: { earnedAt: 'desc' },
        },
      },
    });

    return user?.achievements.map(a => ({
      name: a.name,
      description: a.description,
      icon: a.icon || '🏆',
      earnedAt: a.earnedAt,
    })) || [];
  }

  /**
   * Get progress for a specific language pair
   */
  async getLanguageProgress(telegramId: bigint, languagePair: string) {
    const user = await prisma.user.findUnique({
      where: { telegramId },
    });

    if (!user) return null;

    return prisma.progress.findUnique({
      where: {
        userId_languagePair: {
          userId: user.id,
          languagePair,
        },
      },
    });
  }

  /**
   * Update learning streak (call daily from scheduler)
   */
  async updateStreaks(): Promise<void> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    // Reset streaks for users who didn't learn yesterday
    await prisma.progress.updateMany({
      where: {
        lastActive: {
          lt: yesterday,
        },
        streak: {
          gt: 0,
        },
      },
      data: {
        streak: 0,
      },
    });
  }
}

export const progressService = new ProgressService();
