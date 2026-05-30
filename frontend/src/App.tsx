import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { useAuth } from './context/AuthContext';
import axios from 'axios';
import Layout from './components/Layout';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const ResumeAnalyzer = lazy(() => import('./pages/ResumeAnalyzer'));
const JobTracker = lazy(() => import('./pages/JobTracker'));
const Automation = lazy(() => import('./pages/Automation'));
const ProgressDashboard = lazy(() => import('./pages/ProgressDashboard'));
const AnalysisDashboard = lazy(() => import('./pages/AnalysisDashboard'));
const Login = lazy(() => import('./pages/Login'));

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-4">
      <h1 className="text-6xl font-bold text-gray-300">404</h1>
      <p className="text-gray-500">Page not found</p>
      <Link to="/" className="text-sm text-primary-600 hover:underline">
        Back to Dashboard
      </Link>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const { token } = useAuth();

  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      delete axios.defaults.headers.common['Authorization'];
    }
  }, [token]);

  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <Layout>
                  <Dashboard />
                </Layout>
              </RequireAuth>
            }
          />
          <Route
            path="/resume"
            element={
              <RequireAuth>
                <Layout>
                  <ResumeAnalyzer />
                </Layout>
              </RequireAuth>
            }
          />
          <Route
            path="/jobs"
            element={
              <RequireAuth>
                <Layout>
                  <JobTracker />
                </Layout>
              </RequireAuth>
            }
          />
          <Route
            path="/automation"
            element={
              <RequireAuth>
                <Layout>
                  <Automation />
                </Layout>
              </RequireAuth>
            }
          />
          <Route
            path="/dashboard/progress"
            element={
              <RequireAuth>
                <Layout>
                  <ProgressDashboard />
                </Layout>
              </RequireAuth>
            }
          />
          <Route
            path="/dashboard/analysis"
            element={
              <RequireAuth>
                <Layout>
                  <AnalysisDashboard />
                </Layout>
              </RequireAuth>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
