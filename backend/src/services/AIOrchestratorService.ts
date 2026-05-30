/**
 * AIOrchestratorService.ts — Consolidated AI logic.
 *
 * Unifies cover letter generation and resume analysis into a single class,
 * eliminating the duplicate implementations previously split across
 * ai.service.ts and resume-tailoring.service.ts.
 *
 * Delegates to the existing ai.service.ts functions (which handle caching and
 * OpenRouter communication) — this class is a thin orchestration layer, not
 * a reimplementation.
 */

import {
  generateCoverLetter as _generateCoverLetter,
  analyzeResume as _analyzeResume,
  matchResumeToJob as _matchResumeToJob,
  tailorResume as _tailorResume,
  type AnalysisResult,
  type MatchResult,
  type TailoredResume,
} from './ai.service';

export type { AnalysisResult, MatchResult, TailoredResume };

export class AIOrchestratorService {
  /**
   * Generate a tailored cover letter for a specific job.
   */
  async generateCoverLetter(
    resumeText: string,
    jobDescription: string,
    companyName: string,
    positionTitle: string
  ): Promise<string> {
    return _generateCoverLetter(resumeText, jobDescription, companyName, positionTitle);
  }

  /**
   * Analyze a resume against an optional job description.
   */
  async analyzeResume(resumeText: string, jobDescription?: string): Promise<AnalysisResult> {
    return _analyzeResume(resumeText, jobDescription);
  }

  /**
   * Score how well a resume matches a job description.
   */
  async matchResumeToJob(resumeText: string, jobDescription: string): Promise<MatchResult> {
    return _matchResumeToJob(resumeText, jobDescription);
  }

  /**
   * Tailor a resume to better match a specific job description.
   * Only reframes existing experience — never fabricates content.
   */
  async tailorResume(resumeText: string, jobDescription: string): Promise<TailoredResume> {
    return _tailorResume(resumeText, jobDescription);
  }
}
