import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useWebSocket } from '../hooks/useWebSocket';

interface SourceInfo {
  name: string;
  type: string;
  requiresKey: boolean;
  description: string;
}

interface SourceResult {
  sourceKey: string;
  source: string;
  jobsFound: number;
  status: 'searching' | 'completed' | 'failed';
  error?: string;
}

interface JobResult {
  jobTitle: string;
  company: string;
  matchPercentage: number;
  applicationCreated: boolean;
  applicationId?: string;
  source: string;
  coverLetter?: string;
  error?: string;
}

interface ExtractedKeywords {
  searchQueries: string[];
  skills: string[];
  roleType: 'internship' | 'job' | 'both';
  suggestedTitles: string[];
}

interface ApiKeys {
  apify?: string;
  jooble?: string;
  indeed?: string;
  flexjobs?: string;
  adzuna_appId?: string;
  adzuna_apiKey?: string;
  internshala?: string;
}

export default function Automation() {
  const [keywords, setKeywords] = useState('');
  const [location, setLocation] = useState('');
  const [matchThreshold, setMatchThreshold] = useState(70);
  const [autoTailorResume, setAutoTailorResume] = useState(true);
  const [autoGenerateCoverLetter, setAutoGenerateCoverLetter] = useState(true);
  const [useAIKeywords, setUseAIKeywords] = useState(true);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<JobResult[]>([]);
  const [sources, setSources] = useState<SourceResult[]>([]);
  const [status, setStatus] = useState<'idle' | 'running' | 'completed'>('idle');
  const [extractedKeywords, setExtractedKeywords] = useState<ExtractedKeywords | null>(null);
  const [jobSources, setJobSources] = useState<SourceInfo[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [showSources, setShowSources] = useState(false);
  const [showApiKeys, setShowApiKeys] = useState(false);
  const [apiKeys, setApiKeys] = useState<ApiKeys>({});
  const [apiKeysSaved, setApiKeysSaved] = useState(false);
  const [apiKeysLoading, setApiKeysLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentPhase, setCurrentPhase] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);

  const { token } = useAuth();
  const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:3001/ws`;
  const { subscribe, isConnected } = useWebSocket({ token: token ?? '', wsUrl });

  // ── Wire real WebSocket progress events ────────────────────────────────────
  const activeJobIdRef = useRef<string | null>(null);

  const handleWsProgress = useCallback((data: unknown) => {
    const d = data as any;
    // Only handle events for the current job
    if (activeJobIdRef.current && d.jobId && d.jobId !== activeJobIdRef.current) return;
    setProgress(d.progress ?? 0);
    setCurrentPhase(d.message ?? d.stage ?? '');
  }, []);

  const handleWsComplete = useCallback((data: unknown) => {
    const d = data as any;
    if (activeJobIdRef.current && d.jobId && d.jobId !== activeJobIdRef.current) return;
    setProgress(100);
    setCurrentPhase('Complete!');
    setStatus('completed');
    setLoading(false);
    activeJobIdRef.current = null;
    // Refresh the page results by polling the status endpoint
    axios.get('/api/automation/status').then(res => {
      if (res.data.success) setResults(res.data.data);
    }).catch(console.error);
  }, []);

  const handleWsError = useCallback((data: unknown) => {
    const d = data as any;
    if (activeJobIdRef.current && d.jobId && d.jobId !== activeJobIdRef.current) return;
    setStatus('idle');
    setLoading(false);
    alert(d.error ?? 'Automation failed');
    activeJobIdRef.current = null;
  }, []);

  useEffect(() => {
    const unsubs = [
      subscribe('automation:progress', handleWsProgress),
      subscribe('automation:complete', handleWsComplete),
      subscribe('automation:error', handleWsError),
    ];
    return () => unsubs.forEach(fn => fn());
  }, [subscribe, handleWsProgress, handleWsComplete, handleWsError]);

  const getAutomationErrorMessage = (error: any): string => {
    const apiMessage = error?.response?.data?.error;
    if (typeof apiMessage === 'string' && apiMessage.trim()) {
      if (apiMessage.includes('No resume found')) {
        return 'No resume found. Please upload your resume in Resume Analyzer first.';
      }
      if (apiMessage.includes('No search keywords available')) {
        return 'No search keywords available. Add keywords manually or upload a detailed resume.';
      }
      return apiMessage;
    }
    if (error?.response?.status === 429) {
      return 'Too many automation requests. Please wait a minute and try again.';
    }
    return 'Failed to run automation';
  };

  useEffect(() => {
    const savedLocation = localStorage.getItem('automationLocation');
    if (savedLocation) setLocation(savedLocation);
    fetchSources();
    fetchApiKeys();
  }, []);

  const fetchSources = async () => {
    try {
      const response = await axios.get('/api/automation/sources');
      if (response.data.success) {
        setJobSources(response.data.data);
      }
    } catch (error) {
      console.error('Failed to fetch sources:', error);
    }
  };

  const fetchApiKeys = async () => {
    try {
      const response = await axios.get('/api/automation/api-keys');
      if (response.data.success) {
        setApiKeys(response.data.data as ApiKeys);
      }
    } catch (error) {
      console.error('Failed to fetch API keys:', error);
    }
  };

  const saveApiKeys = async () => {
    setApiKeysLoading(true);
    try {
      const keysToSave: Record<string, string | { appId?: string; apiKey?: string }> = {};
      if (apiKeys.apify) keysToSave.apify = apiKeys.apify;
      if (apiKeys.jooble) keysToSave.jooble = apiKeys.jooble;
      if (apiKeys.indeed) keysToSave.indeed = apiKeys.indeed;
      if (apiKeys.flexjobs) keysToSave.flexjobs = apiKeys.flexjobs;
      if (apiKeys.adzuna_appId || apiKeys.adzuna_apiKey) {
        keysToSave.adzuna = { appId: apiKeys.adzuna_appId || undefined, apiKey: apiKeys.adzuna_apiKey || undefined };
      }
      if (apiKeys.internshala) keysToSave.internshala = apiKeys.internshala;

      await axios.post('/api/automation/api-keys', { apiKeys: keysToSave });
      setApiKeysSaved(true);
      setTimeout(() => setApiKeysSaved(false), 3000);
    } catch (error) {
      console.error('Failed to save API keys:', error);
      alert('Failed to save API keys');
    } finally {
      setApiKeysLoading(false);
    }
  };

  const handleLocationChange = (value: string) => {
    setLocation(value);
    localStorage.setItem('automationLocation', value);
  };

  const handleCopyCoverLetter = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const handleRunAutomation = async () => {
    if (!isConnected) {
      alert('WebSocket not connected. Please wait a moment and try again.');
      return;
    }

    setLoading(true);
    setStatus('running');
    setResults([]);
    setExtractedKeywords(null);
    setCopiedIndex(null);
    setProgress(5);
    setCurrentPhase('Queuing automation job…');

    const sourceNames = [
      'LinkedIn (Apify)', 'Indeed (Apify)', 'Remotive', 'We Work Remotely',
      'Remote OK', 'Wellfound', 'Remote.co', 'Arbeitnow', 'FlexJobs', 'Jooble',
      'Indeed API', 'Adzuna',
    ];
    setSources(sourceNames.map(name => ({
      sourceKey: name,
      source: name,
      jobsFound: 0,
      status: 'searching' as const,
    })));

    try {
      // 202 Accepted — job enqueued in BullMQ. Progress comes via WebSocket.
      const response = await axios.post('/api/automation/trigger', {
        keywords: keywords || undefined,
        location: location || undefined,
        matchThreshold,
        autoTailorResume,
        autoGenerateCoverLetter,
        useAIKeywords,
      });

      const newJobId: string = response.data.data?.jobId;
      activeJobIdRef.current = newJobId;
      setJobId(newJobId);
      setCurrentPhase('Job queued — waiting for results via WebSocket…');
      setProgress(8);
      // Loading and status will be updated by handleWsComplete / handleWsError
    } catch (error: any) {
      console.error('Automation trigger error:', error);
      setSources(prev => prev.map(s => ({ ...s, status: 'failed' as const })));
      alert(getAutomationErrorMessage(error));
      setStatus('idle');
      setLoading(false);
      activeJobIdRef.current = null;
    }
  };


  const applicationsCreated = results.filter(r => r.applicationCreated).length;
  const totalJobsFound = results.length;
  const matchedJobs = results.filter(r => r.matchPercentage >= matchThreshold);

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Job Automation</h1>
        <div className="flex items-center gap-3">
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${
            isConnected ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
          }`}>
            {isConnected ? '● Live' : '○ Connecting…'}
          </span>
          <button
            onClick={() => setShowSources(!showSources)}
            className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
          >
            {showSources ? 'Hide' : 'Show'} Job Sources ({jobSources.length})
          </button>
        </div>
      </div>

      {status === 'running' && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium text-blue-800">{currentPhase}</span>
            <span className="text-sm text-blue-600">{progress}%</span>
          </div>
          <div className="w-full bg-blue-200 rounded-full h-2.5">
            <div
              className="bg-blue-600 h-2.5 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            ></div>
          </div>
          {jobId && (
            <p className="text-xs text-blue-500 mt-2 font-mono">Job ID: {jobId}</p>
          )}
        </div>
      )}

      {showSources && (
        <div className="mb-6 card">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Job Sources</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {jobSources.map((source, idx) => (
              <div key={idx} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <span className={`text-xs px-2 py-1 rounded font-medium ${
                  source.requiresKey ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'
                }`}>
                  {source.requiresKey ? 'Key' : 'Free'}
                </span>
                <div>
                  <p className="font-medium text-sm text-gray-900">{source.name}</p>
                  <p className="text-xs text-gray-500">{source.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-6">
        <button
          onClick={() => setShowApiKeys(!showApiKeys)}
          className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
        >
          {showApiKeys ? 'Hide' : 'Manage'} API Keys
        </button>
      </div>

      {showApiKeys && (
        <div className="mb-6 card">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">API Keys Configuration</h2>
          <p className="text-sm text-gray-500 mb-4">
            Enter your API keys to enable premium job sources. Keys are stored securely in your account.
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Apify API Key</label>
              <input
                type="password"
                value={apiKeys.apify || ''}
                onChange={(e) => setApiKeys({ ...apiKeys, apify: e.target.value })}
                className="input"
                placeholder="Enter Apify API key"
              />
              <p className="text-xs text-gray-500 mt-1">Used for LinkedIn, Indeed, Internshala scraping</p>
            </div>

            <div>
              <label className="label">Jooble API Key</label>
              <input
                type="password"
                value={apiKeys.jooble || ''}
                onChange={(e) => setApiKeys({ ...apiKeys, jooble: e.target.value })}
                className="input"
                placeholder="Enter Jooble API key"
              />
            </div>

            <div>
              <label className="label">Indeed Publisher Key</label>
              <input
                type="password"
                value={apiKeys.indeed || ''}
                onChange={(e) => setApiKeys({ ...apiKeys, indeed: e.target.value })}
                className="input"
                placeholder="Enter Indeed publisher key"
              />
            </div>

            <div>
              <label className="label">FlexJobs API Key</label>
              <input
                type="password"
                value={apiKeys.flexjobs || ''}
                onChange={(e) => setApiKeys({ ...apiKeys, flexjobs: e.target.value })}
                className="input"
                placeholder="Enter FlexJobs API key"
              />
            </div>

            <div>
              <label className="label">Adzuna App ID</label>
              <input
                type="password"
                value={apiKeys.adzuna_appId || ''}
                onChange={(e) => setApiKeys({ ...apiKeys, adzuna_appId: e.target.value })}
                className="input"
                placeholder="Enter Adzuna App ID"
              />
            </div>

            <div>
              <label className="label">Adzuna API Key</label>
              <input
                type="password"
                value={apiKeys.adzuna_apiKey || ''}
                onChange={(e) => setApiKeys({ ...apiKeys, adzuna_apiKey: e.target.value })}
                className="input"
                placeholder="Enter Adzuna API key"
              />
            </div>

            <div>
              <label className="label">Internshala API Key</label>
              <input
                type="password"
                value={apiKeys.internshala || ''}
                onChange={(e) => setApiKeys({ ...apiKeys, internshala: e.target.value })}
                className="input"
                placeholder="Enter Internshala key (or use Apify)"
              />
              <p className="text-xs text-gray-500 mt-1">Optional - uses Apify if not provided</p>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={saveApiKeys}
              disabled={apiKeysLoading}
              className="btn-primary"
            >
              {apiKeysLoading ? 'Saving...' : 'Save API Keys'}
            </button>
            {apiKeysSaved && (
              <span className="text-sm text-green-600">API keys saved successfully!</span>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Automation Settings</h2>
          
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg">
              <input
                type="checkbox"
                id="useAI"
                checked={useAIKeywords}
                onChange={(e) => setUseAIKeywords(e.target.checked)}
                className="w-4 h-4"
              />
              <label htmlFor="useAI" className="text-sm text-blue-800">
                Use AI to extract keywords from resume (recommended)
              </label>
            </div>

            {!useAIKeywords && (
              <div>
                <label className="label">Job Keywords (manual)</label>
                <input
                  type="text"
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  className="input"
                  placeholder="e.g., software engineer, react developer"
                />
              </div>
            )}

            <div>
              <label className="label">Location</label>
              <input
                type="text"
                value={location}
                onChange={(e) => handleLocationChange(e.target.value)}
                className="input"
                placeholder="e.g., Bangalore, San Francisco, Remote"
              />
              <p className="text-xs text-gray-500 mt-1">
                Saved automatically. Leave empty for worldwide search.
              </p>
            </div>

            <div>
              <label className="label">Match Threshold: {matchThreshold}%</label>
              <input
                type="range"
                min="0"
                max="100"
                value={matchThreshold}
                onChange={(e) => setMatchThreshold(Number(e.target.value))}
                className="w-full"
              />
              <p className="text-sm text-gray-500">
                Only log jobs with at least {matchThreshold}% match
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="tailor"
                checked={autoTailorResume}
                onChange={(e) => setAutoTailorResume(e.target.checked)}
                className="w-4 h-4"
              />
              <label htmlFor="tailor" className="text-sm text-gray-700">
                Auto-tailor resume for each job
              </label>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="coverLetter"
                checked={autoGenerateCoverLetter}
                onChange={(e) => setAutoGenerateCoverLetter(e.target.checked)}
                className="w-4 h-4"
              />
              <label htmlFor="coverLetter" className="text-sm text-gray-700">
                Auto-generate cover letter
              </label>
            </div>

            <button
              onClick={handleRunAutomation}
              disabled={loading || (!useAIKeywords && !keywords)}
              className="btn-primary w-full"
            >
              {loading ? 'Running...' : 'Start Automation'}
            </button>
          </div>
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Results</h2>
          
          {status === 'idle' && (
            <p className="text-gray-500 text-center py-8">
              Configure settings and click "Start Automation" to begin.
            </p>
          )}

          {status === 'running' && (
            <div className="space-y-3">
              {sources.map((source, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <span className="text-sm font-medium">{source.source}</span>
                  <span className="text-sm text-gray-500">
                    {source.status === 'searching' ? (
                      <span className="flex items-center gap-2">
                        <span className="animate-spin">⏳</span> Searching...
                      </span>
                    ) : source.status === 'completed' ? (
                      `Found ${source.jobsFound} jobs`
                    ) : (
                      'Failed'
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}

          {status === 'completed' && (
            <div>
              <div className="mb-4 p-4 bg-green-50 rounded-lg">
                <p className="font-semibold text-green-700">
                  {applicationsCreated} applications logged from {totalJobsFound} jobs ({matchedJobs.length} matched {matchThreshold}%+)
                </p>
              </div>

              {extractedKeywords && (
                <div className="mb-4 p-3 bg-blue-50 rounded-lg">
                  <p className="text-sm font-medium text-blue-800 mb-2">
                    AI extracted: {extractedKeywords.roleType === 'internship' ? 'Internship' : extractedKeywords.roleType === 'job' ? 'Job' : 'Job & Internship'} search
                  </p>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {extractedKeywords.searchQueries.map((q, i) => (
                      <span key={i} className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                        {q}
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {extractedKeywords.skills.slice(0, 10).map((s, i) => (
                      <span key={i} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-3 max-h-96 overflow-y-auto">
                {results.map((result, index) => (
                  <div
                    key={index}
                    className={`p-4 rounded-lg border ${
                      result.applicationCreated 
                        ? 'bg-green-50 border-green-200' 
                        : result.matchPercentage >= matchThreshold
                        ? 'bg-yellow-50 border-yellow-200'
                        : 'bg-gray-50 border-gray-200'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium text-gray-900">{result.jobTitle}</p>
                        <p className="text-sm text-gray-600">{result.company}</p>
                        <p className="text-xs text-gray-500 mt-1">{result.source}</p>
                      </div>
                      <span className={`px-2 py-1 rounded text-sm font-medium ${
                        result.matchPercentage >= 70 
                          ? 'bg-green-100 text-green-700'
                          : result.matchPercentage >= 50
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-gray-100 text-gray-700'
                      }`}>
                        {result.matchPercentage}%
                      </span>
                    </div>
                    {result.error && (
                      <p className="text-xs text-red-600 mt-1">{result.error}</p>
                    )}
                    {result.applicationCreated && (
                      <p className="text-xs text-green-600 mt-1">Logged to tracker</p>
                    )}
                    {result.coverLetter && (
                      <div className="mt-3 p-3 bg-white rounded border">
                        <div className="flex justify-between items-center mb-2">
                          <p className="text-xs font-medium text-gray-700">Cover Letter</p>
                          <button
                            onClick={() => handleCopyCoverLetter(result.coverLetter!, index)}
                            className="text-xs px-2 py-1 bg-primary-100 text-primary-700 rounded hover:bg-primary-200 transition-colors"
                          >
                            {copiedIndex === index ? 'Copied!' : 'Copy'}
                          </button>
                        </div>
                        <pre className="text-xs text-gray-600 whitespace-pre-wrap font-sans leading-relaxed max-h-40 overflow-y-auto">
                          {result.coverLetter}
                        </pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">How It Works</h2>
        <ol className="space-y-2 text-sm text-gray-600">
          <li className="flex items-start">
            <span className="flex-shrink-0 w-6 h-6 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center text-xs font-bold mr-3">1</span>
            AI analyzes your resume and extracts optimal search keywords
          </li>
          <li className="flex items-start">
            <span className="flex-shrink-0 w-6 h-6 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center text-xs font-bold mr-3">2</span>
            Searches {jobSources.length || 12} job boards with your keywords + location
          </li>
          <li className="flex items-start">
            <span className="flex-shrink-0 w-6 h-6 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center text-xs font-bold mr-3">3</span>
            AI matches each job against your resume (threshold: {matchThreshold}%)
          </li>
          <li className="flex items-start">
            <span className="flex-shrink-0 w-6 h-6 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center text-xs font-bold mr-3">4</span>
            Matching jobs get logged with a generated cover letter you can copy
          </li>
        </ol>
      </div>
    </div>
  );
}
