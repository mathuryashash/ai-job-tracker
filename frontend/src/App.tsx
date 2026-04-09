import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const ResumeAnalyzer = lazy(() => import('./pages/ResumeAnalyzer'));
const JobTracker = lazy(() => import('./pages/JobTracker'));
const Automation = lazy(() => import('./pages/Automation'));
const Login = lazy(() => import('./pages/Login'));

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
    </div>
  );
}

function ProtectedRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" />;
  }

  return <Layout><Outlet /></Layout>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/resume" element={<ResumeAnalyzer />} />
            <Route path="/jobs" element={<JobTracker />} />
            <Route path="/automation" element={<Automation />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
