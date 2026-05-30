export const FILE_SIZE_LIMIT = 5 * 1024 * 1024; // 5 MB

export const MATCH_THRESHOLD_DEFAULT = 70;

export const PAGINATION_DEFAULT_LIMIT = 20;
export const PAGINATION_MAX_LIMIT = 100;

export const TOKEN_EXPIRY = '24h';

export const VALID_JOB_STATUSES = ['todo', 'applied', 'interviewing', 'offer', 'rejected'] as const;
export type JobStatus = typeof VALID_JOB_STATUSES[number];
