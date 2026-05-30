import type { Job } from './job-scraper.service';

function createJob(id: string, source: string, url?: string, description: string = 'jd text'): Job {
  return {
    id,
    title: `Title ${id}`,
    company: `Company ${id}`,
    location: 'Remote',
    description,
    url,
    source,
  };
}

describe('automation.graph', () => {
  it('buildInitialAutomationState initializes stable defaults', async () => {
    const { buildInitialAutomationState } = await import('./automation.graph');

    const state = buildInitialAutomationState({
      userId: 'user_123',
      matchThreshold: 70,
      autoTailorResume: true,
      autoGenerateCoverLetter: false,
      keywords: 'backend engineer',
    });

    expect(state.userId).toBe('user_123');
    expect(state.config.matchThreshold).toBe(70);
    expect(state.searchQueries).toEqual([]);
    expect(state.jobs).toEqual([]);
    expect(state.dedupedJobs).toEqual([]);
    expect(state.results).toEqual([]);
    expect(state.sourceStats).toEqual({});
    expect(state.errors).toEqual([]);
  });

  it('search_jobs and dedupe_jobs aggregate by query and unique URL', async () => {
    const { buildAutomationGraph, buildInitialAutomationState } = await import('./automation.graph');

    const searchJobsFn = jest.fn(async ({ keywords }: { keywords?: string }) => {
      if (keywords === 'frontend remote') {
        return [
          createJob('1', 'LinkedIn', 'https://jobs/1'),
          createJob('2', 'Indeed', 'https://jobs/2'),
        ];
      }

      return [
        createJob('3', 'LinkedIn', 'https://jobs/1'),
        createJob('4', 'Remotive', 'https://jobs/3'),
      ];
    });

    const graph = buildAutomationGraph({
      nodes: {
        loadUserResume: async () => ({ resumeText: 'resume text' }),
        extractKeywords: async () => ({
          searchQueries: ['frontend', 'typescript'],
          skills: ['typescript'],
          roleType: 'job',
          suggestedTitles: [],
        }),
        processJobs: async () => ({ results: [], errors: [] }),
      },
      dependencies: {
        searchJobs: searchJobsFn,
      },
    });

    const initial = buildInitialAutomationState({
      userId: 'user_123',
      location: 'remote',
      matchThreshold: 70,
      autoTailorResume: false,
      autoGenerateCoverLetter: false,
      useAIKeywords: true,
    });

    const finalState = await graph.invoke(initial);

    expect(searchJobsFn).toHaveBeenCalledTimes(2);
    expect(finalState.searchQueries).toEqual(['frontend remote', 'typescript remote']);
    expect(finalState.jobs).toHaveLength(4);
    expect(finalState.dedupedJobs).toHaveLength(3);
    expect(finalState.sourceStats).toEqual({ LinkedIn: 1, Indeed: 1, Remotive: 1 });
  });

  it('process_jobs handles below-threshold skip and successful apply', async () => {
    const { processJobsNode } = await import('./automation.graph');

    const findExistingApplication = jest.fn(async (input: { userId: string; jobUrl: string }) => (
      input.jobUrl.includes('duplicate') ? { id: 'existing_1' } : null
    ));
    const getJobDescription = jest.fn(async () => 'fallback jd');
    const matchResumeToJob = jest
      .fn()
      .mockResolvedValueOnce({
        matchPercentage: 50,
        matchedSkills: [],
        missingSkills: ['node'],
        strengths: [],
        weaknesses: ['missing node'],
        recommendations: ['learn node'],
      })
      .mockResolvedValueOnce({
        matchPercentage: 88,
        matchedSkills: ['typescript'],
        missingSkills: [],
        strengths: ['api design'],
        weaknesses: [],
        recommendations: [],
      });

    const markScrapedJobStatus = jest.fn(async () => undefined);
    const tailorResume = jest.fn(async () => ({
      summary: 'tailored',
      skills: ['typescript'],
      experience: 'exp',
      education: 'edu',
      fullResume: 'resume',
    }));
    const generateCoverLetter = jest.fn(async () => 'cover letter');
    const createApplication = jest.fn(async () => ({ id: 'app_1' }));
    const createCoverLetter = jest.fn(async () => undefined);
    const createActivity = jest.fn(async () => undefined);

    const state = {
      userId: 'user_123',
      config: {
        userId: 'user_123',
        matchThreshold: 70,
        autoTailorResume: true,
        autoGenerateCoverLetter: true,
      },
      resumeText: 'resume',
      searchQueries: [],
      jobs: [],
      dedupedJobs: [
        createJob('skip', 'LinkedIn', 'https://jobs/skip', 'jd for skip'),
        createJob('apply', 'Indeed', 'https://jobs/apply', ''),
      ],
      results: [],
      sourceStats: {},
      errors: [],
    };

    const result = await processJobsNode(state, {
      findExistingApplication,
      getJobDescription,
      matchResumeToJob,
      meetsThreshold: (match, threshold) => match.matchPercentage >= threshold,
      markScrapedJobStatus,
      tailorResume,
      generateCoverLetter,
      createApplication,
      createCoverLetter,
      createActivity,
    });

    expect(result.results).toHaveLength(2);
    expect(result.results?.[0].applicationCreated).toBe(false);
    expect(result.results?.[0].error).toContain('below threshold');
    expect(result.results?.[1].applicationCreated).toBe(true);
    expect(result.results?.[1].applicationId).toBe('app_1');

    expect(markScrapedJobStatus).toHaveBeenCalledWith('user_123', expect.any(Object), 'skipped', 50);
    expect(markScrapedJobStatus).toHaveBeenCalledWith('user_123', expect.any(Object), 'applied', 88);
    expect(getJobDescription).toHaveBeenCalledWith('https://jobs/apply');
    expect(tailorResume).toHaveBeenCalledTimes(1);
    expect(generateCoverLetter).toHaveBeenCalledTimes(1);
    expect(createApplication).toHaveBeenCalledTimes(1);
    expect(createCoverLetter).toHaveBeenCalledTimes(1);
    expect(createActivity).toHaveBeenCalledTimes(1);
  });

  it('graph runs end-to-end with injected dependencies', async () => {
    const { buildAutomationGraph, buildInitialAutomationState } = await import('./automation.graph');

    const graph = buildAutomationGraph({
      nodes: {
        loadUserResume: async () => ({ resumeText: 'resume text' }),
      },
      dependencies: {
        searchJobs: async () => [createJob('1', 'LinkedIn', 'https://jobs/1', 'jd text')],
        findExistingApplication: async () => null,
        matchResumeToJob: async () => ({
          matchPercentage: 92,
          matchedSkills: ['react'],
          missingSkills: [],
          strengths: ['frontend'],
          weaknesses: [],
          recommendations: [],
        }),
        meetsThreshold: () => true,
        markScrapedJobStatus: async () => undefined,
        createApplication: async () => ({ id: 'app_99' }),
        createActivity: async () => undefined,
      },
    });

    const initial = buildInitialAutomationState({
      userId: 'user_123',
      keywords: 'frontend engineer',
      location: 'remote',
      matchThreshold: 80,
      autoTailorResume: false,
      autoGenerateCoverLetter: false,
      useAIKeywords: false,
    });

    const finalState = await graph.invoke(initial);

    expect(finalState.results).toHaveLength(1);
    expect(finalState.results[0].applicationCreated).toBe(true);
    expect(finalState.results[0].applicationId).toBe('app_99');
    expect(finalState.sourceStats).toEqual({ LinkedIn: 1 });
  });
});
