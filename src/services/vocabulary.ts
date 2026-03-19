import { prisma } from './database.js';

/**
 * Vocabulary management with spaced repetition
 */
export class VocabularyService {
  /**
   * Add a word to user's vocabulary
   */
  async addWord(
    telegramId: bigint,
    word: {
      word: string;
      translation: string;
      languagePair: string;
      pronunciation?: string;
      partOfSpeech?: string;
      exampleSentence?: string;
      exampleTranslation?: string;
      context?: string;
      difficulty?: number;
    }
  ): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { telegramId },
    });

    if (!user) throw new Error('User not found');

    await prisma.vocabulary.upsert({
      where: {
        userId_word_languagePair: {
          userId: user.id,
          word: word.word,
          languagePair: word.languagePair,
        },
      },
      update: {
        translation: word.translation,
        pronunciation: word.pronunciation,
        partOfSpeech: word.partOfSpeech,
        exampleSentence: word.exampleSentence,
        exampleTranslation: word.exampleTranslation,
        context: word.context,
        difficulty: word.difficulty,
      },
      create: {
        userId: user.id,
        word: word.word,
        translation: word.translation,
        languagePair: word.languagePair,
        pronunciation: word.pronunciation,
        partOfSpeech: word.partOfSpeech,
        exampleSentence: word.exampleSentence,
        exampleTranslation: word.exampleTranslation,
        context: word.context,
        difficulty: word.difficulty || 1,
        nextReviewDate: new Date(), // Due immediately for first review
      },
    });
  }

  /**
   * Get words due for review (spaced repetition)
   */
  async getDueForReview(
    telegramId: bigint,
    languagePair?: string,
    limit = 20
  ) {
    const user = await prisma.user.findUnique({
      where: { telegramId },
    });

    if (!user) return [];

    const now = new Date();

    return prisma.vocabulary.findMany({
      where: {
        userId: user.id,
        ...(languagePair && { languagePair }),
        OR: [
          { nextReviewDate: null },
          { nextReviewDate: { lte: now } },
        ],
      },
      orderBy: [
        { nextReviewDate: 'asc' },
        { mastery: 'asc' },
      ],
      take: limit,
    });
  }

  /**
   * Update word after review using SM-2 algorithm
   */
  async updateReview(
    vocabularyId: string,
    quality: number // 0-5: 0=complete blackout, 5=perfect response
  ): Promise<void> {
    const vocab = await prisma.vocabulary.findUnique({
      where: { id: vocabularyId },
    });

    if (!vocab) return;

    // SM-2 algorithm calculations
    const isCorrect = quality >= 3;
    const reviewCount = vocab.reviewCount + 1;
    const correctCount = vocab.correctCount + (isCorrect ? 1 : 0);
    const incorrectCount = vocab.incorrectCount + (isCorrect ? 0 : 1);

    // Calculate new mastery (0-100)
    let mastery = vocab.mastery;
    if (isCorrect) {
      // Increase mastery based on quality
      mastery = Math.min(100, mastery + (quality - 2) * 10);
    } else {
      // Decrease mastery on failure
      mastery = Math.max(0, mastery - 20);
    }

    // Calculate next review interval
    const interval = this.calculateInterval(reviewCount, mastery, quality);
    const nextReviewDate = new Date();
    nextReviewDate.setDate(nextReviewDate.getDate() + interval);

    await prisma.vocabulary.update({
      where: { id: vocabularyId },
      data: {
        mastery,
        reviewCount,
        correctCount,
        incorrectCount,
        nextReviewDate,
      },
    });
  }

  /**
   * Calculate review interval using modified SM-2
   */
  private calculateInterval(
    reviewCount: number,
    mastery: number,
    quality: number
  ): number {
    if (quality < 3) {
      // Failed - review again soon
      return 1;
    }

    if (reviewCount === 1) {
      return 1;
    } else if (reviewCount === 2) {
      return 3;
    } else {
      // Interval increases with mastery
      const masteryFactor = 1 + (mastery / 100);
      const qualityFactor = 0.8 + (quality * 0.1);
      const baseInterval = Math.pow(2, reviewCount - 2);
      return Math.round(baseInterval * masteryFactor * qualityFactor);
    }
  }

  /**
   * Get user's vocabulary for a language pair
   */
  async getVocabulary(
    telegramId: bigint,
    languagePair: string,
    options?: {
      limit?: number;
      offset?: number;
      sortBy?: 'createdAt' | 'mastery' | 'word';
      sortOrder?: 'asc' | 'desc';
    }
  ) {
    const user = await prisma.user.findUnique({
      where: { telegramId },
    });

    if (!user) return { words: [], total: 0 };

    const [words, total] = await Promise.all([
      prisma.vocabulary.findMany({
        where: {
          userId: user.id,
          languagePair,
        },
        orderBy: {
          [options?.sortBy || 'createdAt']: options?.sortOrder || 'desc',
        },
        take: options?.limit || 50,
        skip: options?.offset || 0,
      }),
      prisma.vocabulary.count({
        where: {
          userId: user.id,
          languagePair,
        },
      }),
    ]);

    return { words, total };
  }

  /**
   * Get vocabulary statistics
   */
  async getStats(telegramId: bigint, languagePair?: string) {
    const user = await prisma.user.findUnique({
      where: { telegramId },
    });

    if (!user) return null;

    const where = {
      userId: user.id,
      ...(languagePair && { languagePair }),
    };

    const [total, mastered, learning, dueNow] = await Promise.all([
      prisma.vocabulary.count({ where }),
      prisma.vocabulary.count({ where: { ...where, mastery: { gte: 80 } } }),
      prisma.vocabulary.count({ where: { ...where, mastery: { lt: 80, gt: 0 } } }),
      prisma.vocabulary.count({
        where: {
          ...where,
          OR: [
            { nextReviewDate: null },
            { nextReviewDate: { lte: new Date() } },
          ],
        },
      }),
    ]);

    return {
      total,
      mastered,
      learning,
      new: total - mastered - learning,
      dueForReview: dueNow,
    };
  }

  /**
   * Delete a word from vocabulary
   */
  async deleteWord(telegramId: bigint, vocabularyId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { telegramId },
    });

    if (!user) return false;

    const vocab = await prisma.vocabulary.findFirst({
      where: {
        id: vocabularyId,
        userId: user.id,
      },
    });

    if (!vocab) return false;

    await prisma.vocabulary.delete({
      where: { id: vocabularyId },
    });

    return true;
  }

  /**
   * Search vocabulary
   */
  async search(
    telegramId: bigint,
    query: string,
    languagePair?: string
  ) {
    const user = await prisma.user.findUnique({
      where: { telegramId },
    });

    if (!user) return [];

    return prisma.vocabulary.findMany({
      where: {
        userId: user.id,
        ...(languagePair && { languagePair }),
        OR: [
          { word: { contains: query, mode: 'insensitive' } },
          { translation: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: 20,
    });
  }
}

export const vocabularyService = new VocabularyService();
