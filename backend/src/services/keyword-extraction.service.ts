import crypto from 'crypto';
import { getOpenRouterClient } from './ai.service';
import { getCached, setCached } from '../lib/cache';

export interface ExtractedKeywords {
  searchQueries: string[];
  skills: string[];
  roleType: 'internship' | 'job' | 'both';
  suggestedTitles: string[];
}

export async function extractKeywordsFromResume(
  resumeText: string
): Promise<ExtractedKeywords> {
  const hash = crypto.createHash('sha256').update(resumeText).digest('hex');
  const cacheKey = `keywords:${hash}`;
  const cached = await getCached<ExtractedKeywords>(cacheKey);
  if (cached) {
    return cached;
  }

  const prompt = `Analyze this resume and extract job search keywords. Be specific and targeted.

RESUME:
${resumeText.substring(0, 4000)}

Respond in JSON only:
{
  "searchQueries": ["query1", "query2", "query3", "query4", "query5"],
  "skills": ["skill1", "skill2", ...],
  "roleType": "internship" or "job" or "both",
  "suggestedTitles": ["title1", "title2", "title3"]
}

Rules for searchQueries:
- Generate 3-5 optimized search strings combining role + key skills
- Example: "React frontend developer", "Python data science intern", "full stack Node.js developer"
- If the person appears to be a student (B.Tech, university, GPA mentioned), include internship queries
- Keep each query under 5 words

Rules for roleType:
- "internship" if resume shows student/fresh graduate indicators
- "job" if resume shows 2+ years experience
- "both" if unclear or mixed signals

Rules for skills:
- Extract 8-15 technical skills from the resume
- Include programming languages, frameworks, tools, platforms
- Be specific (e.g., "React" not "frontend")

Rules for suggestedTitles:
- 3-5 job titles that match the person's experience level
- Example: "Junior Software Engineer", "React Developer Intern", "Data Analyst"`;

  try {
    const response = await getOpenRouterClient().post('/chat/completions', {
      model: 'google/gemini-2.5-flash',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = response.data.choices?.[0]?.message?.content;
    if (!responseText) {
      console.error('Empty response from AI');
      return fallbackKeywords(resumeText);
    }
    const parsed = parseKeywordsResponse(responseText);
    await setCached(cacheKey, parsed, 7 * 24 * 60 * 60);
    return parsed;
  } catch (error) {
    console.error('Keyword extraction error:', error);
    return fallbackKeywords(resumeText);
  }
}

function parseKeywordsResponse(response: string): ExtractedKeywords {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        searchQueries: Array.isArray(parsed.searchQueries) ? parsed.searchQueries.slice(0, 5) : [],
        skills: Array.isArray(parsed.skills) ? parsed.skills.slice(0, 15) : [],
        roleType: ['internship', 'job', 'both'].includes(parsed.roleType) ? parsed.roleType : 'both',
        suggestedTitles: Array.isArray(parsed.suggestedTitles) ? parsed.suggestedTitles.slice(0, 5) : [],
      };
    }
  } catch (e) {
    console.error('Failed to parse keywords response:', e);
  }
  return { searchQueries: [], skills: [], roleType: 'both', suggestedTitles: [] };
}

function fallbackKeywords(resumeText: string): ExtractedKeywords {
  const text = resumeText.toLowerCase();
  const skillPatterns = [
    'javascript', 'typescript', 'python', 'java', 'react', 'node', 'angular',
    'vue', 'docker', 'kubernetes', 'aws', 'sql', 'mongodb', 'git', 'html', 'css',
    'machine learning', 'data science', 'flutter', 'swift', 'kotlin', 'go', 'rust',
  ];

  const foundSkills = skillPatterns.filter(s => text.includes(s));
  const isStudent = text.includes('b.tech') || text.includes('university') || text.includes('student') || text.includes('gpa');

  return {
    searchQueries: foundSkills.slice(0, 3).map(s => `${s} ${isStudent ? 'intern' : 'developer'}`),
    skills: foundSkills,
    roleType: isStudent ? 'internship' : 'job',
    suggestedTitles: [isStudent ? 'Software Developer Intern' : 'Software Developer'],
  };
}

export function mergeSearchQueriesWithLocation(
  queries: string[],
  location?: string
): string[] {
  if (!location) return queries;
  return queries.map(q => `${q} ${location}`);
}
