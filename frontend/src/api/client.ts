// API client. Keys are NEVER persisted in browser storage — the backend
// either reads them from its env / encrypted user_config, or they arrive
// in the X-Groq-Api-Key header for this session only.

const BASE = '';

function groqKey(): string {
  // Read from sessionStorage only (cleared on tab close), never localStorage.
  // Falls back to undefined so backend uses its own configured key.
  if (typeof sessionStorage === 'undefined') return '';
  return sessionStorage.getItem('groq_api_key') || '';
}

function jsonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extra,
  };
  const key = groqKey();
  if (key) headers['X-Groq-Api-Key'] = key;
  return headers;
}

async function handleResponse<T = any>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    // FastAPI errors are {"detail": "..."}; surface the message, not raw JSON.
    let msg = text;
    try {
      const d = JSON.parse(text)?.detail;
      if (typeof d === 'string') msg = d;
      else if (Array.isArray(d)) msg = d.map((x: any) => x?.msg).filter(Boolean).join('; ') || text;
    } catch {}
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  health: () => fetch(`${BASE}/health`).then(handleResponse),

  // Settings page — backend returns masked tails only, never plaintext.
  getKeysFromBackend: () => fetch(`${BASE}/api/keys`).then(handleResponse),

  // Resume analysis — multipart/form-data
  analyze: (file: File, jobDescription: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('job_description', jobDescription);
    const headers: Record<string, string> = {};
    const key = groqKey();
    if (key) headers['X-Groq-Api-Key'] = key;
    return fetch(`${BASE}/api/analyze`, {
      method: 'POST',
      headers,
      body: form,
    }).then(handleResponse);
  },

  // Applications
  getApplications: () =>
    fetch(`${BASE}/api/applications`, { headers: jsonHeaders() }).then(handleResponse),

  createApplication: (data: any) =>
    fetch(`${BASE}/api/applications`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(data),
    }).then(handleResponse),

  updateStatus: (id: number, status: string) =>
    fetch(`${BASE}/api/applications/${id}`, {
      method: 'PUT',
      headers: jsonHeaders(),
      body: JSON.stringify({ status }),
    }).then(handleResponse),

  deleteApplication: (id: number) =>
    fetch(`${BASE}/api/applications/${id}`, {
      method: 'DELETE',
      headers: jsonHeaders(),
    }).then(handleResponse),

  // Job search
  searchJobs: (query: string, location: string, platforms: string[], limit = 20) =>
    fetch(`${BASE}/api/search/jobs`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ query, location, platforms, limit }),
    }).then(handleResponse),

  getPlatforms: () =>
    fetch(`${BASE}/api/search/platforms`, { headers: jsonHeaders() }).then(handleResponse),
};

export async function saveJobsToDB(jobs: any[]) {
  const res = await fetch(`${BASE}/api/jobs/save`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(jobs),
  });
  if (!res.ok) throw new Error(`Failed to save jobs: ${res.status}`);
  return res.json();
}

export async function batchAnalyzeJobs({ resumeId, groqApiKey }: { resumeId: number; groqApiKey?: string }) {
  const res = await fetch(`${BASE}/api/analyze-batch`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ resume_id: resumeId, groq_api_key: groqApiKey || undefined }),
  });
  if (!res.ok) throw new Error(`Failed to start batch analysis: ${res.status}`);
  return res.json();
}

export async function saveKeys({ groqApiKey, apifyToken, tinyfishApiKey, groqModel }: {
  groqApiKey?: string; apifyToken?: string; tinyfishApiKey?: string; groqModel?: string;
}) {
  const res = await fetch(`${BASE}/api/keys`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      groq_api_key: groqApiKey || undefined,
      apify_token: apifyToken || undefined,
      tinyfish_api_key: tinyfishApiKey || undefined,
      groq_model: groqModel || undefined,
    }),
  });
  if (!res.ok) throw new Error(`Failed to save keys: ${res.status}`);
  return res.json();
}

// sessionStorage helpers — scoped to current tab, not persistent.
export function setSessionKey(name: 'groq_api_key' | 'apify_token' | 'tinyfish_api_key', value: string) {
  try { sessionStorage.setItem(name, value); } catch {}
}
export function clearSessionKeys() {
  try {
    sessionStorage.removeItem('groq_api_key');
    sessionStorage.removeItem('apify_token');
    sessionStorage.removeItem('tinyfish_api_key');
  } catch {}
}
