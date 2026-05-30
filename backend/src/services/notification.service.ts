import { Job } from 'bullmq';
import prisma from '../prisma/index';
import { Prisma } from '@prisma/client';

export interface NotificationData {
   userId: string;
   title: string;
   message: string;
   type: 'info' | 'warning' | 'error' | 'success';
   relatedId?: string; // ID of related entity (job, application, etc.)
   metadata?: Prisma.InputJsonValue;
}

export class NotificationService {
  /**
   * Create a notification for a user
   */
  static async createNotification(data: NotificationData) {
    try {
      await prisma.notification.create({
        data: {
          userId: data.userId,
          title: data.title,
          message: data.message,
          type: data.type,
          relatedId: data.relatedId,
          metadata: data.metadata ?? {},
          isRead: false,
          createdAt: new Date(),
        },
      });
    } catch (error) {
      console.error('Failed to create notification:', error);
      // Don't throw - notification failure shouldn't break the main workflow
    }
  }

  /**
   * Send notification for failed background job
   */
  static async handleFailedJob(job: Job, error: Error) {
    // Extract userId from job data if available
    const userId = job.data.userId || 'unknown';
    
    // Determine what type of job this was for better messaging
    let jobType = 'Background Job';
    if (job.name.includes('resume-analysis')) {
      jobType = 'Resume Analysis';
    } else if (job.name.includes('cover-letter')) {
      jobType = 'Cover Letter Generation';
    } else if (job.name.includes('auto-apply')) {
      jobType = 'Job Application Automation';
    }

    await this.createNotification({
      userId,
      title: `${jobType} Failed`,
      message: `The ${jobType.toLowerCase()} job failed: ${error.message}`,
      type: 'error',
      relatedId: job.id,
      metadata: {
        jobId: job.id,
        jobName: job.name,
        errorMessage: error.message,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Send notification for completed background job (optional, for important jobs)
   */
  static async handleCompletedJob(job: Job, result: any) {
    // Only send notifications for certain types of completed jobs to avoid spam
    const shouldNotify = job.name.includes('auto-apply') || 
                        job.name.includes('resume-analysis') ||
                        job.name.includes('cover-letter');
    
    if (!shouldNotify) return;

    // Extract userId from job data if available
    const userId = job.data.userId || 'unknown';
    
    // Determine what type of job this was
    let jobType = 'Background Job';
    if (job.name.includes('resume-analysis')) {
      jobType = 'Resume Analysis';
    } else if (job.name.includes('cover-letter')) {
      jobType = 'Cover Letter Generation';
    } else if (job.name.includes('auto-apply')) {
      jobType = 'Job Application Automation';
    }

    await this.createNotification({
      userId,
      title: `${jobType} Completed`,
      message: `The ${jobType.toLowerCase()} job completed successfully.`,
      type: 'success',
      relatedId: job.id,
      metadata: {
        jobId: job.id,
        jobName: job.name,
        result: result,
        timestamp: new Date().toISOString(),
      },
    });
  }
}