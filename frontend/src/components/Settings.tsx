import { useEffect, useState } from 'react';
import { api, saveKeys, setSessionKey } from '../api/client';
import { useToast } from './Toast';

// Models must match what backend config.py + job_search.py expect.
// Llama 3.x models are retired on Groq (404 model_not_found).
const MODEL_OPTIONS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b',
];

export default function Settings() {
  const showToast = useToast();
  const [groqKey, setGroqKey] = useState(() => sessionStorage.getItem('groq_api_key') || '');
  const [model, setModel] = useState(() => sessionStorage.getItem('groq_model') || MODEL_OPTIONS[0]);
  const [apifyToken, setApifyToken] = useState(() => sessionStorage.getItem('apify_token') || '');
  const [tinyfishKey, setTinyfishKey] = useState(() => sessionStorage.getItem('tinyfish_api_key') || '');
  const [message, setMessage] = useState({ text: '', type: '' });
  const [loading, setLoading] = useState(false);

  // Pull masked key status from backend once on mount (never plaintext).
  useEffect(() => {
    api.getKeysFromBackend?.()
      .then((data: any) => {
        if (!data) return;
        // Show the model the backend will actually use (Settings > env > default).
        if (data.groq_model) setModel(data.groq_model);
        setMessage({
          text: data.keys_configured
            ? `Keys configured: groq=${data.keys_configured.groq}, apify=${data.keys_configured.apify}, tinyfish=${data.keys_configured.tinyfish}`
            : '',
          type: 'success',
        });
      })
      .catch(() => {});
  }, []);

  async function handleSave() {
    setLoading(true);
    setMessage({ text: '', type: '' });
    try {
      await saveKeys({
        groqApiKey: groqKey || undefined,
        apifyToken: apifyToken || undefined,
        tinyfishApiKey: tinyfishKey || undefined,
        groqModel: model,
      });
      // Mirror to sessionStorage so same-tab requests carry the header.
      // localStorage is intentionally NOT used (XSS exposure).
      if (groqKey) setSessionKey('groq_api_key', groqKey);
      if (apifyToken) setSessionKey('apify_token', apifyToken);
      if (tinyfishKey) setSessionKey('tinyfish_api_key', tinyfishKey);
      setMessage({ text: 'Settings saved successfully. Keys stored encrypted server-side; this tab will use them until you close it.', type: 'success' });
      showToast('Settings saved', 'success');
    } catch (e: any) {
      setMessage({ text: `Error saving settings: ${e.message}`, type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">⚙️ Settings</div>
        <div className="page-subtitle">Configure LLM models and automated search API credentials</div>
      </div>

      {message.text && (
        <div className={`alert alert-${message.type}`}>
          {message.type === 'success' ? '✅' : '⚠️'} {message.text}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div className="settings-section">
          <h3>🧠 LLM Inference Engine</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="form-group">
              <label>Groq API Key</label>
              <input
                type="password"
                placeholder="gsk_..."
                value={groqKey}
                onChange={(e) => setGroqKey(e.target.value)}
              />
              <div className="text-xs text-muted" style={{ marginTop: 4 }}>
                Saved encrypted server-side. Held in sessionStorage for this tab only — cleared on browser close.
              </div>
            </div>
            <div className="form-group">
              <label>LLM Model</label>
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                {(MODEL_OPTIONS.includes(model) ? MODEL_OPTIONS : [model, ...MODEL_OPTIONS]).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="settings-section">
          <h3>🕵️‍♂️ Automated Job Scrapers</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="form-group">
              <label>Apify API Token</label>
              <input
                type="password"
                placeholder="apify_..."
                value={apifyToken}
                onChange={(e) => setApifyToken(e.target.value)}
              />
              <div className="text-xs text-muted" style={{ marginTop: 4 }}>
                Used for LinkedIn, Indeed, and Glassdoor scrapers.
              </div>
            </div>
            <div className="form-group">
              <label>Tinyfish API Key</label>
              <input
                type="password"
                placeholder="tf_..."
                value={tinyfishKey}
                onChange={(e) => setTinyfishKey(e.target.value)}
              />
              <div className="text-xs text-muted" style={{ marginTop: 4 }}>
                Direct aggregate tech job postings search.
              </div>
            </div>
          </div>
        </div>

        <button
          className="btn btn-primary btn-lg"
          onClick={handleSave}
          disabled={loading}
          style={{ alignSelf: 'flex-start', minWidth: 160 }}
        >
          {loading ? 'Saving...' : '💾 Save Settings'}
        </button>
      </div>
    </div>
  );
}
