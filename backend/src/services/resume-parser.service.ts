import { getOpenRouterClient, parseJsonResponse } from './ai.service';

/**
 * Interface for structured resume data extracted by AI
 */
export interface ContactInfo {
  name?: string;
  email?: string;
  phone?: string;
  location?: string;
  linkedin?: string;
  github?: string;
}

export interface Experience {
  company: string;
  title: string;
  duration?: string;
  description?: string;
}

export interface Education {
  school: string;
  degree: string;
  year?: string;
}

export interface Skills {
  technical: string[];
  soft: string[];
}

export interface Project {
  name: string;
  description: string;
}

export interface ParsedResume {
  contactInfo?: ContactInfo;
  summary?: string;
  experience: Experience[];
  education: Education[];
  skills: Skills;
  certifications: string[];
  projects: Project[];
}

/**
 * Parse a resume using Claude API to extract structured data
 */
export async function parseResumeWithAI(extractedText: string): Promise<ParsedResume> {
  const defaultParsed: ParsedResume = {
    experience: [],
    education: [],
    skills: { technical: [], soft: [] },
    certifications: [],
    projects: [],
  };

  // If no text to parse, return defaults
  if (!extractedText || extractedText.trim().length < 50) {
    return defaultParsed;
  }

  const prompt = `You are an expert resume parser. Parse the following resume and extract structured information in JSON format.

IMPORTANT: Only extract information that is clearly present in the resume. Do not guess or invent details.

RESUME TEXT:
${extractedText}

Return JSON with this exact structure (no extra text):
{
  "contactInfo": { "name": "", "email": "", "phone": "", "location": "", "linkedin": "", "github": "" },
  "summary": "",
  "experience": [{ "company": "", "title": "", "duration": "", "description": "" }],
  "education": [{ "school": "", "degree": "", "year": "" }],
  "skills": { "technical": [], "soft": [] },
  "certifications": [],
  "projects": [{ "name": "", "description": "" }]
}`;

  try {
    const response = await getOpenRouterClient().post('/chat/completions', {
      model: 'anthropic/claude-3-sonnet',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = response.data.choices[0].message.content;
    const parsed = parseJsonResponse<ParsedResume>(responseText, defaultParsed);

    // Ensure required arrays exist
    return {
      ...defaultParsed,
      ...parsed,
      skills: {
        technical: parsed.skills?.technical || [],
        soft: parsed.skills?.soft || [],
      },
      experience: parsed.experience || [],
      education: parsed.education || [],
      certifications: parsed.certifications || [],
      projects: parsed.projects || [],
    };
  } catch (error) {
    console.error('Resume parsing error:', error);
    return defaultParsed;
  }
}