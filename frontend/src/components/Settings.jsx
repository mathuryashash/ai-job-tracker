import { useState, useEffect } from 'react';
import { api } from '../api/client';

export default function Settings() {
  const [groqKey, setGroqKey] = useState('');
  const [model, setModel] = useState('llama3-70b-8192');
  const [apifyToken, setApifyToken] = useState('');
  const [tinyfishKey, setTinyfishKey] = useState('');
  const [message, setMessage] = useState({ text: '', type: '' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Load local storage keys (if any)
    setGroqKey(localStorage.getItem('groq_api_key') || '');
    setModel(localStorage.getItem('groq_model') || 'llama3-70b-8192');
    
    // We can fetch backend env status from api.getPlatforms() or similar,
    // but we can also let them set keys in local storage to pass down or tell them how to set in .env
    setApifyToken(localStorage.getItem('apify_token') || '');
    setTinyfishKey(localStorage.getItem('tinyfish_key') || '');
  }, []);

  async function handleSave() {
    setLoading(true);
    setMessage({ text: '', type: '' });
    try {
      localStorage.setItem('groq_api_key', groqKey);
      localStorage.setItem('groq_model', model);
      localStorage.setItem('apify_token', apifyToken);
      localStorage.setItem('tinyfish_key', tinyfishKey);

      // Save credentials backend-side using the update/config flow if supported
      // Or inform user to set environment variables if API keys are system-wide
      setMessage({
        text: 'Configuration saved to browser local storage. Please restart your backend server if API keys like APIFY_TOKEN are not set in your .env file.',
        type: 'success'
      });
    } catch (e) {
      setMessage({ text: 'Error saving settings: ' + e.message, type: 'error' });
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
                onChange={e => setGroqKey(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>LLM Model</label>
              <select value={model} onChange={e => setModel(e.target.value)}>
                <option value="llama3-70b-8192">Llama 3 70B (llama3-70b-8192)</option>
                <option value="llama-3.1-70b-versatile">Llama 3.1 70B (llama-3.1-70b-versatile)</option>
                <option value="mixtral-8x7b-32768">Mixtral 8x7B (mixtral-8x7b-32768)</option>
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
                onChange={e => setApifyToken(e.target.value)}
              />
              <div className="text-xs text-muted" style={{ marginTop: 4 }}>
                Used for LinkedIn, Indeed, and Glassdoor scrapers. Get it from your Apify Console integrations page.
              </div>
            </div>
            <div className="form-group">
              <label>Tinyfish API Key</label>
              <input
                type="password"
                placeholder="tf_..."
                value={tinyfishKey}
                onChange={e => setTinyfishKey(e.target.value)}
              />
              <div className="text-xs text-muted" style={{ marginTop: 4 }}>
                Used for direct search of aggregate tech job postings via Tinyfish API.
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
