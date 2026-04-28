import { useEffect, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';

interface Stats {
  totalApplications: number;
  applied: number;
  interviewing: number;
  offers: number;
  rejected: number;
}

interface JobRecommendation {
  job: {
    id: string;
    title: string;
    company: string;
    location: string;
    url: string;
    salary: string | null;
    source: string;
  };
  score: number;
  reasons: string[];
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats>({
    totalApplications: 0,
    applied: 0,
    interviewing: 0,
    offers: 0,
    rejected: 0,
  });
  const [recommendations, setRecommendations] = useState<JobRecommendation[]>([]);
  const [loadingRecommendations, setLoadingRecommendations] = useState(false);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await axios.get('/api/applications');
        
        const applications = response.data.data || [];
        const statusCounts = applications.reduce((acc: Record<string, number>, app: { status: string }) => {
          acc[app.status] = (acc[app.status] || 0) + 1;
          return acc;
        }, {});

        setStats({
          totalApplications: applications.length,
          applied: statusCounts.applied || 0,
          interviewing: statusCounts.interviewing || 0,
          offers: statusCounts.offer || 0,
          rejected: statusCounts.rejected || 0,
        });
      } catch (error) {
        console.error('Failed to fetch stats:', error);
      }
    };

    const fetchRecommendations = async () => {
      try {
        setLoadingRecommendations(true);
        const response = await axios.get('/api/automation/recommendations?limit=10');
        if (response.data.success) {
          setRecommendations(response.data.data.recommendations || []);
        }
      } catch (error) {
        console.error('Failed to fetch recommendations:', error);
      } finally {
        setLoadingRecommendations(false);
      }
    };

    fetchStats();
    fetchRecommendations();
  }, []);

  const statCards = [
    { label: 'Total Applications', value: stats.totalApplications, color: 'bg-primary-100 text-primary-700' },
    { label: 'Applied', value: stats.applied, color: 'bg-blue-100 text-blue-700' },
    { label: 'Interviewing', value: stats.interviewing, color: 'bg-yellow-100 text-yellow-700' },
    { label: 'Offers', value: stats.offers, color: 'bg-green-100 text-green-700' },
    { label: 'Rejected', value: stats.rejected, color: 'bg-red-100 text-red-700' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
        {statCards.map((stat) => (
          <div key={stat.label} className="card">
            <p className="text-sm text-gray-500 mb-1">{stat.label}</p>
            <p className={`text-3xl font-bold ${stat.color} px-3 py-1 rounded-lg`}>
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
          <div className="space-y-3">
            <Link
              to="/resume"
              className="block p-4 border border-gray-200 rounded-lg hover:border-primary-500 hover:bg-primary-50 transition-colors"
            >
              <p className="font-medium text-gray-900">📄 Analyze Resume</p>
              <p className="text-sm text-gray-500">Upload and analyze your resume against job descriptions</p>
            </Link>
            <Link
              to="/jobs"
              className="block p-4 border border-gray-200 rounded-lg hover:border-primary-500 hover:bg-primary-50 transition-colors"
            >
              <p className="font-medium text-gray-900">💼 Track Applications</p>
              <p className="text-sm text-gray-500">Manage your job applications with Kanban board</p>
            </Link>
          </div>
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Getting Started</h2>
          <ol className="space-y-3 text-sm text-gray-600">
            <li className="flex items-start">
              <span className="flex-shrink-0 w-6 h-6 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center text-xs font-bold mr-3">1</span>
              Upload your resume and get AI-powered analysis
            </li>
            <li className="flex items-start">
              <span className="flex-shrink-0 w-6 h-6 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center text-xs font-bold mr-3">2</span>
              Create job applications and track them in Kanban
            </li>
            <li className="flex items-start">
              <span className="flex-shrink-0 w-6 h-6 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center text-xs font-bold mr-3">3</span>
              Generate tailored cover letters automatically
            </li>
            <li className="flex items-start">
              <span className="flex-shrink-0 w-6 h-6 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center text-xs font-bold mr-3">4</span>
              Log activities and track interview progress
            </li>
          </ol>
        </div>
      </div>

      {/* Job Recommendations Section */}
      {recommendations.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Recommended Jobs</h2>
            <span className="text-sm text-gray-500">Based on your resume & preferences</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {recommendations.slice(0, 6).map((rec) => (
              <a
                key={rec.job.id}
                href={rec.job.url}
                target="_blank"
                rel="noopener noreferrer"
                className="card hover:border-primary-500 transition-colors"
              >
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-medium text-gray-900 text-sm line-clamp-2">
                    {rec.job.title}
                  </h3>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                    rec.score >= 70 ? 'bg-green-100 text-green-700' :
                    rec.score >= 50 ? 'bg-yellow-100 text-yellow-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {rec.score}%
                  </span>
                </div>
                <p className="text-sm text-gray-600 mb-2">{rec.job.company}</p>
                <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                  <span>📍 {rec.job.location}</span>
                  {rec.job.salary && <span>💰 {rec.job.salary}</span>}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">{rec.job.source}</span>
                  <div className="flex gap-1">
                    {rec.reasons.slice(0, 2).map((reason, idx) => (
                      <span key={idx} className="text-xs bg-primary-50 text-primary-600 px-2 py-0.5 rounded">
                        {reason}
                      </span>
                    ))}
                  </div>
                </div>
              </a>
            ))}
          </div>
          {recommendations.length > 6 && (
            <div className="text-center mt-4">
              <Link
                to="/jobs"
                className="text-sm text-primary-600 hover:text-primary-700 font-medium"
              >
                View all {recommendations.length} recommendations →
              </Link>
            </div>
          )}
        </div>
      )}

      {loadingRecommendations && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Recommended Jobs</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="card animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                <div className="h-3 bg-gray-200 rounded w-1/2 mb-2"></div>
                <div className="h-3 bg-gray-200 rounded w-2/3"></div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}