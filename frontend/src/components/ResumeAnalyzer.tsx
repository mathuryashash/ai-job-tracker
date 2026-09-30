import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import ScoreGauge from './ScoreGauge';
import { useToast } from './Toast';

const STORAGE_KEY = 'resume_analyzer_form';
const RESULTS_KEY = 'resume_analyzer_results';
const LAST_RESUME_KEY = 'last_resume_id';
const TARGET_ROLE_KEY = 'target_role';

function loadFormData() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return { jd: '' };
}

function saveFormData(jd: string, fileName?: string) {
  try {
    const prev = loadFormData();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ jd, fileName: fileName ?? prev.fileName ?? '' }));
  } catch {}
}

// Save only the lightweight resume_id + score, NOT the full pipeline output
// (which can be ~50kB of LaTeX). Users re-run analysis to recover the full result.
function saveResultPointer(resumeId: number, score: number, candidateName: string, targetRole: string) {
  try {
    localStorage.setItem(RESULTS_KEY, JSON.stringify({ resume_id: resumeId, match_score: score, candidate_name: candidateName, target_role: targetRole }));
    localStorage.setItem(LAST_RESUME_KEY, String(resumeId));
    if (targetRole) localStorage.setItem(TARGET_ROLE_KEY, targetRole);
  } catch {}
}

function loadResultPointer() {
  try {
    const saved = localStorage.getItem(RESULTS_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return null;
}

export default function ResumeAnalyzer({ setView }: { setView?: (v: string) => void } = {}) {
  const showToast = useToast();
  const initialForm = loadFormData();
  const initialPointer = loadResultPointer();
  const [file, setFile] = useState<File | null>(null);
  const [jd, setJd] = useState(initialForm.jd || '');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null); // full results, in-memory only
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const [apiKeyMissing, setApiKeyMissing] = useState(false);

  useEffect(() => { saveFormData(jd, file?.name); }, [jd, file]);

  useEffect(() => {
    // A key saved server-side (Settings → encrypted user_config) or set via
    // GROQ_API_KEY is reported by /health; a tab-local key also counts.
    if (sessionStorage.getItem('groq_api_key')) { setApiKeyMissing(false); return; }
    api.health()
      .then((h: any) => setApiKeyMissing(!h?.keys_configured?.groq))
      .catch(() => setApiKeyMissing(false)); // offline banner is shown elsewhere
  }, []);

  // Pre-fill the JD form from previous analysis (small pointer only).
  useEffect(() => {
    if (initialPointer && !results) {
      setResults({ __pointer: true, ...initialPointer });
    }
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped?.type === 'application/pdf') setFile(dropped);
    else setError('Only PDF files are supported.');
  }, []);

  async function handleAnalyze() {
    if (!file) { setError('Please upload a resume PDF.'); return; }
    if (!jd.trim()) { setError('Please paste a job description.'); return; }
    setError(''); setLoading(true); setApiKeyMissing(false);
    try {
      const data = await api.analyze(file, jd);
      setResults(data);
      for (const w of data.warnings || []) showToast(w, 'error');
      saveResultPointer(
        data.resume_id,
        data.match_score,
        data.candidate_name,
        data.target_role,
      );
      showToast('Analysis complete', 'success');
    } catch (e: any) {
      const msg = e.message || 'Analysis failed';
      if (/401|Unauthorized|Invalid API Key/i.test(msg)) {
        // The key IS configured, just rejected — don't also claim it's missing.
        showToast('Invalid Groq API key. Update it in Settings.', 'error');
        setError('Invalid Groq API key. Please update it in Settings.');
      } else {
        showToast(msg, 'error');
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  function copyLetter() {
    if (results?.cover_letter) {
      navigator.clipboard.writeText(results.cover_letter);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  // Don't render full results page if we only have the lightweight pointer.
  const hasFullResults = results && !results.__pointer;
  const displayResults = hasFullResults ? results : null;

  return (
    <div className="page">
      {loading && (
        <div className="loading-overlay">
          <div className="spinner spinner-lg" />
          <div className="loading-text">
            Running LangGraph pipeline — parsing PDF · extracting keywords · scoring with pgvector…
          </div>
        </div>
      )}

      <div className="page-header">
        <div className="page-title">📄 Resume Analyzer</div>
        <div className="page-subtitle">Upload your resume and paste a JD to get ATS alignment score and a tailored cover letter</div>
      </div>

      {apiKeyMissing && (
        <div className="alert alert-warning" style={{ marginBottom: 16 }}>
          ⚠️ <strong>Groq API key not configured.</strong>
          <button onClick={() => setView?.('settings')} style={{ color: '#f59e0b', textDecoration: 'underline', marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}>
            Set it in Settings →
          </button>
        </div>
      )}

      {error && <div className="alert alert-error">⚠️ {error}</div>}

      <div className="grid-2">
        {/* Left — inputs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div
            className={`drop-zone ${dragging ? 'drag-over' : ''}`}
            onClick={() => document.getElementById('pdf-input')?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); document.getElementById('pdf-input')?.click(); } }}
            aria-label="Upload resume PDF"
          >
            <input
              id="pdf-input"
              type="file"
              accept=".pdf"
              style={{ display: 'none' }}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            <div className="drop-zone-icon">📎</div>
            {file ? (
              <div className="drop-zone-file">
                <span className="drop-zone-filename">✅ {file.name}</span>
              </div>
            ) : initialForm.fileName ? (
              <div className="drop-zone-file">
                <span className="drop-zone-filename" style={{ opacity: 0.7 }}>📄 {initialForm.fileName} (previous — re-upload to re-analyze)</span>
              </div>
            ) : (
              <div className="drop-zone-text">
                <strong>Click to upload</strong> or drag & drop your resume PDF
              </div>
            )}
          </div>

          <div className="form-group">
            <label>Target Job Description</label>
            <textarea
              style={{ minHeight: 240 }}
              placeholder="Paste the full job description here…"
              value={jd}
              onChange={(e) => setJd(e.target.value)}
            />
          </div>

          <button className="btn btn-primary btn-lg btn-full" onClick={handleAnalyze} disabled={loading}>
            🚀 Analyze & Generate Cover Letter
          </button>
        </div>

        {/* Right — results */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {displayResults ? (
            <>
              <div className="card" style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
                <ScoreGauge score={displayResults.match_score} />
              </div>

              <div className="card">
                <div className="section-title">✅ Resume Keywords Detected</div>
                <div className="keywords-list">
                  {(displayResults.extracted_keywords || []).slice(0, 20).map((kw: string) => (
                    <span key={kw} className="badge badge-green">{kw}</span>
                  ))}
                  {!displayResults.extracted_keywords?.length && <span className="text-muted text-sm">None extracted</span>}
                </div>
              </div>

              <div className="card">
                <div className="section-title">⚠️ Skill Gaps (Missing from Resume)</div>
                <div className="keywords-list">
                  {(displayResults.missing_keywords || []).map((kw: string) => (
                    <span key={kw} className="badge badge-yellow">{kw}</span>
                  ))}
                  {!displayResults.missing_keywords?.length && (
                    <span className="badge badge-green">🎉 No critical gaps detected!</span>
                  )}
                </div>
              </div>

              <div className="card">
                <div className="flex items-center justify-between mb-16">
                  <div className="section-title" style={{ marginBottom: 0 }}>💌 Tailored Cover Letter</div>
                  <button className="btn btn-ghost btn-sm" onClick={copyLetter}>
                    {copied ? '✅ Copied!' : '📋 Copy'}
                  </button>
                </div>
                <div className="cover-letter-box">{displayResults.cover_letter}</div>
              </div>

              {(displayResults.candidate_name || displayResults.target_role || displayResults.candidate_email) && (
                <div className="card">
                  <div className="section-title">👤 Candidate Profile</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                    {displayResults.candidate_name && (
                      <span className="badge badge-blue">👤 {displayResults.candidate_name}</span>
                    )}
                    {displayResults.candidate_email && (
                      <span className="badge badge-blue">✉️ {displayResults.candidate_email}</span>
                    )}
                    {displayResults.candidate_phone && (
                      <span className="badge badge-blue">📞 {displayResults.candidate_phone}</span>
                    )}
                    {displayResults.target_role && (
                      <span className="badge badge-purple">🎯 {displayResults.target_role}</span>
                    )}
                  </div>
                </div>
              )}

              {displayResults.optimized_resume_latex && (
                <div className="card">
                  <div className="flex items-center justify-between mb-16">
                    <div className="section-title" style={{ marginBottom: 0 }}>📝 ATS-Optimized Resume (LaTeX for Overleaf)</div>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => navigator.clipboard.writeText(displayResults.optimized_resume_latex)}
                    >
                      📋 Copy LaTeX
                    </button>
                  </div>
                  <pre style={{ whiteSpace: 'pre-wrap', fontSize: '12px', background: 'var(--surface-2)', color: 'var(--text-2)', padding: '12px', borderRadius: '6px', maxHeight: '500px', overflowY: 'auto', fontFamily: 'monospace' }}>
                    {displayResults.optimized_resume_latex}
                  </pre>
                </div>
              )}
            </>
          ) : (
            <div className="card" style={{ height: '100%', minHeight: 400 }}>
              <div className="empty-state">
                <div className="empty-state-icon">📊</div>
                <div className="empty-state-text">
                  Upload a resume and paste a job description,<br />then click Analyze to see results here.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
