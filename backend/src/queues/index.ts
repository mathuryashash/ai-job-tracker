import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { analyzeResume, generateCoverLetter } from '../services/ai.service';
import prisma from '../prisma/index';
import { NotificationService } from '../services/notification.service';

const connection = new IORedis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null,
});

export const resumeAnalysisQueue = new Queue('resume-analysis', { connection });
export const coverLetterQueue = new Queue('cover-letter-generation', { connection });
export const automationQueue = new Queue('automation', { connection });

let analysisWorker: Worker | null = null;
let coverLetterWorker: Worker | null = null;

export async function initQueues() {
  console.log('BullMQ queues initialized');

  analysisWorker = new Worker('resume-analysis', async (job) => {
    const { resumeId, userId, jobDescription } = job.data;
    console.log(`[Worker] Analyzing resume ${resumeId}`);

    // Find the existing "processing" analysis for this resume
    const existingAnalysis = await prisma.resumeAnalysis.findFirst({
      where: {
        resumeId,
        status: 'processing',
      },
      orderBy: { createdAt: 'desc' },
    });

    const resume = await prisma.resume.findUnique({ where: { id: resumeId } });
    if (!resume?.extractedText) {
      throw new Error(`Resume ${resumeId} not found or has no extracted text`);
    }

    const result = await analyzeResume(resume.extractedText, jobDescription);

    if (existingAnalysis) {
      // Update existing analysis
      await prisma.resumeAnalysis.update({
        where: { id: existingAnalysis.id },
        data: {
          matchPercentage: result.matchPercentage,
          skillsRadar: result.skillsRadar,
          missingKeywords: result.missingKeywords,
          suggestions: result.suggestions,
          status: 'completed',
        },
      });
    } else {
      // Fallback: create new if no existing
      await prisma.resumeAnalysis.create({
        data: {
          resumeId,
          jobDescription,
          matchPercentage: result.matchPercentage,
          skillsRadar: result.skillsRadar,
          missingKeywords: result.missingKeywords,
          suggestions: result.suggestions,
          status: 'completed',
        },
      });
    }

    return { success: true, matchPercentage: result.matchPercentage };
  }, {
    connection,
    concurrency: 2,
  });

  coverLetterWorker = new Worker('cover-letter-generation', async (job) => {
    const { userId, resumeId, applicationId, jobDescription } = job.data;
    console.log(`[Worker] Generating cover letter for application ${applicationId}`);

    const resume = await prisma.resume.findUnique({ where: { id: resumeId } });
    if (!resume?.extractedText) {
      throw new Error(`Resume ${resumeId} not found`);
    }

    const application = await prisma.jobApplication.findUnique({
      where: { id: applicationId },
    });
    if (!application) {
      throw new Error(`Application ${applicationId} not found`);
    }

    const content = await generateCoverLetter(
      resume.extractedText,
      jobDescription,
      application.companyName,
      application.positionTitle
    );

    const coverLetter = await prisma.coverLetter.create({
      data: {
        userId,
        applicationId,
        content,
        jobDescription,
      },
    });

    await prisma.jobApplication.update({
      where: { id: applicationId },
      data: { coverLetterId: coverLetter.id },
    });

    return { success: true, coverLetterId: coverLetter.id };
  }, {
    connection,
    concurrency: 2,
  });

  analysisWorker.on('completed', (job) => {
    console.log(`Job ${job.id} completed`);
  });

   analysisWorker.on('failed', (job, err) => {
      console.error(`Job ${job?.id || 'unknown'} failed:`, err.message);
      // Notify user of failed job
      if (job) {
        NotificationService.handleFailedJob(job, err);
      }
    });

  coverLetterWorker.on('failed', (job, err) => {
    console.error(`Cover letter job ${job?.id} failed:`, err.message);
  });

  console.log('[Queues] All workers initialized');
}

export async function addResumeAnalysisJob(data: {
  resumeId: string;
  userId: string;
  jobDescription?: string;
}) {
  return resumeAnalysisQueue.add('analyze-resume', data, buildJobOptions(data.resumeId));
}

export async function addCoverLetterJob(data: {
  userId: string;
  resumeId: string;
  applicationId: string;
  jobDescription: string;
}) {
  return coverLetterQueue.add('generate-cover-letter', data, buildJobOptions(data.applicationId));
}

export { connection };

function buildJobOptions(dedupeKey: string) {
  return {
    jobId: dedupeKey,
    attempts: 3,
    backoff: {
      type: 'exponential' as const,
      delay: 2000,
    },
    removeOnComplete: 100,
    removeOnFail: 200,
  };
}
