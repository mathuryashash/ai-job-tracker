import crypto from 'crypto';
import { getOpenRouterClient } from './ai.service';
import { getCached, setCached } from '../lib/cache';

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
  const prompt = buildTailoringPrompt(resumeText, jobDescription);
  const cacheKey = createCacheKey('tailorResume', prompt);
  const cached = await getCached<TailoredResume>(cacheKey);
  if (cached) {
    return cached;
  }
  
  try {
    const response = await getOpenRouterClient().post(
      '/chat/completions',
      {
        model: 'google/gemini-2.5-flash',
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }
    );

    const responseText = response.data.choices[0].message.content;
    const parsed = parseTailoredResume(responseText);
    await setCached(cacheKey, parsed, 7 * 24 * 60 * 60);
    return parsed;
  } catch (error) {
    console.error('OpenRouter tailoring error:', error);
    return {
      summary: 'Unable to tailor resume. Please try again.',
      skills: [],
      experience: '',
      education: '',
      fullResume: resumeText,
    };
  }
}

function buildTailoringPrompt(resumeText: string, jobDescription: string): string {
  return `You are an expert resume writer. Tailor the following resume to better match the job description. 

IMPORTANT: Only include information that is TRUE and accurate. Do NOT make up skills, experiences, or qualifications the person doesn't have. Instead, REFRAME existing experience to highlight relevant aspects.

Resume:
${resumeText}

Job Description:
${jobDescription}

Provide a tailored resume in the following JSON format. Focus on:
1. A professional summary that highlights relevant experience
2. Skills section prioritizing job-relevant skills
3. Work experience rewritten to emphasize relevant achievements
4. Education section
5. Full resume combining all sections

{
  "summary": "2-3 sentence professional summary",
  "skills": ["skill1", "skill2", "skill3"],
  "experience": "Rewritten experience section with bullet points",
  "education": "Education section",
  "fullResume": "Complete tailored resume as plain text"
}`;
}

function parseTailoredResume(response: string): TailoredResume {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summary: parsed.summary || '',
        skills: parsed.skills || [],
        experience: parsed.experience || '',
        education: parsed.education || '',
        fullResume: parsed.fullResume || '',
      };
    }
  } catch (e) {
    console.error('Failed to parse tailored resume:', e);
  }

  return {
    summary: 'Unable to tailor resume. Please try again.',
    skills: [],
    experience: '',
    education: '',
    fullResume: '',
  };
}

export async function generateResumeBulletPoints(
  experience: string,
  jobDescription: string
): Promise<string[]> {
  const prompt = `You are an expert resume writer. Generate 5-7 impactful bullet points for work experience that match the job description.

Current Experience:
${experience}

Job Description:
${jobDescription}

Generate bullet points that:
- Start with action verbs (Led, Developed, Implemented, Achieved, etc.)
- Include quantifiable metrics where possible
- Highlight relevant skills and technologies
- Match keywords from the job description

Provide as a JSON array of strings:
["bullet1", "bullet2", "bullet3", "bullet4", "bullet5", "bullet6", "bullet7"]`;
  const cacheKey = createCacheKey('generateResumeBulletPoints', prompt);
  const cached = await getCached<string[]>(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const response = await getOpenRouterClient().post(
      '/chat/completions',
      {
        model: 'google/gemini-2.5-flash',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }
    );

    const responseText = response.data.choices[0].message.content;
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      await setCached(cacheKey, parsed, 7 * 24 * 60 * 60);
      return parsed;
    }
  } catch (error) {
    console.error('Error generating bullet points:', error);
  }

  return [];
}

function createCacheKey(namespace: string, prompt: string, userId?: string, jobId?: string): string {
   const fingerprint = crypto.createHash('sha256').update(prompt).digest('hex');
   const userPart = userId ? `:user:${userId}` : '';
   const jobPart = jobId ? `:job:${jobId}` : '';
   return `resume:${namespace}${userPart}${jobPart}:${fingerprint}`;
}
