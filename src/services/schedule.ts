import cron from 'node-cron';
import { prisma } from './database.js';
import { progressService } from './progress.js';
import type { ScheduleFrequency, LessonDuration, LessonType } from '../types/index.js';

interface ScheduledTask {
  scheduleId: string;
  cronTask: cron.ScheduledTask;
}

/**
 * Schedule service for managing lesson reminders
 */
export class ScheduleService {
  private activeTasks: Map<string, ScheduledTask> = new Map();
  private notifyCallback: ((telegramId: bigint, schedule: ScheduleData) => Promise<void>) | null = null;

  /**
   * Set the notification callback (called when a schedule triggers)
   */
  setNotifyCallback(callback: (telegramId: bigint, schedule: ScheduleData) => Promise<void>): void {
    this.notifyCallback = callback;
  }

  /**
   * Create or update a schedule
   */
  async createSchedule(
    telegramId: bigint,
    config: {
      languagePair: string;
      frequency: ScheduleFrequency;
      daysOfWeek?: number[]; // 0-6, Sunday = 0
      preferredTime: string; // HH:mm
      lessonDuration: LessonDuration;
      lessonTypes?: LessonType[];
    }
  ): Promise<string> {
    const user = await prisma.user.findUnique({
      where: { telegramId },
    });

    if (!user) throw new Error('User not found');

    // Determine days based on frequency
    let daysOfWeek = config.daysOfWeek;
    if (config.frequency === 'daily') {
      daysOfWeek = [0, 1, 2, 3, 4, 5, 6];
    } else if (config.frequency === 'weekdays') {
      daysOfWeek = [1, 2, 3, 4, 5];
    } else if (config.frequency === 'weekends') {
      daysOfWeek = [0, 6];
    }

    const schedule = await prisma.schedule.create({
      data: {
        userId: user.id,
        languagePair: config.languagePair,
        frequency: config.frequency,
        daysOfWeek: daysOfWeek || [],
        preferredTime: config.preferredTime,
        lessonDuration: config.lessonDuration,
        lessonTypes: config.lessonTypes ?? undefined,
        active: true,
      },
    });

    // Start the cron job
    await this.startSchedule(schedule.id, telegramId, user.timezone);

    return schedule.id;
  }

  /**
   * Start a schedule's cron job
   */
  private async startSchedule(
    scheduleId: string,
    telegramId: bigint,
    timezone: string
  ): Promise<void> {
    const schedule = await prisma.schedule.findUnique({
      where: { id: scheduleId },
      include: { user: true },
    });

    if (!schedule || !schedule.active) return;

    // Stop existing task if any
    this.stopSchedule(scheduleId);

    // Parse time
    const [hours, minutes] = schedule.preferredTime.split(':').map(Number);
    const daysOfWeek = schedule.daysOfWeek as number[];

    // Build cron expression: minute hour * * dayOfWeek
    const dayExpr = daysOfWeek.length === 7 ? '*' : daysOfWeek.join(',');
    const cronExpr = `${minutes} ${hours} * * ${dayExpr}`;

    const task = cron.schedule(
      cronExpr,
      async () => {
        // Check if still active and not paused
        const currentSchedule = await prisma.schedule.findUnique({
          where: { id: scheduleId },
        });

        if (!currentSchedule || !currentSchedule.active) {
          this.stopSchedule(scheduleId);
          return;
        }

        if (currentSchedule.pausedUntil && currentSchedule.pausedUntil > new Date()) {
          return;
        }

        // Trigger notification
        if (this.notifyCallback) {
          await this.notifyCallback(telegramId, {
            id: schedule.id,
            languagePair: schedule.languagePair,
            lessonDuration: schedule.lessonDuration as LessonDuration,
            lessonTypes: (schedule.lessonTypes as LessonType[]) || undefined,
          });
        }

        // Update last triggered
        await prisma.schedule.update({
          where: { id: scheduleId },
          data: { lastTriggered: new Date() },
        });
      },
      {
        timezone: this.normalizeTimezone(timezone),
      }
    );

    this.activeTasks.set(scheduleId, { scheduleId, cronTask: task });
    task.start();
  }

  /**
   * Stop a schedule's cron job
   */
  stopSchedule(scheduleId: string): void {
    const task = this.activeTasks.get(scheduleId);
    if (task) {
      task.cronTask.stop();
      this.activeTasks.delete(scheduleId);
    }
  }

  /**
   * Pause a schedule
   */
  async pauseSchedule(scheduleId: string, untilDate?: Date): Promise<void> {
    const pausedUntil = untilDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // Default: 1 week

    await prisma.schedule.update({
      where: { id: scheduleId },
      data: { pausedUntil },
    });
  }

  /**
   * Resume a schedule
   */
  async resumeSchedule(scheduleId: string): Promise<void> {
    const schedule = await prisma.schedule.update({
      where: { id: scheduleId },
      data: { pausedUntil: null },
      include: { user: true },
    });

    // Restart cron job
    await this.startSchedule(scheduleId, schedule.user.telegramId, schedule.user.timezone);
  }

  /**
   * Deactivate a schedule
   */
  async deactivateSchedule(scheduleId: string): Promise<void> {
    await prisma.schedule.update({
      where: { id: scheduleId },
      data: { active: false },
    });

    this.stopSchedule(scheduleId);
  }

  /**
   * Reactivate a schedule
   */
  async activateSchedule(scheduleId: string): Promise<void> {
    const schedule = await prisma.schedule.update({
      where: { id: scheduleId },
      data: { active: true },
      include: { user: true },
    });

    await this.startSchedule(scheduleId, schedule.user.telegramId, schedule.user.timezone);
  }

  /**
   * Update schedule settings
   */
  async updateSchedule(
    scheduleId: string,
    updates: Partial<{
      frequency: ScheduleFrequency;
      daysOfWeek: number[];
      preferredTime: string;
      lessonDuration: LessonDuration;
      lessonTypes: LessonType[];
    }>
  ): Promise<void> {
    const schedule = await prisma.schedule.update({
      where: { id: scheduleId },
      data: {
        ...updates,
        daysOfWeek: updates.daysOfWeek ?? undefined,
        lessonTypes: updates.lessonTypes ?? undefined,
      },
      include: { user: true },
    });

    // Restart with new settings
    await this.startSchedule(scheduleId, schedule.user.telegramId, schedule.user.timezone);
  }

  /**
   * Get user's schedules
   */
  async getUserSchedules(telegramId: bigint) {
    const user = await prisma.user.findUnique({
      where: { telegramId },
    });

    if (!user) return [];

    return prisma.schedule.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Delete a schedule
   */
  async deleteSchedule(scheduleId: string): Promise<void> {
    this.stopSchedule(scheduleId);
    await prisma.schedule.delete({
      where: { id: scheduleId },
    });
  }

  /**
   * Initialize all active schedules on startup
   */
  async initializeSchedules(): Promise<void> {
    const activeSchedules = await prisma.schedule.findMany({
      where: { active: true },
      include: { user: true },
    });

    console.log(`Initializing ${activeSchedules.length} active schedules...`);

    for (const schedule of activeSchedules) {
      await this.startSchedule(
        schedule.id,
        schedule.user.telegramId,
        schedule.user.timezone
      );
    }

    console.log('Schedules initialized');
  }

  /**
   * Schedule daily tasks (streak reset, etc.)
   */
  startDailyTasks(): void {
    // Reset streaks at midnight UTC
    cron.schedule('0 0 * * *', async () => {
      console.log('Running daily streak update...');
      await progressService.updateStreaks();
    });
  }

  /**
   * Suggest optimal learning times based on user activity
   */
  async suggestOptimalTimes(telegramId: bigint): Promise<string[]> {
    const user = await prisma.user.findUnique({
      where: { telegramId },
    });

    if (!user) return ['09:00', '18:00'];

    // Get activity logs from last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const activities = await prisma.activityLog.findMany({
      where: {
        userId: user.id,
        timestamp: { gte: thirtyDaysAgo },
      },
      select: { timestamp: true },
    });

    if (activities.length < 10) {
      // Not enough data, return defaults
      return ['09:00', '12:00', '18:00', '21:00'];
    }

    // Group by hour
    const hourCounts = new Map<number, number>();
    for (const activity of activities) {
      const hour = activity.timestamp.getHours();
      hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
    }

    // Sort by frequency and get top 4 hours
    const sortedHours = Array.from(hourCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([hour]) => `${hour.toString().padStart(2, '0')}:00`);

    return sortedHours.length > 0 ? sortedHours : ['09:00', '18:00'];
  }

  /**
   * Normalize timezone string
   */
  private normalizeTimezone(timezone: string): string {
    // Handle UTC offsets
    if (timezone.startsWith('UTC')) {
      const offset = timezone.replace('UTC', '');
      if (offset === '' || offset === '+0' || offset === '-0') {
        return 'UTC';
      }
      // node-cron uses IANA timezones, convert UTC+X to Etc/GMT-X (note the sign flip)
      const sign = offset.startsWith('+') ? '-' : '+';
      const hours = Math.abs(parseInt(offset));
      return `Etc/GMT${sign}${hours}`;
    }
    return timezone;
  }

  /**
   * Get schedule status
   */
  getActiveScheduleCount(): number {
    return this.activeTasks.size;
  }
}

export interface ScheduleData {
  id: string;
  languagePair: string;
  lessonDuration: LessonDuration;
  lessonTypes?: LessonType[];
}

export const scheduleService = new ScheduleService();
