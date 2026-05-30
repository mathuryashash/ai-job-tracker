import axios from 'axios';
import { ssrfGuard } from '../utils/ssrf';
import { getCached, setCache, getJobSearchCacheKey, JOB_SEARCH_TTL } from './cache.service';

export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  description: string;
  url?: string;
  salary?: string;
  postedDate?: string;
  source: string;
}

export interface JobSearchParams {
  keywords?: string;
  location?: string;
  remote?: boolean;
  fullTime?: boolean;
}

const SOURCE_CONCURRENCY_LIMIT = 3;
const APIFY_RUN_STATUS_POLL_INTERVAL_MS = 2000;
const APIFY_RUN_STATUS_MAX_ATTEMPTS = 30;
const JOB_DESCRIPTION_MAX_LENGTH = 5000;
const JOB_DESCRIPTION_FALLBACK_MAX_LENGTH = 3000;
const SOURCE_TIMEOUT_MS = 15000;

type SourceSearcher = (params: JobSearchParams, userApiKeys?: UserApiKeys) => Promise<Job[]>;

export interface UserApiKeys {
  apify?: string;
  jooble?: string;
  indeed?: string;
  flexjobs?: string;
  adzuna?: { appId?: string; apiKey?: string };
  internshala?: string;
}

// Source status tracking
export interface SourceStatus {
  source: string;
  status: 'success' | 'failed' | 'no-key' | 'skipped';
  jobsFound: number;
  error?: string;
}

// Merge user API keys with system fallback keys from env
function getEffectiveApiKeys(userApiKeys?: UserApiKeys): UserApiKeys {
  const systemKeys: UserApiKeys = {
    apify: process.env.APIFY_API_KEY,
    jooble: process.env.JOOBLE_API_KEY,
    indeed: process.env.INDEED_PUBLISHER_KEY,
    flexjobs: process.env.FLEXJOBS_API_KEY,
    adzuna: process.env.ADZUNA_APP_ID && process.env.ADZUNA_API_KEY 
      ? { appId: process.env.ADZUNA_APP_ID, apiKey: process.env.ADZUNA_API_KEY }
      : undefined,
    internshala: process.env.APIFY_API_KEY, // Fallback to Apify for Internshala
  };

  // If no user keys, use system keys
  if (!userApiKeys) {
    return systemKeys;
  }

  // Merge: user keys take precedence over system keys
  return {
    apify: userApiKeys.apify || systemKeys.apify,
    jooble: userApiKeys.jooble || systemKeys.jooble,
    indeed: userApiKeys.indeed || systemKeys.indeed,
    flexjobs: userApiKeys.flexjobs || systemKeys.flexjobs,
    adzuna: userApiKeys.adzuna || systemKeys.adzuna,
    internshala: userApiKeys.internshala || systemKeys.internshala,
  };
}

// ── Main Search Aggregator ──

export async function searchJobs(params: JobSearchParams, userApiKeys?: UserApiKeys, userId?: string): Promise<Job[]> {
  // Use effective keys (user keys + system fallback)
  const effectiveKeys = getEffectiveApiKeys(userApiKeys);

  // Generate cache key (include API key presence so cache differs when keys change)
  const hasKeys = Object.values(effectiveKeys).some(v => v && (typeof v === 'string' ? v.length > 0 : Object.values(v || {}).some(x => x)));
  const userScope = userId ?? 'anonymous';
  const cacheKey = getJobSearchCacheKey(params.keywords, params.location, params.remote) + `:${userScope}` + (hasKeys ? ':with-keys' : ':no-keys');

  // Check cache first (only if no keys - don't cache when user has keys)
  if (!hasKeys) {
    const cachedJobs = await getCached<Job[]>(cacheKey);
    if (cachedJobs && cachedJobs.length > 0) {
      console.log(`Returning cached results for ${cacheKey}`);
      return cachedJobs;
    }
  }

  // Track source status for feedback
  const sourceStatuses: SourceStatus[] = [];

  // No cache - fetch from all sources
  const sources: { fn: SourceSearcher; name: string; requiresKey: boolean }[] = [
    { fn: (p) => searchApifyJobs(p, userApiKeys), name: 'LinkedIn (Apify)', requiresKey: true },
    { fn: searchRemotive, name: 'Remotive', requiresKey: false },
    { fn: searchWeWorkRemotely, name: 'We Work Remotely', requiresKey: false },
    { fn: searchRemoteOK, name: 'Remote OK', requiresKey: false },
    { fn: searchWellfound, name: 'Wellfound', requiresKey: false },
    { fn: searchRemoteCo, name: 'Remote.co', requiresKey: false },
    { fn: (p) => searchFlexJobs(p, userApiKeys), name: 'FlexJobs', requiresKey: true },
    { fn: (p) => searchJooble(p, userApiKeys), name: 'Jooble', requiresKey: true },
    { fn: (p) => searchIndeed(p, userApiKeys), name: 'Indeed API', requiresKey: true },
    { fn: (p) => searchAdzuna(p, userApiKeys), name: 'Adzuna', requiresKey: true },
    { fn: searchGitHubJobs, name: 'Arbeitnow', requiresKey: false },
    { fn: (p) => searchInternshala(p, userApiKeys), name: 'Internshala', requiresKey: true },
  ];

  const results = await runWithConcurrencyLimit(
    sources.map(s => s.fn),
    SOURCE_CONCURRENCY_LIMIT,
    (fn) => fn(params, effectiveKeys),
    SOURCE_TIMEOUT_MS
  );

  const jobs: Job[] = [];
  for (let i = 0; i < results.length; i++) {
    const sourceInfo = sources[i];
    const result = results[i];
    if (result.status === 'fulfilled') {
      const foundJobs = result.value;
      jobs.push(...foundJobs);
      sourceStatuses.push({
        source: sourceInfo.name,
        status: foundJobs.length > 0 ? 'success' : 'skipped',
        jobsFound: foundJobs.length,
      });
    } else {
      const errorMsg = (result.reason as any)?.message || String(result.reason);
      sourceStatuses.push({
        source: sourceInfo.name,
        status: sourceInfo.requiresKey && !hasKeys ? 'no-key' : 'failed',
        jobsFound: 0,
        error: errorMsg,
      });
      console.error(`Job source ${sourceInfo.name} failed:`, errorMsg);
    }
  }

  // Filter for remote jobs if requested
  let filteredJobs = jobs;
  if (params.remote) {
    filteredJobs = jobs.filter(job => 
      job.location.toLowerCase().includes('remote') ||
      job.location.toLowerCase().includes('work from home') ||
      job.location.toLowerCase() === 'anywhere' ||
      job.location.toLowerCase() === 'worldwide'
    );
  }

  // Log source status for debugging
  console.log('[Job Search] Source statuses:', sourceStatuses.map(s => 
    `${s.source}: ${s.status} (${s.jobsFound} jobs)${s.error ? ` - ${s.error}` : ''}`
  ).join(', '));

  // Cache the results (only if no user keys)
  if (!hasKeys && filteredJobs.length > 0) {
    await setCache(cacheKey, filteredJobs, JOB_SEARCH_TTL);
    console.log(`Cached ${filteredJobs.length} jobs for ${cacheKey}`);
  }

  return filteredJobs;
}

async function runWithConcurrencyLimit<TItem, TResult>(
  items: TItem[],
  maxConcurrency: number,
  mapper: (item: TItem) => Promise<TResult>,
  timeoutMs: number
): Promise<PromiseSettledResult<TResult>[]> {
  const results: PromiseSettledResult<TResult>[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      try {
        const value = await Promise.race([
          mapper(items[currentIndex]),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Source request timed out')), timeoutMs);
          }),
        ]);
        results[currentIndex] = { status: 'fulfilled', value };
      } catch (error) {
        results[currentIndex] = { status: 'rejected', reason: error };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(maxConcurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

// ── Apify Job Scraping ──

async function searchApifyJobs(params: JobSearchParams, userApiKeys?: UserApiKeys): Promise<Job[]> {
  // Use user-provided API key first, fallback to system env
  const apiKey = userApiKeys?.apify || process.env.APIFY_API_KEY;
  if (!apiKey) return [];

  try {
    // Run LinkedIn job scraper actor
    const linkedInRun = await axios.post(
      'https://api.apify.com/v2/acts/linkedin~linkedin-jobs-scraper/runs',
      {
        input: {
          searchTerms: [{ query: params.keywords || 'software engineer', location: params.location || 'remote' }],
          maxResults: 20,
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      }
    );

    const runId = linkedInRun.data.id;
    
    // Wait for completion
    let status = 'RUNNING';
    let waitAttempts = 0;
    while (status === 'RUNNING' && waitAttempts < APIFY_RUN_STATUS_MAX_ATTEMPTS) {
      await new Promise(resolve => setTimeout(resolve, APIFY_RUN_STATUS_POLL_INTERVAL_MS));
      const statusCheck = await axios.get(
        `https://api.apify.com/v2/acts/linkedin~linkedin-jobs-scraper/runs/${runId}`,
        { headers: { 'Authorization': `Bearer ${apiKey}` } }
      );
      status = statusCheck.data.data.status;
      waitAttempts++;
    }

    // Get results
    const datasetResponse = await axios.get(
      `https://api.apify.com/v2/acts/linkedin~linkedin-jobs-scraper/runs/${runId}/dataset/items`,
      {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        timeout: 15000,
      }
    );

    return (datasetResponse.data || []).map((job: any) => ({
      id: `apify-linkedin-${job.id || Date.now()}`,
      title: job.title || '',
      company: job.company || 'Unknown',
      location: job.location || '',
      description: job.description || '',
      url: job.url || '',
      salary: job.salary || undefined,
      postedDate: job.postedAt || undefined,
      source: 'LinkedIn (Apify)',
    }));
  } catch (error: any) {
    console.error('Apify LinkedIn error:', error.message);
  }

  // Try Indeed scraper if LinkedIn failed
  try {
    const indeedRun = await axios.post(
      'https://api.apify.com/v2/acts/indeed~indeed-jobs-scraper/runs',
      {
        input: {
          search: params.keywords || 'software engineer',
          location: params.location || 'remote',
          maxResults: 20,
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      }
    );

    const runId = indeedRun.data.id;
    let status = 'RUNNING';
    let waitAttempts = 0;
    while (status === 'RUNNING' && waitAttempts < APIFY_RUN_STATUS_MAX_ATTEMPTS) {
      await new Promise(resolve => setTimeout(resolve, APIFY_RUN_STATUS_POLL_INTERVAL_MS));
      const statusCheck = await axios.get(
        `https://api.apify.com/v2/acts/indeed~indeed-jobs-scraper/runs/${runId}`,
        { headers: { 'Authorization': `Bearer ${apiKey}` } }
      );
      status = statusCheck.data.data.status;
      waitAttempts++;
    }

    const datasetResponse = await axios.get(
      `https://api.apify.com/v2/acts/indeed~indeed-jobs-scraper/runs/${runId}/dataset/items`,
      { headers: { 'Authorization': `Bearer ${apiKey}` }, timeout: 15000 }
    );

    return (datasetResponse.data || []).map((job: any) => ({
      id: `apify-indeed-${job.id || Date.now()}`,
      title: job.title || '',
      company: job.company || 'Unknown',
      location: job.location || '',
      description: job.description || '',
      url: job.url || '',
      source: 'Indeed (Apify)',
    }));
  } catch (error: any) {
    console.error('Apify Indeed error:', error.message);
  }

  return [];
}

// ── Remotive (free, no key needed) ──

async function searchRemotive(params: JobSearchParams): Promise<Job[]> {
  try {
    const search = encodeURIComponent(params.keywords || 'software');
    const response = await axios.get(
      `https://remotive.com/api/remote-jobs?search=${search}&limit=30`,
      { timeout: 15000 }
    );

    return (response.data.jobs || []).map((job: any) => ({
      id: `remotive-${job.id}`,
      title: job.title || '',
      company: job.company_name || 'Unknown',
      location: 'Remote',
      description: job.description || '',
      url: job.url || '',
      salary: job.salary || undefined,
      postedDate: job.publication_date || undefined,
      source: 'Remotive',
    }));
  } catch (error: any) {
    console.error('Remotive error:', error.message);
    return [];
  }
}

// ── We Work Remotely ──

async function searchWeWorkRemotely(params: JobSearchParams): Promise<Job[]> {
  try {
    const search = encodeURIComponent(params.keywords || 'software engineer');
    const response = await axios.get(
      `https://weworkremotely.com/api/jobs?search=${search}`,
      { timeout: 15000 }
    );

    return (response.data.jobs || []).map((job: any) => ({
      id: `weworkremotely-${job.id}`,
      title: job.title || '',
      company: job.company || 'Unknown',
      location: 'Remote',
      description: job.description || '',
      url: `https://weworkremotely.com/jobs/${job.id}`,
      salary: job.salary_max ? `$${job.salary_min} - $${job.salary_max}` : undefined,
      postedDate: job.published_at || undefined,
      source: 'We Work Remotely',
    }));
  } catch (error: any) {
    console.error('WeWorkRemotely error:', error.message);
    return [];
  }
}

// ── Remote OK ──

async function searchRemoteOK(params: JobSearchParams): Promise<Job[]> {
  try {
    const search = encodeURIComponent(params.keywords || 'software');
    const response = await axios.get(
      `https://remoteok.com/api?search=${search}`,
      { timeout: 15000 }
    );

    return (response.data || []).slice(1).map((job: any) => ({
      id: `remoteok-${job.id}`,
      title: job.position || '',
      company: job.company || 'Unknown',
      location: 'Remote',
      description: job.description || '',
      url: job.url ? `https://remoteok.com${job.url}` : '',
      salary: job.salary_max ? `$${job.salary_min} - $${job.salary_max}` : undefined,
      postedDate: job.date || undefined,
      source: 'Remote OK',
    }));
  } catch (error: any) {
    console.error('RemoteOK error:', error.message);
    return [];
  }
}

// ── Wellfound (formerly AngelList) ──

async function searchWellfound(params: JobSearchParams): Promise<Job[]> {
  try {
    const search = encodeURIComponent(params.keywords || 'software engineer');
    const response = await axios.get(
      `https://api.wellfound.com/v1/jobs?search=${search}&limit=30`,
      { timeout: 15000 }
    );

    return (response.data.jobs || []).map((job: any) => ({
      id: `wellfound-${job.id}`,
      title: job.title || '',
      company: job.company?.name || 'Unknown',
      location: job.remote ? 'Remote' : job.location || '',
      description: job.description || '',
      url: job.url || '',
      salary: job.salary_range ? `${job.salary_range[0]} - ${job.salary_range[1]}` : undefined,
      postedDate: job.posted_at || undefined,
      source: 'Wellfound',
    }));
  } catch (error: any) {
    console.error('Wellfound error:', error.message);
    return [];
  }
}

// ── Remote.co ──

async function searchRemoteCo(params: JobSearchParams): Promise<Job[]> {
  try {
    const search = encodeURIComponent(params.keywords || 'software');
    const response = await axios.get(
      `https://remote.co/remote-jobs/api?search=${search}`,
      { timeout: 15000 }
    );

    return (response.data.jobs || []).map((job: any) => ({
      id: `remoteco-${job.id}`,
      title: job.title || '',
      company: job.company || 'Unknown',
      location: 'Remote',
      description: job.description || '',
      url: job.url || '',
      salary: job.salary || undefined,
      postedDate: job.published_at || undefined,
      source: 'Remote.co',
    }));
  } catch (error: any) {
    console.error('RemoteCo error:', error.message);
    return [];
  }
}

// ── FlexJobs ──

async function searchFlexJobs(params: JobSearchParams, userApiKeys?: UserApiKeys): Promise<Job[]> {
  const apiKey = userApiKeys?.flexjobs || process.env.FLEXJOBS_API_KEY;
  if (!apiKey) return [];

  try {
    const search = encodeURIComponent(params.keywords || 'software');
    const response = await axios.get(
      `https://www.flexjobs.com/api/v1/jobs?search=${search}&limit=30`,
      { 
        timeout: 15000,
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        }
      }
    );

    return (response.data.jobs || []).map((job: any) => ({
      id: `flexjobs-${job.id}`,
      title: job.title || '',
      company: job.company || 'Unknown',
      location: job.is_remote ? 'Remote' : job.location || '',
      description: job.description || '',
      url: job.url || '',
      salary: job.salary || undefined,
      postedDate: job.posted_date || undefined,
      source: 'FlexJobs',
    }));
  } catch (error: any) {
    console.error('FlexJobs error:', error.message);
    return [];
  }
}

// ── Jooble ──

async function searchJooble(params: JobSearchParams, userApiKeys?: UserApiKeys): Promise<Job[]> {
  const apiKey = userApiKeys?.jooble || process.env.JOOBLE_API_KEY;
  if (!apiKey) return [];

  try {
    const response = await axios.post(
      `https://jooble.org/api/${apiKey}`,
      {
        keywords: params.keywords || 'software engineer',
        location: params.location || '',
        radius: 50,
      },
      { timeout: 15000 }
    );

    return (response.data.jobs || []).map((job: any, i: number) => ({
      id: `jooble-${job.id || i}-${Date.now()}`,
      title: job.title || '',
      company: job.company || 'Unknown',
      location: job.location || '',
      description: job.snippet || '',
      url: job.link || '',
      salary: job.salary || undefined,
      postedDate: job.updated || undefined,
      source: 'Jooble',
    }));
  } catch (error: any) {
    console.error('Jooble error:', error.message);
    return [];
  }
}

// ── Indeed (Publisher API) ──

async function searchIndeed(params: JobSearchParams, userApiKeys?: UserApiKeys): Promise<Job[]> {
  const publisherKey = userApiKeys?.indeed || process.env.INDEED_PUBLISHER_KEY;
  if (!publisherKey) return [];

  try {
    const query = new URLSearchParams({
      publisher: publisherKey,
      q: params.keywords || 'software engineer',
      l: params.location || '',
      sort: 'date',
      radius: '50',
      jt: params.fullTime ? 'fulltime' : '',
      fromage: '7',
      format: 'json',
      v: '2',
    });
    if (params.remote) query.set('remotejob', '1');

    const response = await axios.get(
      `https://api.indeed.com/ads/apisearch?${query}`,
      { timeout: 15000 }
    );

    return (response.data.results || []).map((job: any) => ({
      id: `indeed-${job.jobkey || Date.now()}`,
      title: job.jobtitle || '',
      company: job.company || 'Unknown',
      location: [job.city, job.state, job.country].filter(Boolean).join(', '),
      description: job.snippet || '',
      url: job.url || '',
      salary: job.formattedRelativeTime || undefined,
      postedDate: job.date || undefined,
      source: 'Indeed',
    }));
  } catch (error: any) {
    console.error('Indeed error:', error.message);
    return [];
  }
}

// ── Adzuna ──

async function searchAdzuna(params: JobSearchParams, userApiKeys?: UserApiKeys): Promise<Job[]> {
  const userAdzuna = userApiKeys?.adzuna;
  const appId = userAdzuna?.appId || process.env.ADZUNA_APP_ID;
  const apiKey = userAdzuna?.apiKey || process.env.ADZUNA_API_KEY;
  if (!appId || !apiKey) return [];

  try {
    const what = encodeURIComponent(params.keywords || 'software engineer');
    const where = encodeURIComponent(params.location || '');
    const url = `https://api.adzuna.com/v1/api/jobs/us/search/1?app_id=${appId}&app_key=${apiKey}&what=${what}&where=${where}&sort_by=date&max_days_old=7&results_per_page=25`;

    const response = await axios.get(url, { timeout: 15000 });

    return (response.data.results || []).map((job: any) => ({
      id: `adzuna-${job.id}`,
      title: job.title || '',
      company: job.company?.display_name || 'Unknown',
      location: job.location?.display_name || '',
      description: job.description || '',
      url: job.redirect_url || '',
      salary: job.salary_is_predicted === '0'
        ? `${job.salary_min} - ${job.salary_max}`
        : undefined,
      postedDate: job.created || undefined,
      source: 'Adzuna',
    }));
  } catch (error: any) {
    console.error('Adzuna error:', error.message);
    return [];
  }
}

// ── GitHub Jobs (via arbeitnow proxy) ──

async function searchGitHubJobs(params: JobSearchParams): Promise<Job[]> {
  try {
    const search = encodeURIComponent(params.keywords || 'software engineer');
    const response = await axios.get(
      `https://www.arbeitnow.com/api/job-board-api?search=${search}&per_page=25`,
      { timeout: 15000 }
    );

    return (response.data.data || []).map((job: any) => ({
      id: `arbeitnow-${job.slug}`,
      title: job.title || '',
      company: job.company_name || 'Unknown',
      location: job.location || '',
      description: job.description || '',
      url: job.url || '',
      salary: undefined,
      postedDate: job.created_at || undefined,
      source: 'Arbeitnow',
    }));
  } catch (error: any) {
    console.error('Arbeitnow error:', error.message);
    return [];
  }
}

// ── Full Job Description Extractor ──

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function getJobDescription(url: string): Promise<string> {
  try {
    await ssrfGuard(url);
  } catch (guardError) {
    console.error(`SSRF protection blocked getJobDescription for ${url}:`, guardError);
    return '';
  }

  const commonHeaders = {
    'User-Agent': 'AI-Resume-Tracker/1.0 (+https://example.com/contact)',
    Accept: 'text/html,application/xhtml+xml',
  };

  try {
    const response = await axios.get(url, {
      timeout: 5000, // 5 second timeout
      headers: commonHeaders,
      maxRedirects: 3,
      maxContentLength: 50 * 1024, // 50KB max response size
    });

    const html = response.data;

    const jsonLdDescription = extractJsonLdDescription(html);
    if (jsonLdDescription) {
      return jsonLdDescription.substring(0, JOB_DESCRIPTION_MAX_LENGTH);
    }

    const metaDescription = extractMetaDescription(html);
    if (metaDescription && metaDescription.length > 50) {
      return metaDescription.substring(0, JOB_DESCRIPTION_MAX_LENGTH);
    }

    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (bodyMatch) {
      return stripHtmlTags(bodyMatch[1]).substring(0, JOB_DESCRIPTION_FALLBACK_MAX_LENGTH);
    }

    return '';
  } catch (error: any) {
    const message = error?.message || String(error);
    if (error?.code === 'ECONNABORTED') {
      console.error(`Timeout fetching JD from ${url}:`, message);
    } else if (error?.code === 'ERR_STREAM_CONTENT_LENGTH_AFTER_CLOSE' || error?.message?.includes('maxContentLength')) {
      console.error(`Response too large from ${url}:`, message);
    } else if (error?.response?.status === 429) {
      console.error(`Rate limit exceeded fetching JD from ${url}:`, message);
    } else {
      console.error(`Error fetching JD from ${url}:`, message);
    }
    return '';
  }
}

function extractJsonLdDescription(html: string): string | null {
  const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
  if (!jsonLdMatch) {
    return null;
  }

  try {
    const json = JSON.parse(jsonLdMatch[1]);
    if (json['@type'] === 'JobPosting' && json.description) {
      return stripHtmlTags(json.description);
    }

    if (Array.isArray(json)) {
      for (const item of json) {
        if (item['@type'] === 'JobPosting' && item.description) {
          return stripHtmlTags(item.description);
        }
      }
    }
  } catch (error: any) {
    console.warn('Failed to parse JSON-LD job description:', error?.message || String(error));
  }

  return null;
}

function extractMetaDescription(html: string): string | null {
  const metaDescMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/i);
  if (metaDescMatch && metaDescMatch[1]) {
    return metaDescMatch[1];
  }

  const ogDescMatch = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"/i);
  if (ogDescMatch && ogDescMatch[1]) {
    return ogDescMatch[1];
  }

  return null;
}

// ── Internshala via Apify ──

async function searchInternshala(params: JobSearchParams, userApiKeys?: UserApiKeys): Promise<Job[]> {
  const apiKey = userApiKeys?.internshala || userApiKeys?.apify || process.env.APIFY_API_KEY;
  if (!apiKey) return [];

  try {
    // Use Apify to scrape Internshala jobs
    // There's a community actor for Internshala or we can create a custom one
    const response = await axios.post(
      'https://api.apify.com/v2/acts/apify~internship-scraper/runs',
      {
        input: {
          searchQueries: params.keywords ? [params.keywords] : ['software'],
          location: params.location || 'India',
          maxResults: 20,
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      }
    );

    const runId = response.data.id;
    
    // Wait for completion
    let status = 'RUNNING';
    let waitAttempts = 0;
    while (status === 'RUNNING' && waitAttempts < APIFY_RUN_STATUS_MAX_ATTEMPTS) {
      await new Promise(resolve => setTimeout(resolve, APIFY_RUN_STATUS_POLL_INTERVAL_MS));
      const statusCheck = await axios.get(
        `https://api.apify.com/v2/acts/apify~internship-scraper/runs/${runId}`,
        { headers: { 'Authorization': `Bearer ${apiKey}` } }
      );
      status = statusCheck.data.data.status;
      waitAttempts++;
    }

    // Get results
    const datasetResponse = await axios.get(
      `https://api.apify.com/v2/acts/apify~internship-scraper/runs/${runId}/dataset/items`,
      {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        timeout: 15000,
      }
    );

    return (datasetResponse.data || []).map((job: any) => ({
      id: `internshala-${job.id || Date.now()}`,
      title: job.title || '',
      company: job.company || 'Unknown',
      location: job.location || 'India',
      description: job.description || '',
      url: job.url || '',
      salary: job.stipend || undefined,
      postedDate: job.postedDate || undefined,
      source: 'Internshala (Apify)',
    }));
  } catch (error: any) {
    console.error('Internshala (Apify) error:', error.message);
  }

  // Fallback: Try general web scraping for Internshala
  try {
    const searchQuery = encodeURIComponent(params.keywords || 'software developer');
    const response = await axios.get(
      `https://internshala.com/search/jobs?search=${searchQuery}`,
      { timeout: 15000 }
    );

    // Parse HTML to extract job listings
    const html = response.data;
    const jobMatches = html.match(/<div class="individual-job-id-[\d]+"[^>]*>[\s\S]*?<\/div>/g) || [];
    
    return jobMatches.slice(0, 10).map((jobHtml: string, i: number) => {
      const titleMatch = jobHtml.match(/<h3[^>]*>([^<]+)<\/h3>/);
      const companyMatch = jobHtml.match(/<a[^>]*company-name[^>]*>([^<]+)<\/a>/);
      const locationMatch = jobHtml.match(/<span[^>]*location[^>]*>([^<]+)<\/span>/);
      const linkMatch = jobHtml.match(/href="([^"]+)"/);
      
      return {
        id: `internshala-web-${i}-${Date.now()}`,
        title: titleMatch?.[1]?.trim() || '',
        company: companyMatch?.[1]?.trim() || 'Unknown',
        location: locationMatch?.[1]?.trim() || 'India',
        description: '',
        url: linkMatch?.[1] ? `https://internshala.com${linkMatch[1]}` : '',
        salary: undefined,
        postedDate: undefined,
        source: 'Internshala',
      };
    });
  } catch (error: any) {
    console.error('Internshala fallback error:', error.message);
  }

  return [];
}
