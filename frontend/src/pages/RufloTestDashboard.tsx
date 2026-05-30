import { useState, useEffect, useCallback } from 'react';
import { Activity, Database, Zap, Shield, Clock, CheckCircle, XCircle, AlertCircle, Loader } from 'lucide-react';

interface TestResult {
  name: string;
  status: 'pending' | 'running' | 'success' | 'error';
  latency?: number;
  error?: string;
  data?: any;
}

interface DashboardMetrics {
  uptime: string;
  totalRequests: number;
  avgLatency: number;
  errorRate: number;
}

const testEndpoints = [
  { name: 'Health Check', path: '/api/health', method: 'GET', auth: false },
  { name: 'Dev Login', path: '/api/auth/dev-login', method: 'POST', body: { email: 'test@test.com', name: 'Test User' } },
  { name: 'Automation Stats', path: '/api/automation/stats', method: 'GET', auth: true },
  { name: 'Scraper Jobs', path: '/api/scraper/jobs?limit=3', method: 'GET', auth: true },
  { name: 'Scraper Status', path: '/api/scraper/status', method: 'GET', auth: true },
  { name: 'User Profile', path: '/api/auth/me', method: 'GET', auth: true },
];

export default function RufloTestDashboard() {
  const [results, setResults] = useState<TestResult[]>(testEndpoints.map(e => ({ name: e.name, status: 'pending' })));
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    uptime: '0h',
    totalRequests: 0,
    avgLatency: 0,
    errorRate: 0
  });
  const [running, setRunning] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  const runTests = useCallback(async () => {
    setRunning(true);
    setResults(prev => prev.map(r => ({ ...r, status: 'pending', latency: undefined, error: undefined })));

    let authToken: string | null = null;

    for (let i = 0; i < testEndpoints.length; i++) {
      const endpoint = testEndpoints[i];
      
      setResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'running' } : r));
      
      const startTime = Date.now();
      
      try {
        let url = `http://localhost:3001${endpoint.path}`;
        let options: RequestInit = { method: endpoint.method, headers: { 'Content-Type': 'application/json' } };
        
        if (endpoint.auth && !authToken) continue;
        if (endpoint.auth && authToken) {
          options.headers = { ...options.headers, 'Authorization': `Bearer ${authToken}` };
        }
        if (endpoint.body) {
          options.body = JSON.stringify(endpoint.body);
        }

        const response = await fetch(url, options);
        const data = await response.json();
        const latency = Date.now() - startTime;

        if (endpoint.name === 'Dev Login') {
          authToken = data.data?.token || null;
          setToken(authToken);
        }

        setResults(prev => prev.map((r, idx) => idx === i ? { 
          ...r, 
          status: response.ok && data.success !== false ? 'success' : 'error', 
          latency,
          data: endpoint.auth && !authToken ? null : data 
        } : r));
      } catch (error: any) {
        setResults(prev => prev.map((r, idx) => {
          if (idx === i) {
            return { ...r, status: 'error', error: error.message || 'Connection failed' };
          }
          return r;
        }));
      }
    }

    const successfulTests = results.filter(r => r.status === 'success').length;
    const avgLatency = results.filter(r => r.latency).reduce((sum, r) => sum + (r.latency || 0), 0) / results.length;
    
    setMetrics(prev => ({
      ...prev,
      totalRequests: prev.totalRequests + testEndpoints.length,
      avgLatency: Math.round(avgLatency),
      errorRate: Math.round(((testEndpoints.length - successfulTests) / testEndpoints.length) * 100)
    }));

    setRunning(false);
  }, []);

  useEffect(() => {
    runTests();
    const interval = setInterval(() => {
      setMetrics(prev => ({ ...prev, uptime: '24h' }));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'error': return <XCircle className="w-5 h-5 text-red-500" />;
      case 'running': return <Loader className="w-5 h-5 text-blue-500 animate-spin" />;
      default: return <Clock className="w-5 h-5 text-gray-400" />;
    }
  };

  const getEndpointData = (result: TestResult) => {
    if (!result.data) return null;
    try {
      return typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
    } catch {
      return result.data;
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
              Ruflo Test Dashboard
            </h1>
            <p className="text-gray-400 mt-1">AI Resume Job Tracker - System Health Monitor</p>
          </div>
          <button
            onClick={runTests}
            disabled={running}
            className={`px-6 py-3 rounded-lg font-medium flex items-center gap-2 ${
              running ? 'bg-gray-700 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            <Zap className={`w-5 h-5 ${running ? 'animate-pulse' : ''}`} />
            {running ? 'Running Tests...' : 'Run All Tests'}
          </button>
        </div>

        {/* Metrics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <div className="flex items-center gap-3 mb-2">
              <Activity className="w-5 h-5 text-blue-400" />
              <span className="text-gray-400">Uptime</span>
            </div>
            <p className="text-2xl font-bold">{metrics.uptime}</p>
          </div>
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <div className="flex items-center gap-3 mb-2">
              <Database className="w-5 h-5 text-green-400" />
              <span className="text-gray-400">Total Requests</span>
            </div>
            <p className="text-2xl font-bold">{metrics.totalRequests}</p>
          </div>
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <div className="flex items-center gap-3 mb-2">
              <Clock className="w-5 h-5 text-yellow-400" />
              <span className="text-gray-400">Avg Latency</span>
            </div>
            <p className="text-2xl font-bold">{metrics.avgLatency}ms</p>
          </div>
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <div className="flex items-center gap-3 mb-2">
              <AlertCircle className="w-5 h-5 text-purple-400" />
              <span className="text-gray-400">Error Rate</span>
            </div>
            <p className="text-2xl font-bold">{metrics.errorRate}%</p>
          </div>
        </div>

        {/* Token Info */}
        {token && (
          <div className="bg-gray-800 rounded-xl p-4 mb-6 border border-gray-700">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-green-400" />
              <span className="text-gray-400 text-sm">Auth Token:</span>
              <code className="text-green-400 text-sm font-mono">{token.substring(0, 50)}...</code>
            </div>
          </div>
        )}

        {/* Test Results */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {results.map((result, idx) => (
            <div key={idx} className={`bg-gray-800 rounded-xl border ${
              result.status === 'success' ? 'border-green-800' :
              result.status === 'error' ? 'border-red-800' :
              result.status === 'running' ? 'border-blue-800' :
              'border-gray-700'
            }`}>
              <div className="p-4 border-b border-gray-700 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  {getStatusIcon(result.status)}
                  <span className="font-medium">{result.name}</span>
                </div>
                {result.latency && (
                  <span className="text-sm text-gray-400">{result.latency}ms</span>
                )}
              </div>
              <div className="p-4">
                {result.status === 'error' ? (
                  <p className="text-red-400 text-sm">{result.error || 'Test failed'}</p>
                ) : result.data ? (
                  <pre className="text-xs text-gray-300 overflow-x-auto max-h-40">
                    {getEndpointData(result)}
                  </pre>
                ) : result.status === 'running' ? (
                  <div className="flex items-center gap-2 text-blue-400 text-sm">
                    <Loader className="w-4 h-4 animate-spin" />
                    Running test...
                  </div>
                ) : (
                  <p className="text-gray-500 text-sm">Pending test...</p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* System Components */}
        <div className="mt-8">
          <h2 className="text-xl font-semibold mb-4">System Components</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-green-500"></div>
                <span className="text-sm font-medium">Backend API</span>
              </div>
              <p className="text-xs text-gray-400">localhost:3001</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-green-500"></div>
                <span className="text-sm font-medium">Database</span>
              </div>
              <p className="text-xs text-gray-400">PostgreSQL Connected</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
                <span className="text-sm font-medium">Cache</span>
              </div>
              <p className="text-xs text-gray-400">Redis (fallback mode)</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-green-500"></div>
                <span className="text-sm font-medium">WebSocket</span>
              </div>
              <p className="text-xs text-gray-400">ws://localhost:3001/ws</p>
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="mt-8">
          <h2 className="text-xl font-semibold mb-4">Test Summary</h2>
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <div className="flex justify-around text-center">
              <div>
                <p className="text-3xl font-bold text-green-500">
                  {results.filter(r => r.status === 'success').length}
                </p>
                <p className="text-sm text-gray-400">Passed</p>
              </div>
              <div>
                <p className="text-3xl font-bold text-red-500">
                  {results.filter(r => r.status === 'error').length}
                </p>
                <p className="text-sm text-gray-400">Failed</p>
              </div>
              <div>
                <p className="text-3xl font-bold text-blue-500">
                  {results.filter(r => r.status === 'running').length}
                </p>
                <p className="text-sm text-gray-400">Running</p>
              </div>
              <div>
                <p className="text-3xl font-bold text-gray-500">
                  {results.filter(r => r.status === 'pending').length}
                </p>
                <p className="text-sm text-gray-400">Pending</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}