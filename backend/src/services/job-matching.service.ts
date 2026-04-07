import { matchResumeToJob as aiMatchResumeToJob, MatchResult } from './ai.service';

export type { MatchResult } from './ai.service';

export async function matchResumeToJob(
  resumeText: string,
  jobDescription: string
): Promise<MatchResult> {
  return aiMatchResumeToJob(resumeText, jobDescription);
}

export function calculateKeywordMatch(resumeText: string, jobDescription: string): number {
  const resumeLower = resumeText.toLowerCase();
  const jobLower = jobDescription.toLowerCase();

  const jobKeywords = extractKeywords(jobLower);
  const resumeKeywords = extractKeywords(resumeLower);

  if (jobKeywords.length === 0) {
    return 0;
  }

  let matches = 0;
  for (const keyword of jobKeywords) {
    if (resumeKeywords.some((rk) => rk.includes(keyword) || keyword.includes(rk))) {
      matches++;
    }
  }

  return Math.round((matches / jobKeywords.length) * 100);
}

function extractKeywords(text: string): string[] {
  const techKeywords = [
    'javascript', 'typescript', 'python', 'java', 'react', 'angular', 'vue',
    'node', 'express', 'django', 'flask', 'spring', 'aws', 'azure', 'gcp',
    'docker', 'kubernetes', 'jenkins', 'git', 'sql', 'nosql', 'mongodb',
    'postgresql', 'mysql', 'redis', 'graphql', 'rest', 'api', 'agile', 'scrum',
    'machine learning', 'deep learning', 'data science', 'analytics', 'tableau',
    'html', 'css', 'sass', 'less', 'webpack', 'vite', 'babel', 'npm', 'yarn',
    'ci/cd', 'devops', 'linux', 'unix', 'bash', 'shell', 'terraform', 'ansible',
    'communication', 'leadership', 'teamwork', 'problem-solving', 'analytical',
    'project management', 'time management', 'presentation', 'negotiation',
  ];

  const words = text.split(/[\s,.\-_\/()[\]{}]+/).filter((w) => w.length > 2);

  return words.filter((word) =>
    techKeywords.some((kw) => kw.includes(word) || word.includes(kw))
  );
}

export function meetsThreshold(result: MatchResult, threshold: number = 70): boolean {
  return result.matchPercentage >= threshold;
}
