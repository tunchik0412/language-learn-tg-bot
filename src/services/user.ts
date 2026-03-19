import { prisma } from './database.js';
import type { User } from '@prisma/client';

/**
 * User service for managing user data
 */
export class UserService {
  /**
   * Get or create a user from Telegram data
   */
  async getOrCreateUser(telegramId: bigint, userData: {
    username?: string;
    firstName?: string;
    lastName?: string;
  }): Promise<User> {
    const user = await prisma.user.upsert({
      where: { telegramId },
      update: {
        username: userData.username,
        firstName: userData.firstName,
        lastName: userData.lastName,
      },
      create: {
        telegramId,
        username: userData.username,
        firstName: userData.firstName,
        lastName: userData.lastName,
      },
    });

    return user;
  }

  /**
   * Get a user by Telegram ID
   */
  async getUserByTelegramId(telegramId: bigint): Promise<User | null> {
    return prisma.user.findUnique({
      where: { telegramId },
    });
  }

  /**
   * Update user timezone
   */
  async updateTimezone(telegramId: bigint, timezone: string): Promise<User> {
    return prisma.user.update({
      where: { telegramId },
      data: { timezone },
    });
  }

  /**
   * Get user with all related data
   */
  async getUserWithData(telegramId: bigint): Promise<User & {
    languages: Array<{ targetLanguage: string; nativeLanguage: string; proficiencyLevel: string }>;
    progress: Array<{ languagePair: string; wordsLearned: number; lessonsCompleted: number; streak: number }>;
  } | null> {
    return prisma.user.findUnique({
      where: { telegramId },
      include: {
        languages: {
          select: {
            targetLanguage: true,
            nativeLanguage: true,
            proficiencyLevel: true,
          },
        },
        progress: {
          select: {
            languagePair: true,
            wordsLearned: true,
            lessonsCompleted: true,
            streak: true,
          },
        },
      },
    });
  }

  /**
   * Set user's language learning preferences
   */
  async setLanguage(
    telegramId: bigint,
    targetLanguage: string,
    nativeLanguage: string,
    proficiencyLevel: string
  ): Promise<void> {
    const user = await this.getUserByTelegramId(telegramId);
    if (!user) throw new Error('User not found');

    await prisma.userLanguage.upsert({
      where: {
        userId_targetLanguage: {
          userId: user.id,
          targetLanguage,
        },
      },
      update: {
        nativeLanguage,
        proficiencyLevel,
        isActive: true,
      },
      create: {
        userId: user.id,
        targetLanguage,
        nativeLanguage,
        proficiencyLevel,
      },
    });

    // Initialize progress for this language pair
    const languagePair = `${nativeLanguage}-${targetLanguage}`;
    await prisma.progress.upsert({
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
  }

  /**
   * Get user's active languages
   */
  async getActiveLanguages(telegramId: bigint): Promise<Array<{
    targetLanguage: string;
    nativeLanguage: string;
    proficiencyLevel: string;
  }>> {
    const user = await this.getUserByTelegramId(telegramId);
    if (!user) return [];

    return prisma.userLanguage.findMany({
      where: {
        userId: user.id,
        isActive: true,
      },
      select: {
        targetLanguage: true,
        nativeLanguage: true,
        proficiencyLevel: true,
      },
    });
  }

  /**
   * Remove a language from user's learning list
   */
  async removeLanguage(telegramId: bigint, targetLanguage: string): Promise<void> {
    const user = await this.getUserByTelegramId(telegramId);
    if (!user) return;

    await prisma.userLanguage.updateMany({
      where: {
        userId: user.id,
        targetLanguage,
      },
      data: {
        isActive: false,
      },
    });
  }
}

export const userService = new UserService();
