import { useState, useCallback } from 'react';
import { api } from '../api/client';
import ScoreGauge from './ScoreGauge';

export default function ResumeAnalyzer() {
  const [file, setFile]           = useState(null);
  const [jd, setJd]               = useState('');
  const [loading, setLoading]     = useState(false);
  const [results, setResults]     = useState(null);
  const [error, setError]         = useState('');
  const [dragging, setDragging]   = useState(false);
  const [copied, setCopied]       = useState(false);

  const handleDrop = useCallback(e => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped?.type === 'application/pdf') setFile(dropped);
    else setError('Only PDF files are supported.');
  }, []);

  async function handleAnalyze() {
    if (!file)       { setError('Please upload a resume PDF.'); return; }
    if (!jd.trim())  { setError('Please paste a job description.'); return; }
    if (!localStorage.getItem('groq_api_key')) {
      setError('Groq API key is missing. Set it in Settings first.'); return;
    }
    setError(''); setLoading(true);
    try {
      const data = await api.analyze(file, jd);
      setResults(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function copyLetter() {
    navigator.clipboard.writeText(results?.cover_letter || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

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

      {error && <div className="alert alert-error">⚠️ {error}</div>}

      <div className="grid-2">
        {/* Left — inputs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Drop zone */}
          <div
            className={`drop-zone ${dragging ? 'drag-over' : ''}`}
            onClick={() => document.getElementById('pdf-input').click()}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <input
              id="pdf-input"
              type="file"
              accept=".pdf"
              style={{ display: 'none' }}
              onChange={e => setFile(e.target.files[0])}
            />
            <div className="drop-zone-icon">📎</div>
            {file ? (
              <div className="drop-zone-file">
                <span className="drop-zone-filename">✅ {file.name}</span>
              </div>
            ) : (
              <div className="drop-zone-text">
                <strong>Click to upload</strong> or drag & drop your resume PDF
              </div>
            )}
          </div>

          {/* JD textarea */}
          <div className="form-group">
            <label>Target Job Description</label>
            <textarea
              style={{ minHeight: 240 }}
              placeholder="Paste the full job description here…"
              value={jd}
              onChange={e => setJd(e.target.value)}
            />
          </div>

          <button className="btn btn-primary btn-lg btn-full" onClick={handleAnalyze} disabled={loading}>
            🚀 Analyze & Generate Cover Letter
          </button>
        </div>

        {/* Right — results */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {results ? (
            <>
              {/* Score gauge */}
              <div className="card" style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
                <ScoreGauge score={results.match_score} />
              </div>

              {/* Keywords */}
              <div className="card">
                <div className="section-title">✅ Resume Keywords Detected</div>
                <div className="keywords-list">
                  {(results.extracted_keywords || []).slice(0, 20).map(kw => (
                    <span key={kw} className="badge badge-green">{kw}</span>
                  ))}
                  {!results.extracted_keywords?.length && <span className="text-muted text-sm">None extracted</span>}
                </div>
              </div>

              <div className="card">
                <div className="section-title">⚠️ Skill Gaps (Missing from Resume)</div>
                <div className="keywords-list">
                  {(results.missing_keywords || []).map(kw => (
                    <span key={kw} className="badge badge-yellow">{kw}</span>
                  ))}
                  {!results.missing_keywords?.length && (
                    <span className="badge badge-green">🎉 No critical gaps detected!</span>
                  )}
                </div>
              </div>

              {/* Cover letter */}
              <div className="card">
                <div className="flex items-center justify-between mb-16">
                  <div className="section-title" style={{ marginBottom: 0 }}>💌 Tailored Cover Letter</div>
                  <button className="btn btn-ghost btn-sm" onClick={copyLetter}>
                    {copied ? '✅ Copied!' : '📋 Copy'}
                  </button>
                </div>
                <div className="cover-letter-box">{results.cover_letter}</div>
              </div>
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
