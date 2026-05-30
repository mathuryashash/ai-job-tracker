# Automation API Keys & Progress Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the automation trigger to pass userApiKeys when searching jobs, and create a progress dashboard to visually track job application progress.

**Architecture:** 
- Backend: Modify automation.graph.ts to fetch user API keys from database and pass to searchJobs
- Frontend: Create a new Progress Dashboard page with charts and stats, plus add API endpoint for aggregated stats

**Tech Stack:** React, TypeScript, Recharts (for charts), Prisma, Express

---

## Task 1: Fix Automation Trigger to Pass UserApiKeys

**Files:**
- Modify: `backend/src/services/automation.graph.ts:195-210`

**Context:** The `searchJobsNode` in the automation graph calls `deps.searchJobs()` without passing userApiKeys, so premium sources like Apify, Jooble, FlexJobs won't work even if user has configured API keys.

### Steps

- [ ] **Step 1: Modify searchJobsNode to fetch and pass userApiKeys**

The function already has `state.userId` available. Need to:
1. Import `prisma` at the top of automation.graph.ts
2. In `searchJobsNode`, fetch user's API keys from `prisma.user.findUnique` using userId
3. Pass userApiKeys as second argument to `deps.searchJobs()`

```typescript
// Add at top of automation.graph.ts if not already present
import prisma from '../prisma/index';

// Modify searchJobsNode function
export async function searchJobsNode(
  state: AutomationGraphState,
  deps: SearchJobsDependencies
): Promise<Pick<AutomationGraphState, 'jobs'>> {
  // Fetch user's API keys
  const user = await prisma.user.findUnique({
    where: { id: state.userId },
    select: { preferences: true },
  });
  const userApiKeys = (user?.preferences as any)?.apiKeys || undefined;

  const allJobs: Job[] = [];
  for (const query of state.searchQueries) {
    const jobs = await deps.searchJobs(
      { keywords: query, location: state.config.location },
      userApiKeys  // Pass userApiKeys here
    );
    allJobs.push(...jobs);
  }

  return { jobs: allJobs };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd backend && npm run build`
Expected: Success with no errors

- [ ] **Step 3: Test the fix manually**

```bash
# Start backend if not running
curl -s -H "Authorization: Bearer dev-bypass-token" "http://localhost:3001/api/automation/search?keywords=software&remote=true"
```

Expected: Returns jobs from all sources including those requiring API keys (if configured)

---

## Task 2: Create Progress Dashboard

**Files:**
- Modify: `backend/src/routes/automation.routes.ts` - Add stats endpoint
- Create: `frontend/src/pages/ProgressDashboard.tsx`
- Modify: `frontend/src/App.tsx` - Add route for dashboard

### Steps

- [ ] **Step 1: Add API endpoint for aggregated stats**

In `backend/src/routes/automation.routes.ts`, add a new GET endpoint `/api/automation/stats` that returns:
- Total applications count
- Applications by status (todo, applied, interviewing, offer, rejected)
- Applications by source
- Weekly/monthly trends
- Average match score

Add this after the existing routes (around line 395):

```typescript
// Get automation/stats endpoint
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    // Get all applications for user
    const applications = await prisma.jobApplication.findMany({
      where: { userId },
      select: {
        status: true,
        source: true,
        applicationDate: true,
        activities: {
          where: { type: 'note' },
          select: { metadata: true },
        },
      },
    });

    // Calculate stats
    const statusCounts = {
      todo: 0,
      applied: 0,
      interviewing: 0,
      offer: 0,
      rejected: 0,
    };
    const sourceCounts: Record<string, number> = {};
    let totalMatchScore = 0;
    let matchScoreCount = 0;

    for (const app of applications) {
      if (app.status in statusCounts) {
        statusCounts[app.status as keyof typeof statusCounts]++;
      }
      if (app.source) {
        sourceCounts[app.source] = (sourceCounts[app.source] || 0) + 1;
      }
      if (app.activities[0]?.metadata) {
        const score = (app.activities[0].metadata as any).matchPercentage;
        if (typeof score === 'number') {
          totalMatchScore += score;
          matchScoreCount++;
        }
      }
    }

    // Calculate weekly trends (last 4 weeks)
    const fourWeeksAgo = new Date();
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
    const weeklyTrends: Record<string, number> = {};
    for (const app of applications) {
      if (app.applicationDate && app.applicationDate >= fourWeeksAgo) {
        const week = getWeekKey(app.applicationDate);
        weeklyTrends[week] = (weeklyTrends[week] || 0) + 1;
      }
    }

    res.json({
      success: true,
      data: {
        total: applications.length,
        statusCounts,
        sourceCounts,
        averageMatchScore: matchScoreCount > 0 ? Math.round(totalMatchScore / matchScoreCount) : 0,
        weeklyTrends,
      },
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ success: false, error: 'Failed to get stats' });
  }
});

function getWeekKey(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().split('T')[0];
}
```

- [ ] **Step 2: Build backend**

Run: `cd backend && npm run build`
Expected: Success with no errors

- [ ] **Step 3: Create Progress Dashboard frontend component**

Create `frontend/src/pages/ProgressDashboard.tsx`:

```tsx
import { useState, useEffect } from 'react';
import axios from 'axios';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend } from 'recharts';

interface StatsData {
  total: number;
  statusCounts: Record<string, number>;
  sourceCounts: Record<string, number>;
  averageMatchScore: number;
  weeklyTrends: Record<string, number>;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

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

  const statusData = Object.entries(stats.statusCounts).map(([name, value]) => ({ name, value }));
  const sourceData = Object.entries(stats.sourceCounts).map(([name, value]) => ({ name, value }));
  const weeklyData = Object.entries(stats.weeklyTrends)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, count]) => ({ week: formatWeek(week), count }));

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Progress Dashboard</h1>
        <button onClick={fetchStats} className="btn-secondary text-sm">
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card">
          <p className="text-sm text-gray-500">Total Applications</p>
          <p className="text-3xl font-bold text-gray-900">{stats.total}</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">Average Match Score</p>
          <p className="text-3xl font-bold text-gray-900">{stats.averageMatchScore}%</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">Active Applications</p>
          <p className="text-3xl font-bold text-gray-900">{stats.statusCounts.applied + stats.statusCounts.interviewing}</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">Success Rate</p>
          <p className="text-3xl font-bold text-green-600">
            {stats.total > 0 ? Math.round(((stats.statusCounts.offer || 0) / stats.total) * 100) : 0}%
          </p>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status Distribution */}
        <div className="card">
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
                  {statusData.map((entry, index) => (
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
        <div className="card">
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
        <div className="card">
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
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Status Breakdown</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2">Status</th>
                <th className="text-right py-2">Count</th>
                <th className="text-right py-2">Percentage</th>
              </tr>
            </thead>
            <tbody>
              {statusData.map((item) => (
                <tr key={item.name} className="border-b">
                  <td className="py-2 capitalize">{item.name}</td>
                  <td className="text-right py-2">{item.value}</td>
                  <td className="text-right py-2">
                    {stats.total > 0 ? Math.round((item.value / stats.total) * 100) : 0}%
                  </td>
                </tr>
              ))}
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
```

- [ ] **Step 4: Add route to App.tsx**

In `frontend/src/App.tsx`, add the new dashboard route:

```tsx
import ProgressDashboard from './pages/ProgressDashboard';

// Add to the routes array:
{ path: '/dashboard/progress', element: <ProgressDashboard /> },
```

- [ ] **Step 5: Build and test**

```bash
cd frontend && npm run build
```

Expected: Success with no errors

- [ ] **Step 6: Test the full flow**

1. Start backend and frontend
2. Navigate to /dashboard/progress
3. Verify stats load correctly with pie charts, bar charts, and trend lines

---

## Verification

Run both backend and frontend, then:

1. **Test API keys flow:**
   - Go to Automation page
   - Open API Keys section
   - Enter an Apify key
   - Click Save
   - Run automation
   - Verify jobs come from Apify sources

2. **Test dashboard:**
   - Navigate to /dashboard/progress
   - Verify charts render correctly
   - Check that status counts match actual applications

Expected: Both features work correctly