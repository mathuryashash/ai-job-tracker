import prisma from '../prisma/index';
import { type Job } from './job-scraper.service';
import { type MatchResult } from './job-matching.service';
import { type TailoredResume } from './resume-tailoring.service';
import { ExtractedKeywords } from './keyword-extraction.service';
import {
  buildAutomationGraph,
  buildInitialAutomationState,
  mapGraphStateToAutomationResult,
} from './automation.graph';

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
  const graphState = buildInitialAutomationState(config);
  const graph = buildAutomationGraph();
  const finalState = await graph.invoke(graphState);
  return mapGraphStateToAutomationResult(finalState);
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
