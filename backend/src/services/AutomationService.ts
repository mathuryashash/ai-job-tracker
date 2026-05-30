/**
 * AutomationService.ts — Linear replacement for automation.graph.ts's LangGraph.
 *
 * Runs the same pipeline deterministically as a plain TypeScript class:
 *   LoadUserResume → ExtractKeywords → BuildSearchQueries → SearchJobs
 *     → DedupeJobs → ProcessJobs → SaveToDB
 *
 * No graph state, no StateGraph, no LangGraph dependency.
 * Progress events are emitted via broadcastToUser at each stage.
 */

import prisma from '../prisma/index';
import type { AutomationConfig, AutoApplyResult } from './auto-apply.service';
import {
  extractKeywordsFromResume,
  mergeSearchQueriesWithLocation,
  type ExtractedKeywords,
} from './keyword-extraction.service';
import { matchResumeToJob, meetsThreshold, type MatchResult } from './job-matching.service';
import {
  getJobDescription,
  searchJobs,
  type Job,
  type UserApiKeys,
} from './job-scraper.service';
import { tailorResume, type TailoredResume } from './resume-tailoring.service';
import { tryDecryptApiKeys } from '../utils/crypto';
import { broadcastToUser } from './websocket';
import { AIOrchestratorService } from './AIOrchestratorService';

const EMPTY_MATCH_RESULT: MatchResult = {
  matchPercentage: 0,
  matchedSkills: [],
  missingSkills: [],
  strengths: [],
  weaknesses: [],
  recommendations: [],
};

export interface AutomationServiceResult {
  results: AutoApplyResult[];
  extractedKeywords?: ExtractedKeywords;
  sourceStats: Record<string, number>;
}

export class AutomationService {
  private readonly ai = new AIOrchestratorService();

  async run(config: AutomationConfig): Promise<AutomationServiceResult> {
    const { userId } = config;

    // ── Stage 1: Load user resume ────────────────────────────────────────────
    const resumeText = await this.loadUserResume(userId, config.resumeId);

    broadcastToUser(userId, 'automation:progress', {
      stage: 'resume_loaded',
      message: 'Resume loaded',
      progress: 10,
    });

    // ── Stage 2: Extract keywords from resume ────────────────────────────────
    let extractedKeywords: ExtractedKeywords | undefined;
    if (config.useAIKeywords !== false && resumeText) {
      extractedKeywords = await extractKeywordsFromResume(resumeText);
    }

    // ── Stage 3: Build search queries ────────────────────────────────────────
    const searchQueries = this.buildSearchQueries(config, extractedKeywords);
    if (searchQueries.length === 0) {
      throw new Error('No search keywords available. Upload a resume or provide keywords.');
    }

    broadcastToUser(userId, 'automation:progress', {
      stage: 'searching',
      message: `Searching with ${searchQueries.length} queries…`,
      progress: 20,
    });

    // ── Stage 4: Search jobs ─────────────────────────────────────────────────
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { preferences: true },
    });
    const userApiKeys = tryDecryptApiKeys(
      (user?.preferences as Record<string, unknown>)?.apiKeys
    ) as UserApiKeys | undefined;

    const allJobs: Job[] = [];
    for (const query of searchQueries) {
      const jobs = await searchJobs(
        { keywords: query, location: config.location, remote: config.remote },
        userApiKeys,
        userId
      );
      allJobs.push(...jobs);
    }

    broadcastToUser(userId, 'automation:progress', {
      stage: 'deduplicating',
      message: `Found ${allJobs.length} jobs, deduplicating…`,
      progress: 35,
    });

    // ── Stage 5: Deduplicate ─────────────────────────────────────────────────
    const { dedupedJobs, sourceStats } = this.dedupeJobs(allJobs);

    broadcastToUser(userId, 'automation:progress', {
      stage: 'processing',
      message: `Processing ${dedupedJobs.length} unique jobs…`,
      progress: 40,
    });

    // ── Stage 6: Process each job (match → tailor → apply) ───────────────────
    const results = await this.processJobs(config, resumeText, dedupedJobs);

    broadcastToUser(userId, 'automation:progress', {
      stage: 'complete',
      message: 'Automation complete',
      progress: 100,
    });

    return { results, extractedKeywords, sourceStats };
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async loadUserResume(userId: string, resumeId?: string): Promise<string> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found');

    const resumes = resumeId
      ? await prisma.resume.findMany({ where: { id: resumeId, userId }, take: 1 })
      : await prisma.resume.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 1,
        });

    if (resumes.length === 0) {
      throw new Error('No resume found. Please upload a resume first.');
    }

    return resumes[0].extractedText ?? '';
  }

  private buildSearchQueries(config: AutomationConfig, keywords?: ExtractedKeywords): string[] {
    const aiQueries = keywords
      ? mergeSearchQueriesWithLocation(keywords.searchQueries, config.location)
      : [];

    if (aiQueries.length > 0) return aiQueries;
    if (config.keywords) return [`${config.keywords} ${config.location ?? ''}`.trim()];
    return [];
  }

  private dedupeJobs(jobs: Job[]): { dedupedJobs: Job[]; sourceStats: Record<string, number> } {
    const seenUrls = new Set<string>();
    const dedupedJobs = jobs.filter((job) => {
      if (!job.url || seenUrls.has(job.url)) return false;
      seenUrls.add(job.url);
      return true;
    });

    const sourceStats: Record<string, number> = {};
    for (const job of dedupedJobs) {
      sourceStats[job.source] = (sourceStats[job.source] ?? 0) + 1;
    }

    return { dedupedJobs, sourceStats };
  }

  private async processJobs(
    config: AutomationConfig,
    resumeText: string,
    jobs: Job[]
  ): Promise<AutoApplyResult[]> {
    const results: AutoApplyResult[] = [];
    const { userId } = config;

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];

      try {
        // Skip already-tracked jobs
        if (job.url) {
          const existing = await prisma.jobApplication.findFirst({
            where: { userId, jobUrl: job.url },
            select: { id: true },
          });

          if (existing) {
            results.push({
              job,
              matchResult: EMPTY_MATCH_RESULT,
              applicationCreated: false,
              applicationId: existing.id,
              error: 'Skipped duplicate job URL (already tracked)',
            });
            this.emitJobProgress(userId, i + 1, jobs.length, job.title);
            continue;
          }
        }

        // Fetch job description if missing
        let jobDescription = job.description;
        if (!jobDescription && job.url) {
          jobDescription = await getJobDescription(job.url);
        }

        if (!jobDescription) {
          results.push({
            job,
            matchResult: EMPTY_MATCH_RESULT,
            applicationCreated: false,
            error: 'Could not fetch job description',
          });
          continue;
        }

        // AI matching
        const matchResult = await matchResumeToJob(resumeText, jobDescription);

        if (!meetsThreshold(matchResult, config.matchThreshold)) {
          await this.markScrapedJobStatus(userId, job, 'skipped', matchResult.matchPercentage);
          results.push({
            job,
            matchResult,
            applicationCreated: false,
            error: `Match ${matchResult.matchPercentage}% below threshold ${config.matchThreshold}%`,
          });
          this.emitJobProgress(userId, i + 1, jobs.length, job.title);
          continue;
        }

        // Tailor resume
        let tailoredResume: TailoredResume | undefined;
        if (config.autoTailorResume) {
          tailoredResume = await tailorResume(resumeText, jobDescription);
        }

        // Generate cover letter via AIOrchestratorService
        let coverLetter: string | undefined;
        if (config.autoGenerateCoverLetter) {
          coverLetter = await this.ai.generateCoverLetter(
            resumeText,
            jobDescription,
            job.company,
            job.title
          );
        }

        // Create application in DB
        const application = await this.createApplication({ userId, job, jobDescription });

        await this.markScrapedJobStatus(userId, job, 'applied', matchResult.matchPercentage);

        if (coverLetter) {
          await prisma.coverLetter.create({
            data: {
              userId,
              applicationId: application.id,
              content: coverLetter,
              jobDescription,
            },
          });

          // Link cover letter to application
          const cl = await prisma.coverLetter.findFirst({
            where: { applicationId: application.id },
            select: { id: true },
          });
          if (cl) {
            await prisma.jobApplication.update({
              where: { id: application.id },
              data: { coverLetterId: cl.id },
            });
          }
        }

        // Activity log
        await prisma.activity.create({
          data: {
            applicationId: application.id,
            type: 'note',
            description: `Auto-applied via ${job.source}. Match: ${matchResult.matchPercentage}%`,
            metadata: {
              matchPercentage: matchResult.matchPercentage,
              matchedSkills: matchResult.matchedSkills,
              missingSkills: matchResult.missingSkills,
              tailoredResumeGenerated: Boolean(tailoredResume),
              coverLetterGenerated: Boolean(coverLetter),
            },
          },
        });

        broadcastToUser(userId, 'application:status', {
          applicationId: application.id,
          jobTitle: job.title,
          company: job.company,
          status: 'applied',
          matchScore: matchResult.matchPercentage,
          timestamp: new Date().toISOString(),
        });

        results.push({
          job,
          matchResult,
          tailoredResume,
          coverLetter,
          applicationCreated: true,
          applicationId: application.id,
        });

        this.emitJobProgress(userId, i + 1, jobs.length, job.title, matchResult.matchPercentage);
      } catch (error) {
        const message = String(error);
        results.push({
          job,
          matchResult: EMPTY_MATCH_RESULT,
          applicationCreated: false,
          error: message,
        });
        this.emitJobProgress(userId, i + 1, jobs.length, job.title);
      }
    }

    return results;
  }

  private emitJobProgress(
    userId: string,
    completed: number,
    total: number,
    currentJob: string,
    matchScore?: number
  ): void {
    broadcastToUser(userId, 'automation:progress', {
      stage: 'processing',
      completed,
      total,
      currentJob,
      matchScore,
      progress: Math.round(40 + (completed / total) * 55),
      timestamp: new Date().toISOString(),
    });
  }

  private async createApplication(input: {
    userId: string;
    job: Job;
    jobDescription: string;
  }): Promise<{ id: string }> {
    try {
      return await prisma.jobApplication.create({
        data: {
          userId: input.userId,
          companyName: input.job.company,
          positionTitle: input.job.title,
          jobDescription: input.jobDescription,
          jobUrl: input.job.url,
          status: 'applied',
          source: 'scraped',
          applicationDate: new Date(),
        } as any,
        select: { id: true },
      });
    } catch (error: any) {
      if (error.code === 'P2002' && error.meta?.target?.includes('jobUrl')) {
        const existing = await prisma.jobApplication.findFirst({
          where: { userId: input.userId, jobUrl: input.job.url },
          select: { id: true },
        });
        return { id: existing?.id ?? '' };
      }
      throw error;
    }
  }

  private async markScrapedJobStatus(
    userId: string,
    job: Job,
    status: 'applied' | 'skipped',
    matchScore: number
  ): Promise<void> {
    if (!job.url) return;
    await (prisma as any).scrapedJob.updateMany({
      where: { userId, url: job.url },
      data: { status, processedAt: new Date(), matchScore },
    });
  }
}
