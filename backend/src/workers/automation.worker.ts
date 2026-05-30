/**
 * automation.worker.ts
 *
 * BullMQ worker that processes automation jobs from the 'automation' queue.
 * This replaces the old synchronous route handler so that:
 *  1. HTTP requests return 202 immediately (no timeout risk)
 *  2. Jobs persist in Redis and survive server restarts
 *  3. Progress events are emitted via Socket.io for real-time UI feedback
 */

import { Worker, Job } from 'bullmq';
import { connection } from '../queues/index';
import { triggerAutomation } from '../services/scheduler.service';
import { emitToUser } from '../services/websocket';

export interface AutomationJobData {
  userId: string;
  keywords?: string;
  location?: string;
  matchThreshold: number;
  autoTailorResume: boolean;
  autoGenerateCoverLetter: boolean;
  useAIKeywords: boolean;
  remote?: boolean;
}

export interface AutomationJobResult {
  totalJobs: number;
  applicationsCreated: number;
  sourceStats: Record<string, number>;
  extractedKeywords?: string[];
}

let automationWorker: Worker<AutomationJobData, AutomationJobResult> | null = null;

export function startAutomationWorker(): Worker<AutomationJobData, AutomationJobResult> {
  if (automationWorker) {
    return automationWorker;
  }

  automationWorker = new Worker<AutomationJobData, AutomationJobResult>(
    'automation',
    async (job: Job<AutomationJobData>) => {
      const { userId, keywords, location, matchThreshold,
        autoTailorResume, autoGenerateCoverLetter, useAIKeywords, remote } = job.data;

      const jobId = job.id ?? 'unknown';
      console.log(`[AutomationWorker] Starting job ${jobId} for user ${userId}`);

      // Emit progress: searching
      emitToUser(userId, 'automation:progress', {
        jobId,
        stage: 'searching',
        message: 'Searching for matching jobs…',
        progress: 10,
      });

      try {
        const result = await triggerAutomation(
          userId,
          keywords,
          location,
          matchThreshold,
          autoTailorResume,
          autoGenerateCoverLetter,
          useAIKeywords,
          remote
        );

        const summary: AutomationJobResult = {
          totalJobs: result.results.length,
          applicationsCreated: result.results.filter(r => r.applicationCreated).length,
          sourceStats: result.sourceStats ?? {},
          // extractedKeywords may be an object or array — normalize to string[]
          extractedKeywords: Array.isArray(result.extractedKeywords)
            ? result.extractedKeywords as unknown as string[]
            : result.extractedKeywords
              ? Object.values(result.extractedKeywords).flat().filter((v): v is string => typeof v === 'string')
              : undefined,
        };

        // Emit completion
        emitToUser(userId, 'automation:complete', { jobId, ...summary });

        console.log(`[AutomationWorker] Job ${jobId} completed — ${summary.applicationsCreated} applications created`);
        return summary;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[AutomationWorker] Job ${jobId} failed:`, message);

        emitToUser(userId, 'automation:error', { jobId, error: message });
        throw error; // re-throw so BullMQ marks job as failed and retries if configured
      }
    },
    {
      connection,
      concurrency: 2,
    }
  );

  automationWorker.on('completed', (job) => {
    console.log(`[AutomationWorker] Job ${job.id} completed`);
  });

  automationWorker.on('failed', (job, err) => {
    console.error(`[AutomationWorker] Job ${job?.id ?? 'unknown'} failed:`, err.message);
  });

  console.log('[AutomationWorker] Worker started, listening on queue: automation');
  return automationWorker;
}

export async function stopAutomationWorker(): Promise<void> {
  if (automationWorker) {
    await automationWorker.close();
    automationWorker = null;
    console.log('[AutomationWorker] Worker stopped');
  }
}
