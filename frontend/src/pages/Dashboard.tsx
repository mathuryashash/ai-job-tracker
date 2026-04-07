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

export default function Dashboard() {
  const [stats, setStats] = useState<Stats>({
    totalApplications: 0,
    applied: 0,
    interviewing: 0,
    offers: 0,
    rejected: 0,
  });

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

    fetchStats();
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
    </div>
  );
}