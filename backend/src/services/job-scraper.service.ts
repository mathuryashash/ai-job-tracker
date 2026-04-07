import axios from 'axios';

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

type SourceSearcher = (params: JobSearchParams) => Promise<Job[]>;

// ── Main Search Aggregator ──

export async function searchJobs(params: JobSearchParams): Promise<Job[]> {
  const sources: SourceSearcher[] = [
    searchApifyJobs,
    searchRemotive,
    searchWeWorkRemotely,
    searchRemoteOK,
    searchWellfound,
    searchRemoteCo,
    searchFlexJobs,
    searchJooble,
    searchIndeed,
    searchAdzuna,
    searchGitHubJobs,
  ];

  const results = await runWithConcurrencyLimit(
    sources,
    SOURCE_CONCURRENCY_LIMIT,
    (fn) => fn(params),
    SOURCE_TIMEOUT_MS
  );

  const jobs: Job[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      jobs.push(...result.value);
    } else {
      console.error('Job source failed:', result.reason?.message || result.reason);
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

async function searchApifyJobs(params: JobSearchParams): Promise<Job[]> {
  const apiKey = process.env.APIFY_API_KEY;
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

async function searchFlexJobs(params: JobSearchParams): Promise<Job[]> {
  const apiKey = process.env.FLEXJOBS_API_KEY;
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

async function searchJooble(params: JobSearchParams): Promise<Job[]> {
  const apiKey = process.env.JOOBLE_API_KEY;
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

async function searchIndeed(params: JobSearchParams): Promise<Job[]> {
  const publisherKey = process.env.INDEED_PUBLISHER_KEY;
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

async function searchAdzuna(params: JobSearchParams): Promise<Job[]> {
  const appId = process.env.ADZUNA_APP_ID;
  const apiKey = process.env.ADZUNA_API_KEY;
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
  const commonHeaders = {
    'User-Agent': 'AI-Resume-Tracker/1.0 (+https://example.com/contact)',
    Accept: 'text/html,application/xhtml+xml',
  };

  try {
    const response = await axios.get(url, {
      timeout: 6000,
      headers: commonHeaders,
      maxRedirects: 3,
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
    if (error?.code === 'ECONNABORTED' || error?.response?.status === 429) {
      console.error(`Timeout/rate-limit fetching JD from ${url}:`, message);
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
