import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import { getCached, setCached } from '../lib/cache';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const AI_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

let _client: AxiosInstance | null = null;

/**
 * Lazy-initialized OpenRouter client.
 * Shared across all services to avoid duplication.
 */
export function getOpenRouterClient(): AxiosInstance {
  if (!_client) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY is not set. Add it to your .env file.');
    }
    _client = axios.create({
      baseURL: OPENROUTER_BASE_URL,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    });
  }
  return _client;
}

// ── Resume Analysis ──

export interface AnalysisResult {
  matchPercentage: number;
  skillsRadar: Record<string, number>;
  missingKeywords: string[];
  suggestions: string[];
}

export async function analyzeResume(
  resumeText: string,
  jobDescription?: string
): Promise<AnalysisResult> {
  const prompt = buildAnalysisPrompt(resumeText, jobDescription);
  const cacheKey = createPromptCacheKey('analyzeResume', prompt);
  const cached = await getCached<AnalysisResult>(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const response = await getOpenRouterClient().post('/chat/completions', {
      model: 'google/gemini-2.5-flash',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = response.data.choices[0].message.content;
    const parsed = parseJsonResponse<AnalysisResult>(responseText, {
      matchPercentage: 0,
      skillsRadar: {},
      missingKeywords: [],
      suggestions: ['Unable to analyze resume. Please try again.'],
    });
    await setCached(cacheKey, parsed, AI_CACHE_TTL_SECONDS);
    return parsed;
  } catch (error) {
    console.error('Resume analysis error:', error);
    throw new Error('Failed to analyze resume');
  }
}

function buildAnalysisPrompt(resumeText: string, jobDescription?: string): string {
  let prompt = `You are an expert resume analyzer. Analyze the following resume and provide a detailed assessment.\n\nRESUME:\n${resumeText}\n\n`;

  if (jobDescription) {
    prompt += `JOB DESCRIPTION:\n${jobDescription}\n\n`;
  }

  prompt += `Provide your analysis in the following JSON format:
{
  "matchPercentage": <number 0-100>,
  "skillsRadar": {
    "technicalSkills": <number 0-100>,
    "communication": <number 0-100>,
    "leadership": <number 0-100>,
    "problemSolving": <number 0-100>,
    "experience": <number 0-100>,
    "education": <number 0-100>
  },
  "missingKeywords": ["keyword1", "keyword2"],
  "suggestions": ["suggestion1", "suggestion2"]
}`;

  return prompt;
}

// ── Cover Letter Generation ──

export async function generateCoverLetter(
  resumeText: string,
  jobDescription: string,
  companyName: string,
  positionTitle: string
): Promise<string> {
  const prompt = `Write a professional cover letter for the position of ${positionTitle} at ${companyName}.

RESUME:
${resumeText}

JOB DESCRIPTION:
${jobDescription}

Write a 3-4 paragraph cover letter that:
1. Introduces the candidate and expresses interest in the position
2. Highlights relevant skills and experience matching the job requirements
3. Demonstrates knowledge of the company and role
4. Ends with a call to action and thank you

Keep it concise, professional, and tailored to the specific job. Do NOT fabricate experience.`;
  const cacheKey = createPromptCacheKey('generateCoverLetter', prompt);
  const cached = await getCached<string>(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const response = await getOpenRouterClient().post('/chat/completions', {
      model: 'google/gemini-2.5-flash',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.data.choices[0].message.content;
    await setCached(cacheKey, content, AI_CACHE_TTL_SECONDS);
    return content;
  } catch (error) {
    console.error('Cover letter generation error:', error);
    throw new Error('Failed to generate cover letter');
  }
}

// ── Job Matching ──

export interface MatchResult {
  matchPercentage: number;
  matchedSkills: string[];
  missingSkills: string[];
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
}

export async function matchResumeToJob(
  resumeText: string,
  jobDescription: string
): Promise<MatchResult> {
  const prompt = `You are an expert resume-job matcher. Compare the resume against the job description and provide a detailed analysis.

RESUME:
${resumeText}

JOB DESCRIPTION:
${jobDescription}

Provide your analysis in the following JSON format:
{
  "matchPercentage": <number 0-100>,
  "matchedSkills": ["skill1", "skill2"],
  "missingSkills": ["skill1", "skill2"],
  "strengths": ["strength1", "strength2"],
  "weaknesses": ["weakness1", "weakness2"],
  "recommendations": ["recommendation1", "recommendation2"]
}`;
  const cacheKey = createPromptCacheKey('matchResumeToJob', prompt);
  const cached = await getCached<MatchResult>(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const response = await getOpenRouterClient().post('/chat/completions', {
      model: 'google/gemini-2.5-flash',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = response.data.choices[0].message.content;
    const parsed = parseJsonResponse<MatchResult>(responseText, {
      matchPercentage: 0,
      matchedSkills: [],
      missingSkills: [],
      strengths: [],
      weaknesses: [],
      recommendations: ['Unable to analyze. Please try again.'],
    });
    await setCached(cacheKey, parsed, AI_CACHE_TTL_SECONDS);
    return parsed;
  } catch (error) {
    console.error('Job matching error:', error);
    return {
      matchPercentage: 0,
      matchedSkills: [],
      missingSkills: [],
      strengths: [],
      weaknesses: [],
      recommendations: ['Unable to analyze. Please try again.'],
    };
  }
}

// ── Resume Tailoring ──

export interface TailoredResume {
  summary: string;
  skills: string[];
  experience: string;
  education: string;
  fullResume: string;
}

export async function tailorResume(
  resumeText: string,
  jobDescription: string
): Promise<TailoredResume> {
  const prompt = `You are an expert resume writer. Tailor the following resume to better match the job description.

IMPORTANT: Only include information that is TRUE and accurate. Do NOT make up skills, experiences, or qualifications the person doesn't have. Instead, REFRAME existing experience to highlight relevant aspects.

Resume:
${resumeText}

Job Description:
${jobDescription}

Provide a tailored resume in the following JSON format:
{
  "summary": "2-3 sentence professional summary",
  "skills": ["skill1", "skill2", "skill3"],
  "experience": "Rewritten experience section with bullet points",
  "education": "Education section",
  "fullResume": "Complete tailored resume as plain text"
}`;
  const cacheKey = createPromptCacheKey('tailorResume', prompt);
  const cached = await getCached<TailoredResume>(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const response = await getOpenRouterClient().post('/chat/completions', {
      model: 'google/gemini-2.5-flash',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = response.data.choices[0].message.content;
    const parsed = parseJsonResponse<TailoredResume>(responseText, {
      summary: 'Unable to tailor resume. Please try again.',
      skills: [],
      experience: '',
      education: '',
      fullResume: resumeText,
    });
    await setCached(cacheKey, parsed, AI_CACHE_TTL_SECONDS);
    return parsed;
  } catch (error) {
    console.error('Resume tailoring error:', error);
    return {
      summary: 'Unable to tailor resume. Please try again.',
      skills: [],
      experience: '',
      education: '',
      fullResume: resumeText,
    };
  }
}

// ── Shared JSON Parser ──

export function parseJsonResponse<T>(response: string, fallback: T): T {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return { ...fallback, ...JSON.parse(jsonMatch[0]) };
    }
  } catch (e) {
    console.error('Failed to parse AI response:', e);
  }
  return fallback;
}

function createPromptCacheKey(namespace: string, prompt: string): string {
  const fingerprint = crypto.createHash('sha256').update(prompt).digest('hex');
  return `ai:${namespace}:${fingerprint}`;
}
