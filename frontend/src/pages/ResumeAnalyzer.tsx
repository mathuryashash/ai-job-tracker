import { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import RadarChart from './RadarChart';

interface Analysis {
  id: string;
  matchPercentage: number;
  skillsRadar: Record<string, number>;
  missingKeywords: string[];
  suggestions: string[];
  createdAt: string;
}

const STORAGE_KEY = 'resume_analyzer_data';

export default function ResumeAnalyzer() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [resumeName, setResumeName] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [jobDescription, setJobDescription] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [currentAnalysis, setCurrentAnalysis] = useState<Analysis | null>(null);
  const [history, setHistory] = useState<Analysis[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Load saved resume on mount
  useEffect(() => {
    const loadSavedResume = async () => {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          const { resumeId: savedId, jobDescription: savedJob } = JSON.parse(saved);
          if (savedId) {
            // Verify resume still exists
            const response = await axios.get(`/api/resumes/${savedId}`);
            if (response.data.success) {
              setResumeId(savedId);
              setResumeName(response.data.data.originalName || 'Saved Resume');
              setJobDescription(savedJob || '');
              // Load analyses
              if (response.data.data.analyses?.length > 0) {
                const analyses = response.data.data.analyses.map((a: any) => ({
                  id: a.id,
                  matchPercentage: a.matchPercentage,
                  skillsRadar: typeof a.skillsRadar === 'string' ? JSON.parse(a.skillsRadar) : a.skillsRadar,
                  missingKeywords: a.missingKeywords,
                  suggestions: a.suggestions,
                  createdAt: a.createdAt,
                }));
                setHistory(analyses);
                const latest = analyses.find((a: any) => a.status === 'completed');
                if (latest) setCurrentAnalysis(latest);
              }
            } else {
              localStorage.removeItem(STORAGE_KEY);
            }
          }
        } catch (e) {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    };
    loadSavedResume();
  }, []);

  const uploadResumeFile = async (resumeFile: File) => {
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('resume', resumeFile);

      const response = await axios.post('/api/resumes/upload', formData);

      if (response.data.success) {
        setResumeId(response.data.data.id);
        setResumeName(resumeFile.name);
        setFile(null);
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            resumeId: response.data.data.id,
            jobDescription: jobDescription,
          })
        );
        alert('Resume uploaded successfully!');
      }
    } catch (error: any) {
      console.error('Upload failed:', error);
      const msg = error.response?.data?.error || 'Failed to upload resume';
      setError(msg);
      alert(msg);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (selectedFile.type !== 'application/pdf') {
      alert('Please select a PDF file');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    if (selectedFile.size > 5 * 1024 * 1024) {
      alert('File size must be less than 5MB');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    setFile(selectedFile);
    await uploadResumeFile(selectedFile);
  };

const pollAnalysisStatus = async (resumeId: string) => {
    try {
      const response = await axios.get(`/api/resumes/${resumeId}/analysis`);
      
      if (response.data.data && response.data.data.length > 0) {
        const latestAnalysis = response.data.data[0];
        if (latestAnalysis.status === 'completed') {
          setCurrentAnalysis({
            id: latestAnalysis.id,
            matchPercentage: latestAnalysis.matchPercentage,
            skillsRadar: typeof latestAnalysis.skillsRadar === 'string' ? JSON.parse(latestAnalysis.skillsRadar) : latestAnalysis.skillsRadar,
            missingKeywords: latestAnalysis.missingKeywords,
            suggestions: latestAnalysis.suggestions,
            createdAt: latestAnalysis.createdAt,
          });
          setHistory(response.data.data.map((a: any) => ({
            id: a.id,
            matchPercentage: a.matchPercentage,
            skillsRadar: typeof a.skillsRadar === 'string' ? JSON.parse(a.skillsRadar) : a.skillsRadar,
            missingKeywords: a.missingKeywords,
            suggestions: a.suggestions,
            createdAt: a.createdAt,
          })));
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          return true;
        } else if (latestAnalysis.status === 'failed') {
          setError('Analysis failed. Please try again.');
          setAnalyzing(false);
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error('Failed to poll analysis status:', error);
      return false;
    }
  };

const handleAnalyze = async () => {
    if (!resumeId) {
      setError('Please upload a resume first');
      alert('Please upload a resume first');
      return;
    }
    if (!jobDescription.trim()) {
      setError('Please provide a job description');
      alert('Please provide a job description');
      return;
    }

    setAnalyzing(true);
    setAnalysisProgress(10);
    setError(null);
    try {
      // Submit analysis job
      setAnalysisProgress(20);
      const response = await axios.post(`/api/resumes/${resumeId}/analyze`, {
        jobDescription,
      });

      if (!response.data.success) {
        throw new Error(response.data.error || 'Failed to queue analysis');
      }

      setAnalysisProgress(30);
      // Save job description to localStorage
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        ...saved,
        jobDescription
      }));

      // Poll for results (check every 2 seconds, max 60 seconds)
      let pollCount = 0;
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      const interval = setInterval(async () => {
        pollCount++;
        setAnalysisProgress(30 + Math.min(pollCount * 10, 60)); // Progress 30-90%
        const completed = await pollAnalysisStatus(resumeId);
        
        if (completed || pollCount > 30) {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          setAnalyzing(false);
          setAnalysisProgress(100);
          if (!completed) {
            setError('Analysis is taking longer than expected. Please check back in a moment.');
          }
        }
      }, 2000);

      pollIntervalRef.current = interval;
    } catch (error: any) {
      console.error('Analysis failed:', error);
      const msg = error.response?.data?.error || error.message || 'Failed to analyze resume';
      setError(msg);
      alert(msg);
      setAnalyzing(false);
      setAnalysisProgress(0);
    }
  };

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []);

return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Resume Analyzer</h1>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Your Resume</h2>
          
          {resumeId ? (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">📄</span>
                <div>
                  <p className="font-medium text-gray-900">{resumeName}</p>
                  <p className="text-sm text-green-600">✓ Resume saved</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setResumeId(null);
                  setResumeName('');
                  localStorage.removeItem(STORAGE_KEY);
                }}
                className="text-sm text-red-600 hover:underline"
              >
                Remove and upload new
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-primary-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  onChange={handleFileChange}
                  className="hidden"
                />
                {uploading ? (
                  <div>
                    <p className="text-lg font-medium text-gray-900">Uploading...</p>
                    <p className="text-sm text-gray-500">Please wait while we process your resume</p>
                  </div>
                ) : file ? (
                  <div>
                    <p className="text-lg font-medium text-gray-900">{file.name}</p>
                    <p className="text-sm text-gray-500">Click to change file</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-4xl mb-2">📄</p>
                    <p className="text-gray-600">Click to upload PDF resume</p>
                    <p className="text-sm text-gray-400">Max file size: 5MB</p>
                  </div>
                )}
              </button>

            </>
          )}
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Job Description</h2>
          <textarea
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            className="input h-48"
            placeholder="Paste job description here..."
          />
          
          <button
            onClick={handleAnalyze}
            disabled={analyzing || !resumeId || !jobDescription}
            className="btn-primary w-full mt-4"
          >
            {analyzing ? (
              <div>
                <div className="flex items-center justify-center mb-2">
                  <span className="animate-spin mr-2">⏳</span>
                  Analyzing...
                </div>
                <div className="w-full bg-blue-200 rounded-full h-1.5">
                  <div 
                    className="bg-blue-600 h-1.5 rounded-full transition-all duration-300" 
                    style={{ width: `${analysisProgress}%` }}
                  ></div>
                </div>
              </div>
            ) : (
              'Analyze Resume'
            )}
          </button>
        </div>
      </div>

      {currentAnalysis && (
        <div className="mt-6 card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Analysis Results</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="text-center mb-4">
                <p className="text-sm text-gray-500">Match Score</p>
                <p className="text-4xl font-bold text-primary-600">{currentAnalysis.matchPercentage}%</p>
              </div>
              <RadarChart data={currentAnalysis.skillsRadar} />
            </div>
            
            <div>
              <h3 className="font-medium text-gray-900 mb-2">Missing Keywords</h3>
              <div className="flex flex-wrap gap-2 mb-4">
                {currentAnalysis.missingKeywords.map((keyword) => (
                  <span
                    key={keyword}
                    className="px-2 py-1 bg-red-100 text-red-700 rounded text-sm"
                  >
                    {keyword}
                  </span>
                ))}
              </div>

              <h3 className="font-medium text-gray-900 mb-2">Suggestions</h3>
              <ul className="space-y-2">
                {currentAnalysis.suggestions.map((suggestion, idx) => (
                  <li key={idx} className="flex items-start text-sm text-gray-600">
                    <span className="mr-2">•</span>
                    {suggestion}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-6 card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Analysis History</h2>
          <div className="space-y-2">
            {history.map((analysis) => (
              <button
                type="button"
                key={analysis.id}
                onClick={() => setCurrentAnalysis(analysis)}
                className="w-full p-3 border border-gray-200 rounded-lg text-left cursor-pointer hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <div className="flex justify-between items-center">
                  <span className="font-medium">{analysis.matchPercentage}%</span>
                  <span className="text-sm text-gray-500">
                    {new Date(analysis.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
