import { runAutoApply, AutomationConfig } from '../services/auto-apply.service';
import { Prisma } from '@prisma/client';
import prisma from '../prisma/index';

export interface ScheduledTask {
  id: string;
  userId: string;
  keywords: string;
  location?: string;
  matchThreshold: number;
  autoTailorResume: boolean;
  autoGenerateCoverLetter: boolean;
  frequency: 'hourly' | 'daily' | 'weekly';
  enabled: boolean;
  lastRun?: Date;
  nextRun?: Date;
  status: 'idle' | 'running' | 'completed' | 'error';
  lastResults?: any;
  lastError?: string;
}

let schedulerInterval: NodeJS.Timeout | null = null;
export let isSchedulerRunning = false;

export async function initScheduler() {
  console.log('Initializing job search scheduler...');
  
  scheduleNextRun();

  const intervalMs = getSchedulerIntervalMs();
  schedulerInterval = setInterval(async () => {
    try {
      await runScheduledTasks();
    } catch (error) {
      console.error('Scheduler tick error:', error);
    }
  }, intervalMs);
  
  console.log(`Scheduler initialized. Running every ${Math.round(intervalMs / 60000)} minutes.`);
}

function scheduleNextRun() {
  const now = new Date();
  const nextHour = new Date(now);
  nextHour.setHours(nextHour.getHours() + 1);
  nextHour.setMinutes(0);
  nextHour.setSeconds(0);
  return nextHour;
}

function getSchedulerIntervalMs(): number {
  const raw = process.env.SCHEDULER_INTERVAL_MINUTES;
  const parsed = raw ? parseInt(raw, 10) : 60;
  const safeMinutes = Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
  return safeMinutes * 60 * 1000;
}

function getFrequencyMs(frequency: unknown): number {
  if (frequency === 'hourly') {
    return 60 * 60 * 1000;
  }
  if (frequency === 'weekly') {
    return 7 * 24 * 60 * 60 * 1000;
  }
  return 24 * 60 * 60 * 1000;
}

export function shouldRunAutomation(automation: Record<string, unknown>, now: Date): boolean {
  const nextRunRaw = automation.nextRun;
  if (typeof nextRunRaw === 'string' || nextRunRaw instanceof Date) {
    const nextRun = new Date(nextRunRaw);
    if (!Number.isNaN(nextRun.getTime())) {
      return now >= nextRun;
    }
  }

  const lastRunRaw = automation.lastRun;
  if (typeof lastRunRaw === 'string' || lastRunRaw instanceof Date) {
    const lastRun = new Date(lastRunRaw);
    if (!Number.isNaN(lastRun.getTime())) {
      return now.getTime() - lastRun.getTime() >= getFrequencyMs(automation.frequency);
    }
  }

  return true;
}

export async function runScheduledTasks() {
  if (isSchedulerRunning) {
    console.warn('Scheduler tick skipped: previous run still in progress');
    return;
  }

  isSchedulerRunning = true;
  try {
    const now = new Date();
    const tasks = await prisma.user.findMany({
      where: {
        preferences: {
          path: ['automation'],
          not: Prisma.AnyNull,
        },
      },
    });

    for (const user of tasks) {
      const preferences = user.preferences as any;
      const automation = preferences?.automation as Record<string, unknown> | undefined;

      if (!automation?.enabled) continue;
      if (!shouldRunAutomation(automation, now)) continue;

      const config: AutomationConfig = {
        userId: user.id,
        keywords: typeof automation.keywords === 'string' ? automation.keywords : undefined,
        location: typeof automation.location === 'string' ? automation.location : undefined,
        matchThreshold: typeof automation.matchThreshold === 'number' ? automation.matchThreshold : 70,
        autoTailorResume: typeof automation.autoTailorResume === 'boolean' ? automation.autoTailorResume : true,
        autoGenerateCoverLetter: typeof automation.autoGenerateCoverLetter === 'boolean' ? automation.autoGenerateCoverLetter : true,
        useAIKeywords: typeof automation.useAIKeywords === 'boolean' ? automation.useAIKeywords : true,
        remote: typeof automation.remote === 'boolean' ? automation.remote : true,
      };

      try {
        console.log(`Running automation for user ${user.email}`);
        const automationResult = await runAutoApply(config);
        const results = automationResult.results;
        
        await prisma.user.update({
          where: { id: user.id },
          data: {
            preferences: {
              ...preferences,
              automation: {
                ...automation,
                lastRun: now,
                nextRun: new Date(now.getTime() + getFrequencyMs(automation.frequency)),
                lastResults: results,
                status: 'completed',
                extractedKeywords: automationResult.extractedKeywords,
              },
            },
          },
        });

        console.log(`Automation completed for ${user.email}. ${results.filter(r => r.applicationCreated).length} applications created.`);
      } catch (error) {
        console.error(`Automation error for ${user.email}:`, error);
        await prisma.user.update({
          where: { id: user.id },
          data: {
            preferences: {
              ...preferences,
              automation: {
                ...automation,
                status: 'error',
                lastError: String(error),
              },
            },
          },
        });
      }
    }
  } catch (error) {
    console.error('Scheduler error:', error);
  } finally {
    isSchedulerRunning = false;
  }
}

export async function triggerAutomation(
  userId: string,
  keywords?: string,
  location?: string,
  matchThreshold: number = 70,
  autoTailorResume: boolean = true,
  autoGenerateCoverLetter: boolean = true,
  useAIKeywords: boolean = true,
  remote?: boolean
) {
  const config: AutomationConfig = {
    userId,
    keywords,
    location,
    matchThreshold,
    autoTailorResume,
    autoGenerateCoverLetter,
    useAIKeywords,
    remote,
  };

  return runAutoApply(config);
}

export function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('Scheduler stopped');
  }
}
