import prisma from '../prisma/index';
import type { AutomationConfig, AutoApplyResult } from './auto-apply.service';
import { generateCoverLetter } from './ai.service';
import {
  extractKeywordsFromResume,
  mergeSearchQueriesWithLocation,
  type ExtractedKeywords,
} from './keyword-extraction.service';
import { matchResumeToJob, meetsThreshold, type MatchResult } from './job-matching.service';
import { getJobDescription, searchJobs, type Job, type JobSearchParams } from './job-scraper.service';
import { tailorResume, type TailoredResume } from './resume-tailoring.service';

export interface AutomationGraphState {
  userId: string;
  config: AutomationConfig;
  resumeText?: string;
  searchQueries: string[];
  jobs: Job[];
  dedupedJobs: Job[];
  results: AutoApplyResult[];
  sourceStats: Record<string, number>;
  extractedKeywords?: ExtractedKeywords;
  errors: string[];
}

export interface AutomationGraphNodeResult {
  jobs?: Job[];
  dedupedJobs?: Job[];
  results?: AutoApplyResult[];
  sourceStats?: Record<string, number>;
  extractedKeywords?: ExtractedKeywords;
  errors?: string[];
}

export type LoadUserResumeNode = (state: AutomationGraphState) => Promise<{
  resumeText: string;
}>;

export type ExtractKeywordsNode = (state: AutomationGraphState) => Promise<ExtractedKeywords | undefined>;

export type SearchJobsNode = (
  state: AutomationGraphState,
  deps: SearchJobsDependencies
) => Promise<Pick<AutomationGraphState, 'jobs'>>;

export type DedupeJobsNode = (
  state: AutomationGraphState
) => Promise<Pick<AutomationGraphState, 'dedupedJobs' | 'sourceStats'>>;

export type ProcessJobsNode = (
  state: AutomationGraphState,
  deps: ProcessJobsDependencies
) => Promise<Pick<AutomationGraphState, 'results' | 'errors'>>;

export interface AutomationGraphNodes {
  loadUserResume?: LoadUserResumeNode;
  extractKeywords?: ExtractKeywordsNode;
  searchJobs?: SearchJobsNode;
  dedupeJobs?: DedupeJobsNode;
  processJobs?: ProcessJobsNode;
}

export interface AutomationGraphRunnable {
  invoke: (state: AutomationGraphState) => Promise<AutomationGraphState>;
}

export interface AutomationGraphDependencies {
  searchJobs: (params: JobSearchParams) => Promise<Job[]>;
  findExistingApplication: (input: { userId: string; jobUrl: string }) => Promise<{ id: string } | null>;
  getJobDescription: (url: string) => Promise<string>;
  matchResumeToJob: (resumeText: string, jobDescription: string) => Promise<MatchResult>;
  meetsThreshold: (result: MatchResult, threshold: number) => boolean;
  markScrapedJobStatus: (
    userId: string,
    job: Job,
    status: 'applied' | 'skipped',
    matchScore: number
  ) => Promise<void>;
  tailorResume: (resumeText: string, jobDescription: string) => Promise<TailoredResume>;
  generateCoverLetter: (
    resumeText: string,
    jobDescription: string,
    companyName: string,
    positionTitle: string
  ) => Promise<string>;
  createApplication: (input: {
    userId: string;
    job: Job;
    jobDescription: string;
  }) => Promise<{ id: string }>;
  createCoverLetter: (input: {
    userId: string;
    applicationId: string;
    content: string;
    jobDescription: string;
  }) => Promise<void>;
  createActivity: (input: {
    applicationId: string;
    job: Job;
    matchResult: MatchResult;
    tailoredResumeGenerated: boolean;
    coverLetterGenerated: boolean;
  }) => Promise<void>;
}

export type SearchJobsDependencies = Pick<AutomationGraphDependencies, 'searchJobs'>;

export type ProcessJobsDependencies = Pick<
  AutomationGraphDependencies,
  | 'findExistingApplication'
  | 'getJobDescription'
  | 'matchResumeToJob'
  | 'meetsThreshold'
  | 'markScrapedJobStatus'
  | 'tailorResume'
  | 'generateCoverLetter'
  | 'createApplication'
  | 'createCoverLetter'
  | 'createActivity'
>;

export interface BuildAutomationGraphOptions {
  nodes?: AutomationGraphNodes;
  dependencies?: Partial<AutomationGraphDependencies>;
}

const EMPTY_MATCH_RESULT: MatchResult = {
  matchPercentage: 0,
  matchedSkills: [],
  missingSkills: [],
  strengths: [],
  weaknesses: [],
  recommendations: [],
};

export async function loadUserResumeNode(state: AutomationGraphState): Promise<{ resumeText: string }> {
  const user = await prisma.user.findUnique({ where: { id: state.userId } });
  if (!user) {
    throw new Error('User not found');
  }

  const resumes = await prisma.resume.findMany({
    where: { userId: state.userId },
    orderBy: { createdAt: 'desc' },
    take: 1,
  });

  if (resumes.length === 0) {
    throw new Error('No resume found. Please upload a resume first.');
  }

  return { resumeText: resumes[0].extractedText || '' };
}

export async function extractKeywordsNode(state: AutomationGraphState): Promise<ExtractedKeywords | undefined> {
  if (state.config.useAIKeywords === false || !state.resumeText) {
    return undefined;
  }

  return extractKeywordsFromResume(state.resumeText);
}

export function buildSearchQueries(input: {
  config: AutomationConfig;
  extractedKeywords?: ExtractedKeywords;
}): string[] {
  const aiQueries = input.extractedKeywords
    ? mergeSearchQueriesWithLocation(input.extractedKeywords.searchQueries, input.config.location)
    : [];

  if (aiQueries.length > 0) {
    return aiQueries;
  }

  if (input.config.keywords) {
    return [`${input.config.keywords} ${input.config.location || ''}`.trim()];
  }

  return [];
}

export async function searchJobsNode(
  state: AutomationGraphState,
  deps: SearchJobsDependencies
): Promise<Pick<AutomationGraphState, 'jobs'>> {
  const allJobs: Job[] = [];
  for (const query of state.searchQueries) {
    const jobs = await deps.searchJobs({ keywords: query, location: state.config.location });
    allJobs.push(...jobs);
  }

  return { jobs: allJobs };
}

export async function dedupeJobsNode(
  state: AutomationGraphState
): Promise<Pick<AutomationGraphState, 'dedupedJobs' | 'sourceStats'>> {
  const seenUrls = new Set<string>();
  const dedupedJobs = state.jobs.filter((job) => {
    if (!job.url || seenUrls.has(job.url)) {
      return false;
    }

    seenUrls.add(job.url);
    return true;
  });

  const sourceStats: Record<string, number> = {};
  for (const job of dedupedJobs) {
    sourceStats[job.source] = (sourceStats[job.source] || 0) + 1;
  }

  return { dedupedJobs, sourceStats };
}

export async function processJobsNode(
  state: AutomationGraphState,
  deps: ProcessJobsDependencies
): Promise<Pick<AutomationGraphState, 'results' | 'errors'>> {
  const results: AutoApplyResult[] = [];
  const errors: string[] = [];
  const resumeText = state.resumeText || '';

  for (const job of state.dedupedJobs) {
    try {
      if (job.url) {
        const existingApplication = await deps.findExistingApplication({
          userId: state.config.userId,
          jobUrl: job.url,
        });

        if (existingApplication) {
          results.push({
            job,
            matchResult: EMPTY_MATCH_RESULT,
            applicationCreated: false,
            applicationId: existingApplication.id,
            error: 'Skipped duplicate job URL (already tracked)',
          });
          continue;
        }
      }

      let jobDescription = job.description;
      if (!jobDescription && job.url) {
        jobDescription = await deps.getJobDescription(job.url);
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

      const matchResult = await deps.matchResumeToJob(resumeText, jobDescription);
      if (!deps.meetsThreshold(matchResult, state.config.matchThreshold)) {
        await deps.markScrapedJobStatus(state.config.userId, job, 'skipped', matchResult.matchPercentage);
        results.push({
          job,
          matchResult,
          applicationCreated: false,
          error: `Match ${matchResult.matchPercentage}% below threshold ${state.config.matchThreshold}%`,
        });
        continue;
      }

      let tailoredResume: TailoredResume | undefined;
      if (state.config.autoTailorResume) {
        tailoredResume = await deps.tailorResume(resumeText, jobDescription);
      }

      let coverLetter: string | undefined;
      if (state.config.autoGenerateCoverLetter) {
        coverLetter = await deps.generateCoverLetter(resumeText, jobDescription, job.company, job.title);
      }

      const application = await deps.createApplication({
        userId: state.config.userId,
        job,
        jobDescription,
      });

      await deps.markScrapedJobStatus(state.config.userId, job, 'applied', matchResult.matchPercentage);

      if (coverLetter) {
        await deps.createCoverLetter({
          userId: state.config.userId,
          applicationId: application.id,
          content: coverLetter,
          jobDescription,
        });
      }

      await deps.createActivity({
        applicationId: application.id,
        job,
        matchResult,
        tailoredResumeGenerated: Boolean(tailoredResume),
        coverLetterGenerated: Boolean(coverLetter),
      });

      results.push({
        job,
        matchResult,
        tailoredResume,
        coverLetter,
        applicationCreated: true,
        applicationId: application.id,
      });
    } catch (error) {
      const message = String(error);
      errors.push(`Error processing job ${job.title}: ${message}`);
      results.push({
        job,
        matchResult: EMPTY_MATCH_RESULT,
        applicationCreated: false,
        error: message,
      });
    }
  }

  return { results, errors };
}

function createDefaultDependencies(): AutomationGraphDependencies {
  return {
    searchJobs,
    findExistingApplication: async ({ userId, jobUrl }) =>
      prisma.jobApplication.findFirst({
        where: { userId, jobUrl },
        select: { id: true },
      }),
    getJobDescription,
    matchResumeToJob,
    meetsThreshold,
    markScrapedJobStatus: async (userId, job, status, matchScore) => {
      if (!job.url) {
        return;
      }

      await (prisma as any).scrapedJob.updateMany({
        where: {
          userId,
          url: job.url,
        },
        data: {
          status,
          processedAt: new Date(),
          matchScore,
        },
      });
    },
    tailorResume,
    generateCoverLetter,
    createApplication: async ({ userId, job, jobDescription }) =>
      prisma.jobApplication.create({
        data: {
          userId,
          companyName: job.company,
          positionTitle: job.title,
          jobDescription,
          jobUrl: job.url,
          status: 'applied',
          source: 'scraped',
          applicationDate: new Date(),
        } as any,
        select: { id: true },
      }),
    createCoverLetter: async ({ userId, applicationId, content, jobDescription }) => {
      await prisma.coverLetter.create({
        data: {
          userId,
          applicationId,
          content,
          jobDescription,
        },
      });
    },
    createActivity: async ({
      applicationId,
      job,
      matchResult,
      tailoredResumeGenerated,
      coverLetterGenerated,
    }) => {
      await prisma.activity.create({
        data: {
          applicationId,
          type: 'note',
          description: `Auto-applied via ${job.source}. Match: ${matchResult.matchPercentage}%`,
          metadata: {
            matchPercentage: matchResult.matchPercentage,
            matchedSkills: matchResult.matchedSkills,
            missingSkills: matchResult.missingSkills,
            tailoredResumeGenerated,
            coverLetterGenerated,
          },
        },
      });
    },
  };
}

function normalizeBuildOptions(
  input: BuildAutomationGraphOptions | AutomationGraphNodes
): BuildAutomationGraphOptions {
  if ('nodes' in input || 'dependencies' in input) {
    return input as BuildAutomationGraphOptions;
  }

  return { nodes: input as AutomationGraphNodes };
}

export function buildAutomationGraph(
  input: BuildAutomationGraphOptions | AutomationGraphNodes = {}
): AutomationGraphRunnable {
  const options = normalizeBuildOptions(input);
  const defaultDependencies = createDefaultDependencies();
  const deps: AutomationGraphDependencies = {
    ...defaultDependencies,
    ...(options.dependencies || {}),
  };

  const safeLoadUserResume = options.nodes?.loadUserResume || loadUserResumeNode;
  const safeExtractKeywords = options.nodes?.extractKeywords || extractKeywordsNode;
  const safeSearchJobs = options.nodes?.searchJobs || searchJobsNode;
  const safeDedupeJobs = options.nodes?.dedupeJobs || dedupeJobsNode;
  const safeProcessJobs = options.nodes?.processJobs || processJobsNode;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Annotation, END, START, StateGraph } = require('@langchain/langgraph');

  const automationGraphAnnotation = Annotation.Root({
    userId: Annotation(),
    config: Annotation(),
    resumeText: Annotation(),
    searchQueries: Annotation(),
    jobs: Annotation(),
    dedupedJobs: Annotation(),
    results: Annotation(),
    sourceStats: Annotation(),
    extractedKeywords: Annotation(),
    errors: Annotation(),
  });

  const workflow = new StateGraph(automationGraphAnnotation)
    .addNode('load_user_resume', async (state: AutomationGraphState) => {
      const loaded = await safeLoadUserResume(state);
      return { resumeText: loaded.resumeText };
    })
    .addNode('extract_keywords', async (state: AutomationGraphState) => {
      const extractedKeywords = await safeExtractKeywords(state);
      return { extractedKeywords };
    })
    .addNode('build_search_queries', async (state: AutomationGraphState) => {
      const searchQueries = buildSearchQueries({
        config: state.config,
        extractedKeywords: state.extractedKeywords,
      });

      if (searchQueries.length === 0) {
        throw new Error('No search keywords available. Upload a resume or provide keywords.');
      }

      return { searchQueries };
    })
    .addNode('search_jobs', async (state: AutomationGraphState) => safeSearchJobs(state, deps))
    .addNode('dedupe_jobs', async (state: AutomationGraphState) => safeDedupeJobs(state))
    .addNode('process_jobs', async (state: AutomationGraphState) => safeProcessJobs(state, deps))
    .addEdge(START, 'load_user_resume')
    .addEdge('load_user_resume', 'extract_keywords')
    .addEdge('extract_keywords', 'build_search_queries')
    .addEdge('build_search_queries', 'search_jobs')
    .addEdge('search_jobs', 'dedupe_jobs')
    .addEdge('dedupe_jobs', 'process_jobs')
    .addEdge('process_jobs', END);

  return workflow.compile() as AutomationGraphRunnable;
}

export function buildInitialAutomationState(config: AutomationConfig): AutomationGraphState {
  return {
    userId: config.userId,
    config,
    resumeText: undefined,
    searchQueries: [],
    jobs: [],
    dedupedJobs: [],
    results: [],
    sourceStats: {},
    extractedKeywords: undefined,
    errors: [],
  };
}

export function mapGraphStateToAutomationResult(state: AutomationGraphState): {
  results: AutoApplyResult[];
  extractedKeywords?: ExtractedKeywords;
  sourceStats: Record<string, number>;
} {
  return {
    results: state.results,
    extractedKeywords: state.extractedKeywords,
    sourceStats: state.sourceStats,
  };
}
