import prisma from '../prisma/index';
import { searchJobs, Job, getJobDescription } from './job-scraper.service';
import { matchResumeToJob, meetsThreshold, MatchResult } from './job-matching.service';
import { tailorResume, TailoredResume } from './resume-tailoring.service';
import { generateCoverLetter } from './ai.service';
import { extractKeywordsFromResume, ExtractedKeywords, mergeSearchQueriesWithLocation } from './keyword-extraction.service';

export interface AutoApplyResult {
  job: Job;
  matchResult: MatchResult;
  tailoredResume?: TailoredResume;
  coverLetter?: string;
  applicationCreated: boolean;
  applicationId?: string;
  error?: string;
}

export interface AutomationConfig {
  userId: string;
  keywords?: string;
  location?: string;
  matchThreshold: number;
  autoTailorResume: boolean;
  autoGenerateCoverLetter: boolean;
  useAIKeywords?: boolean;
}

export interface AutomationResult {
  results: AutoApplyResult[];
  extractedKeywords?: ExtractedKeywords;
  sourceStats: Record<string, number>;
}

export async function runAutoApply(config: AutomationConfig): Promise<AutomationResult> {
  const results: AutoApplyResult[] = [];
  const sourceStats: Record<string, number> = {};
  
  const user = await prisma.user.findUnique({ where: { id: config.userId } });
  if (!user) {
    throw new Error('User not found');
  }

  const resumes = await prisma.resume.findMany({
    where: { userId: config.userId },
    orderBy: { createdAt: 'desc' },
    take: 1,
  });

  if (resumes.length === 0) {
    throw new Error('No resume found. Please upload a resume first.');
  }

  const mainResume = resumes[0];
  const resumeText = mainResume.extractedText || '';

  // AI keyword extraction
  let extractedKeywords: ExtractedKeywords | undefined;
  let searchQueries: string[] = [];

  if (config.useAIKeywords !== false && resumeText) {
    console.log('Extracting AI keywords from resume...');
    extractedKeywords = await extractKeywordsFromResume(resumeText);
    searchQueries = mergeSearchQueriesWithLocation(
      extractedKeywords.searchQueries,
      config.location
    );
    console.log(`AI generated ${searchQueries.length} search queries:`, searchQueries);
  }

  // Fallback to manual keywords if no AI queries
  if (searchQueries.length === 0 && config.keywords) {
    searchQueries = [`${config.keywords} ${config.location || ''}`.trim()];
  }

  if (searchQueries.length === 0) {
    throw new Error('No search keywords available. Upload a resume or provide keywords.');
  }

  // Search jobs across all queries
  const allJobs: Job[] = [];
  for (const query of searchQueries) {
    console.log(`Searching for: "${query}"`);
    const jobs = await searchJobs({ keywords: query, location: config.location });
    allJobs.push(...jobs);
  }

  // Deduplicate jobs by URL
  const seenUrls = new Set<string>();
  const uniqueJobs = allJobs.filter(job => {
    if (!job.url || seenUrls.has(job.url)) return false;
    seenUrls.add(job.url);
    return true;
  });

  console.log(`Found ${uniqueJobs.length} unique jobs from ${searchQueries.length} queries`);

  // Count jobs by source
  for (const job of uniqueJobs) {
    sourceStats[job.source] = (sourceStats[job.source] || 0) + 1;
  }

  for (const job of uniqueJobs) {
    try {
      if (job.url) {
        const existingApplication = await prisma.jobApplication.findFirst({
          where: {
            userId: config.userId,
            jobUrl: job.url,
          },
          select: { id: true },
        });

        if (existingApplication) {
          results.push({
            job,
            matchResult: { matchPercentage: 0, matchedSkills: [], missingSkills: [], strengths: [], weaknesses: [], recommendations: [] },
            applicationCreated: false,
            applicationId: existingApplication.id,
            error: 'Skipped duplicate job URL (already tracked)',
          });
          continue;
        }
      }

      let jobDescription = job.description;
      
      if (!jobDescription && job.url) {
        jobDescription = await getJobDescription(job.url);
      }

      if (!jobDescription) {
        results.push({
          job,
          matchResult: { matchPercentage: 0, matchedSkills: [], missingSkills: [], strengths: [], weaknesses: [], recommendations: [] },
          applicationCreated: false,
          error: 'Could not fetch job description',
        });
        continue;
      }

      const matchResult = await matchResumeToJob(resumeText, jobDescription);
      console.log(`Job: ${job.title} - Match: ${matchResult.matchPercentage}%`);

      if (!meetsThreshold(matchResult, config.matchThreshold)) {
        await markScrapedJobStatus(config.userId, job, 'skipped', matchResult.matchPercentage);
        results.push({
          job,
          matchResult,
          applicationCreated: false,
          error: `Match ${matchResult.matchPercentage}% below threshold ${config.matchThreshold}%`,
        });
        continue;
      }

      let tailoredResume: TailoredResume | undefined;
      if (config.autoTailorResume) {
        tailoredResume = await tailorResume(resumeText, jobDescription);
      }

      let coverLetter: string | undefined;
      if (config.autoGenerateCoverLetter) {
        coverLetter = await generateCoverLetter(
          resumeText,
          jobDescription,
          job.company,
          job.title
        );
      }

      const application = await prisma.jobApplication.create({
        data: {
          userId: config.userId,
          companyName: job.company,
          positionTitle: job.title,
          jobDescription: jobDescription,
          jobUrl: job.url,
          status: 'applied',
          source: 'scraped',
          applicationDate: new Date(),
        },
      });

      await markScrapedJobStatus(config.userId, job, 'applied', matchResult.matchPercentage);

      if (coverLetter) {
        await prisma.coverLetter.create({
          data: {
            userId: config.userId,
            applicationId: application.id,
            content: coverLetter,
            jobDescription: jobDescription,
          },
        });
      }

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

      results.push({
        job,
        matchResult,
        tailoredResume,
        coverLetter,
        applicationCreated: true,
        applicationId: application.id,
      });

    } catch (error) {
      console.error(`Error processing job ${job.title}:`, error);
      results.push({
        job,
        matchResult: { matchPercentage: 0, matchedSkills: [], missingSkills: [], strengths: [], weaknesses: [], recommendations: [] },
        applicationCreated: false,
        error: String(error),
      });
    }
  }

  return { results, extractedKeywords, sourceStats };
}

async function markScrapedJobStatus(
  userId: string,
  job: Job,
  status: 'applied' | 'skipped',
  matchScore: number
) {
  if (!job.url) {
    return;
  }

  await prisma.scrapedJob.updateMany({
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
}

export async function getAutomationStatus(userId: string) {
  const applications = await prisma.jobApplication.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: {
      activities: {
        where: {
          type: 'note',
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  return applications.map(app => ({
    id: app.id,
    companyName: app.companyName,
    positionTitle: app.positionTitle,
    status: app.status,
    appliedDate: app.applicationDate,
    source: app.activities[0]?.description?.includes('via') 
      ? app.activities[0].description.split('via ')[1]?.split('.')[0] || 'Manual'
      : 'Manual',
    matchScore: (app.activities[0]?.metadata as Record<string, unknown>)?.matchPercentage as number || null,
  }));
}
