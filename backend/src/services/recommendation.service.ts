import { getCached, setCache } from './cache.service';
import prisma from '../prisma/index';

export interface JobRecommendation {
  job: {
    id: string;
    title: string;
    company: string;
    location: string;
    description: string;
    url: string;
    salary: string | null;
    postedDate: Date | null;
    source: string;
    matchScore: number | null;
  };
  score: number;
  reasons: string[];
}

interface ResumeStructuredData {
  skills?: {
    technical?: string[];
    soft?: string[];
  };
  experience?: {
    title?: string;
    years?: number;
    level?: string;
  }[];
  education?: {
    degree?: string;
    field?: string;
  }[];
}

interface UserPreferences {
  location?: string;
  remoteOnly?: boolean;
  jobTypes?: string[];
  salaryRange?: {
    min?: number;
    max?: number;
  };
}

/**
 * Get personalized job recommendations for a user
 * Uses a scoring algorithm based on:
 * - Skill match (40%)
 * - Experience level match (20%)
 * - Location preference (20%)
 * - Source quality (10%)
 * - Recent posting bonus (10%)
 */
export async function getJobRecommendations(
  userId: string,
  limit: number = 10
): Promise<JobRecommendation[]> {
  const cacheKey = `recommendations:${userId}`;
  
  // Check cache first
  const cached = await getCached<JobRecommendation[]>(cacheKey);
  if (cached) {
    return cached.slice(0, limit);
  }

  // Get user's latest resume
  const resume = await prisma.resume.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      extractedText: true,
      structuredData: true,
    },
  });

  if (!resume) {
    return [];
  }

  // Get user's search preferences
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { preferences: true },
  });
  
  const prefs = (user?.preferences as UserPreferences) || {};

  // Get recent scraped jobs (last 7 days, max 100)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentJobs = await prisma.scrapedJob.findMany({
    where: {
      userId,
      createdAt: { gte: sevenDaysAgo },
      status: { in: ['new', 'matched'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  if (recentJobs.length === 0) {
    return [];
  }

  // Parse resume structured data
  const structuredData = (resume.structuredData as ResumeStructuredData) || {};
  
  // Calculate score for each job
  const recommendations = recentJobs.map((job) => {
    const score = calculateJobScore(job, resume.extractedText || '', structuredData, prefs);
    const reasons = generateReasons(job, structuredData, score);
    
    return {
      job: {
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        description: job.description,
        url: job.url,
        salary: job.salary,
        postedDate: job.postedDate,
        source: job.source,
        matchScore: job.matchScore,
      },
      score: Math.round(score * 10) / 10, // Round to 1 decimal
      reasons,
    };
  });

  // Sort by score descending
  recommendations.sort((a, b) => b.score - a.score);

  // Cache for 30 minutes
  await setCache(cacheKey, recommendations, 30 * 60);

  return recommendations.slice(0, limit);
}

/**
 * Calculate job score based on multiple factors
 */
function calculateJobScore(
  job: { description: string; location: string; source: string; postedDate: Date | null; createdAt: Date },
  resumeText: string,
  structuredData: ResumeStructuredData,
  prefs: UserPreferences
): number {
  let score = 0;

  // 1. Skill match score (40%)
  const skillScore = calculateSkillMatch(job.description, resumeText, structuredData);
  score += skillScore * 0.4;

  // 2. Experience level match (20%)
  const experienceScore = calculateExperienceMatch(job.description, structuredData);
  score += experienceScore * 0.2;

  // 3. Location preference match (20%)
  const locationScore = calculateLocationMatch(job.location, prefs);
  score += locationScore * 0.2;

  // 4. Source quality score (10%)
  const sourceScore = getSourceQualityScore(job.source);
  score += sourceScore * 0.1;

  // 5. Recent posting bonus (10%)
  const recencyScore = calculateRecencyScore(job.postedDate, job.createdAt);
  score += recencyScore * 0.1;

  return Math.min(score, 100);
}

/**
 * Calculate skill match score based on resume skills and job description
 */
function calculateSkillMatch(
  jobDescription: string,
  resumeText: string,
  structuredData: ResumeStructuredData
): number {
  const jobDescLower = jobDescription.toLowerCase();
  
  // Get technical skills from structured data
  const technicalSkills = structuredData?.skills?.technical || [];
  const softSkills = structuredData?.skills?.soft || [];
  const allSkills = [...technicalSkills, ...softSkills];
  
  if (allSkills.length === 0) {
    // Fallback: extract skills from resume text
    const commonTechSkills = [
      'javascript', 'typescript', 'python', 'java', 'react', 'angular', 'vue',
      'node', 'express', 'django', 'flask', 'spring', 'sql', 'mysql', 'postgresql',
      'mongodb', 'redis', 'docker', 'kubernetes', 'aws', 'gcp', 'azure',
      'git', 'linux', 'html', 'css', 'rest', 'graphql', 'api', 'agile', 'scrum',
      'typescript', 'nextjs', 'nestjs', 'fastapi', 'prisma', 'tailwind', 'sass',
      'go', 'rust', 'c++', 'c#', '.net', 'php', 'ruby', 'rails', 'swift', 'kotlin',
    ];
    
    const matchedSkills = commonTechSkills.filter(skill => 
      resumeText.toLowerCase().includes(skill) && jobDescLower.includes(skill)
    );
    return Math.min(matchedSkills.length * 8, 40);
  }

  // Count matching skills
  const matchedSkills = allSkills.filter(skill => 
    jobDescLower.includes(skill.toLowerCase())
  );
  
  // Score: 8 points per skill match, max 40
  return Math.min(matchedSkills.length * 8, 40);
}

/**
 * Calculate experience level match score
 */
function calculateExperienceMatch(
  jobDescription: string,
  structuredData: ResumeStructuredData
): number {
  const jobDescLower = jobDescription.toLowerCase();
  
  // Get user's experience level from structured data
  const experience = structuredData?.experience?.[0];
  const userYears = experience?.years || 0;
  const userLevel = experience?.level?.toLowerCase() || '';
  
  // Determine job experience requirements from description
  let jobRequiredYears = 0;
  let jobLevel = 'mid';
  
  // Parse years from job description
  const yearPatterns = [
    /(\d+)\+?\s*years?\s*(?:of\s*)?experience/i,
    /(\d+)\+\s*yrs/i,
    /minimum\s*(\d+)\s*years?/i,
    /(\d+)-(\d+)\s*years?/i,
  ];
  
  for (const pattern of yearPatterns) {
    const match = jobDescLower.match(pattern);
    if (match) {
      jobRequiredYears = parseInt(match[1], 10);
      break;
    }
  }
  
  // Determine job level
  if (jobDescLower.includes('senior') || jobDescLower.includes('sr.') || jobDescLower.includes('lead') || jobDescLower.includes('principal') || jobDescLower.includes('staff')) {
    jobLevel = 'senior';
  } else if (jobDescLower.includes('junior') || jobDescLower.includes('jr.') || jobDescLower.includes('entry') || jobDescLower.includes('intern')) {
    jobLevel = 'junior';
  }
  
  // Calculate match score
  if (jobRequiredYears > 0) {
    const yearsDiff = Math.abs(userYears - jobRequiredYears);
    if (yearsDiff <= 1) return 20;
    if (yearsDiff <= 2) return 15;
    if (yearsDiff <= 3) return 10;
    return 5;
  }
  
  // Level-based matching
  if (userLevel === jobLevel) return 20;
  if (userLevel === 'senior' && jobLevel === 'mid') return 15;
  if (userLevel === 'mid' && jobLevel === 'senior') return 10;
  if (userLevel === 'junior' && (jobLevel === 'mid' || jobLevel === 'senior')) return 5;
  
  return 10; // Default partial match
}

/**
 * Calculate location preference match score
 */
function calculateLocationMatch(jobLocation: string, prefs: UserPreferences): number {
  if (!prefs.location && !prefs.remoteOnly) {
    return 10; // No preferences, give partial score
  }
  
  const locationLower = jobLocation.toLowerCase();
  
  // Check remote preference
  if (prefs.remoteOnly && (
    locationLower.includes('remote') || 
    locationLower.includes('work from home') ||
    locationLower.includes('wfh')
  )) {
    return 20;
  }
  
  // Check specific location preference
  if (prefs.location) {
    if (locationLower.includes(prefs.location.toLowerCase())) {
      return 20;
    }
    // Partial match
    const prefsParts = prefs.location.toLowerCase().split(/[\s,]+/);
    const matchedParts = prefsParts.filter(part => part.length > 2 && locationLower.includes(part));
    if (matchedParts.length > 0) {
      return Math.max(5, 20 - (prefsParts.length - matchedParts.length) * 5);
    }
  }
  
  return 0; // No match
}

/**
 * Get source quality score
 */
function getSourceQualityScore(source: string): number {
  const sourceScores: Record<string, number> = {
    'LinkedIn': 10,
    'Indeed': 8,
    'Remotive': 7,
    'Remote OK': 6,
    'We Work Remotely': 7,
    'Jooble': 6,
    'Adzuna': 6,
    'GitHub': 9,
    'Wellfound': 7,
    'FlexJobs': 8,
  };
  
  return sourceScores[source] || 5;
}

/**
 * Calculate recency score based on posting date
 */
function calculateRecencyScore(postedDate: Date | null, createdAt: Date): number {
  const now = Date.now();
  
  // Use postedDate if available, otherwise fall back to createdAt
  const jobDate = postedDate || createdAt;
  const daysOld = (now - new Date(jobDate).getTime()) / (1000 * 60 * 60 * 24);
  
  // Fresh jobs get full score, decreasing over time
  if (daysOld <= 1) return 10;
  if (daysOld <= 3) return 8;
  if (daysOld <= 7) return 6;
  if (daysOld <= 14) return 4;
  if (daysOld <= 30) return 2;
  
  return 0;
}

/**
 * Generate human-readable reasons for the recommendation
 */
function generateReasons(
  job: { salary: string | null; postedDate: Date | null; source: string },
  structuredData: ResumeStructuredData,
  score: number
): string[] {
  const reasons: string[] = [];
  
  // High score reason
  if (score >= 70) {
    reasons.push('Strong overall match');
  } else if (score >= 50) {
    reasons.push('Good match for your skills');
  }
  
  // Salary information
  if (job.salary) {
    reasons.push('Salary information available');
  }
  
  // Recent posting
  if (job.postedDate) {
    const hoursOld = (Date.now() - new Date(job.postedDate).getTime()) / (1000 * 60 * 60);
    if (hoursOld < 24) {
      reasons.push('Posted within the last 24 hours');
    } else if (hoursOld < 72) {
      reasons.push('Posted recently');
    }
  }
  
  // Premium source
  const premiumSources = ['LinkedIn', 'GitHub', 'Indeed'];
  if (premiumSources.includes(job.source)) {
    reasons.push(`From ${job.source}`);
  }
  
  // Skill-specific reason
  const technicalSkills = structuredData?.skills?.technical || [];
  if (technicalSkills.length > 0) {
    reasons.push(`Matches your ${technicalSkills.slice(0, 2).join(', ')} skills`);
  }
  
  return reasons.slice(0, 3); // Limit to 3 reasons
}

/**
 * Invalidate user's recommendation cache (call when resume or preferences change)
 */
export async function invalidateRecommendationCache(userId: string): Promise<void> {
  const cacheKey = `recommendations:${userId}`;
  await setCache(cacheKey, null as any, 1); // Expire immediately
}