import { runAutoApply, AutomationConfig } from '../services/auto-apply.service';
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

export async function runScheduledTasks() {
  try {
    const tasks = await prisma.user.findMany({
      where: {
        preferences: {
          path: ['automation'],
          not: null,
        },
      },
    });

    for (const user of tasks) {
      const preferences = user.preferences as any;
      const automation = preferences?.automation;

      if (!automation?.enabled) continue;

      const config: AutomationConfig = {
        userId: user.id,
        keywords: automation.keywords,
        location: automation.location,
        matchThreshold: automation.matchThreshold || 70,
        autoTailorResume: automation.autoTailorResume ?? true,
        autoGenerateCoverLetter: automation.autoGenerateCoverLetter ?? true,
        useAIKeywords: automation.useAIKeywords ?? true,
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
                lastRun: new Date(),
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
  }
}

export async function triggerAutomation(
  userId: string,
  keywords?: string,
  location?: string,
  matchThreshold: number = 70,
  autoTailorResume: boolean = true,
  autoGenerateCoverLetter: boolean = true,
  useAIKeywords: boolean = true
) {
  const config: AutomationConfig = {
    userId,
    keywords,
    location,
    matchThreshold,
    autoTailorResume,
    autoGenerateCoverLetter,
    useAIKeywords,
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
