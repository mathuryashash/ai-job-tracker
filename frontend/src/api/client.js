const BASE = '';

function headers(extra = {}) {
  const groqKey = localStorage.getItem('groq_api_key') || '';
  return {
    'Content-Type': 'application/json',
    ...(groqKey ? { 'X-Groq-Api-Key': groqKey } : {}),
    ...extra,
  };
}

async function handleResponse(res) {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  health: () =>
    fetch(`${BASE}/health`).then(handleResponse),

  /** Resume analysis — multipart/form-data */
  analyze: (file, jobDescription) => {
    const form = new FormData();
    form.append('file', file);
    form.append('job_description', jobDescription);
    const groqKey = localStorage.getItem('groq_api_key') || '';
    return fetch(`${BASE}/api/analyze`, {
      method: 'POST',
      headers: groqKey ? { 'X-Groq-Api-Key': groqKey } : {},
      body: form,
    }).then(handleResponse);
  },

  /** Applications */
  getApplications: () =>
    fetch(`${BASE}/api/applications`, { headers: headers() }).then(handleResponse),

  createApplication: (data) =>
    fetch(`${BASE}/api/applications`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(data),
    }).then(handleResponse),

  updateStatus: (id, status) =>
    fetch(`${BASE}/api/applications/${id}`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ status }),
    }).then(handleResponse),

  deleteApplication: (id) =>
    fetch(`${BASE}/api/applications/${id}`, {
      method: 'DELETE',
      headers: headers(),
    }).then(handleResponse),

  /** Job Search */
  searchJobs: (query, location, platforms, limit = 20) =>
    fetch(`${BASE}/api/search/jobs`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ query, location, platforms, limit }),
    }).then(handleResponse),

  getPlatforms: () =>
    fetch(`${BASE}/api/search/platforms`, { headers: headers() }).then(handleResponse),
};
