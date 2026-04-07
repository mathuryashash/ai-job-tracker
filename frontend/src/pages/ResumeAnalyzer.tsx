import { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import RadarChart from './RadarChart';

interface Analysis {
  id: string;
  matchPercentage: number;
  skillsRadar: Record<string, number>;
  missingKeywords: string[];
  suggestions: string[];
  createdAt: string;
}

export default function ResumeAnalyzer() {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [jobDescription, setJobDescription] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [currentAnalysis, setCurrentAnalysis] = useState<Analysis | null>(null);
  const [history, setHistory] = useState<Analysis[]>([]);
  const [pollInterval, setPollInterval] = useState<NodeJS.Timeout | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.type === 'application/pdf') {
      setFile(selectedFile);
    } else {
      alert('Please select a PDF file');
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('resume', file);

      const response = await axios.post('/api/resumes/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      if (response.data.success) {
        setResumeId(response.data.data.id);
        alert('Resume uploaded successfully!');
      }
    } catch (error) {
      console.error('Upload failed:', error);
      alert('Failed to upload resume');
    } finally {
      setUploading(false);
    }
  };

  const pollAnalysisStatus = async (resumeId: string) => {
    try {
      const response = await axios.get(`/api/resumes/${resumeId}/analysis`);
      
      if (response.data.data && response.data.data.length > 0) {
        const latestAnalysis = response.data.data[0];
        if (latestAnalysis.status === 'completed') {
          setCurrentAnalysis(latestAnalysis);
          setHistory(response.data.data);
          if (pollInterval) clearInterval(pollInterval);
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
    if (!resumeId || !jobDescription) {
      alert('Please upload a resume and provide a job description');
      return;
    }

    setAnalyzing(true);
    try {
      // Submit analysis job
      await axios.post(`/api/resumes/${resumeId}/analyze`, {
        jobDescription,
      });

      // Poll for results (check every 2 seconds, max 60 seconds)
      let pollCount = 0;
      const interval = setInterval(async () => {
        pollCount++;
        const completed = await pollAnalysisStatus(resumeId);
        
        if (completed || pollCount > 30) {
          clearInterval(interval);
          setAnalyzing(false);
          if (!completed) {
            alert('Analysis is taking longer than expected. Please check back in a moment.');
          }
        }
      }, 2000);

      setPollInterval(interval);
    } catch (error) {
      console.error('Analysis failed:', error);
      alert('Failed to queue analysis');
      setAnalyzing(false);
    }
  };

  useEffect(() => {
    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [pollInterval]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Resume Analyzer</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Upload Resume</h2>
          
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-primary-500 transition-colors"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              onChange={handleFileChange}
              className="hidden"
            />
            {file ? (
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
          </div>

          {file && (
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="btn-primary w-full mt-4"
            >
              {uploading ? 'Uploading...' : 'Upload Resume'}
            </button>
          )}
          
          {resumeId && (
            <p className="text-sm text-green-600 mt-2">✓ Resume uploaded</p>
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
              <span className="flex items-center justify-center">
                <span className="animate-spin mr-2">⏳</span>
                Analyzing...
              </span>
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
              <div
                key={analysis.id}
                onClick={() => setCurrentAnalysis(analysis)}
                className="p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50"
              >
                <div className="flex justify-between items-center">
                  <span className="font-medium">{analysis.matchPercentage}%</span>
                  <span className="text-sm text-gray-500">
                    {new Date(analysis.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
