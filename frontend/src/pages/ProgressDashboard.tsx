import { useState, useEffect } from 'react';
import axios from 'axios';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';

interface StatsData {
  total: number;
  statusCounts: Record<string, number>;
  sourceCounts: Record<string, number>;
  averageMatchScore: number;
  weeklyTrends: Record<string, number>;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

export default function ProgressDashboard() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const response = await axios.get('/api/automation/stats');
      if (response.data.success) {
        setStats(response.data.data);
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!stats) {
    return <div className="text-gray-500">No data available</div>;
  }

  const statusData = Object.entries(stats.statusCounts).map(([name, value]) => ({ name: name === 'todo' ? 'To Do' : name.charAt(0).toUpperCase() + name.slice(1), value }));
  const sourceData = Object.entries(stats.sourceCounts).map(([name, value]) => ({ name, value }));
  const weeklyData = Object.entries(stats.weeklyTrends)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, count]) => ({ week: formatWeek(week), count }));

  const successRate = stats.total > 0 ? Math.round(((stats.statusCounts.offer || 0) / stats.total) * 100) : 0;
  const activeCount = (stats.statusCounts.applied || 0) + (stats.statusCounts.interviewing || 0);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Progress Dashboard</h1>
        <button
          onClick={fetchStats}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-6">
          <p className="text-sm text-gray-500">Total Applications</p>
          <p className="text-3xl font-bold text-gray-900">{stats.total}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <p className="text-sm text-gray-500">Average Match Score</p>
          <p className="text-3xl font-bold text-gray-900">{stats.averageMatchScore}%</p>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <p className="text-sm text-gray-500">Active Applications</p>
          <p className="text-3xl font-bold text-gray-900">{activeCount}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <p className="text-sm text-gray-500">Success Rate</p>
          <p className="text-3xl font-bold text-green-600">{successRate}%</p>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status Distribution */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Applications by Status</h2>
          {statusData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {statusData.map((_entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-gray-500 text-center py-8">No applications yet</p>
          )}
        </div>

        {/* Source Distribution */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Applications by Source</h2>
          {sourceData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={sourceData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="#0088FE" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-gray-500 text-center py-8">No source data yet</p>
          )}
        </div>
      </div>

      {/* Weekly Trend */}
      {weeklyData.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Weekly Application Trend</h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={weeklyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="week" tick={{ fontSize: 12 }} />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="count" stroke="#0088FE" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Quick Stats Table */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Status Breakdown</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-4 font-medium text-gray-700">Status</th>
                <th className="text-right py-2 px-4 font-medium text-gray-700">Count</th>
                <th className="text-right py-2 px-4 font-medium text-gray-700">Percentage</th>
              </tr>
            </thead>
            <tbody>
              {statusData.map((item) => (
                <tr key={item.name} className="border-b border-gray-100">
                  <td className="py-2 px-4 capitalize">{item.name}</td>
                  <td className="text-right py-2 px-4">{item.value}</td>
                  <td className="text-right py-2 px-4">
                    {stats.total > 0 ? Math.round((item.value / stats.total) * 100) : 0}%
                  </td>
                </tr>
              ))}
              {statusData.length === 0 && (
                <tr>
                  <td colSpan={3} className="text-center py-4 text-gray-500">No applications yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function formatWeek(weekKey: string): string {
  const date = new Date(weekKey);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}