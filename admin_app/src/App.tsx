import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { Shell } from './components/Shell';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { ApplicationsPage } from './pages/ApplicationsPage';
import { AuditPage } from './pages/AuditPage';
import { BalancesPage } from './pages/BalancesPage';
import { DashboardPage } from './pages/DashboardPage';
import { PlatformFeesPage } from './pages/PlatformFeesPage';
import { DrivesPage } from './pages/DrivesPage';
import { LoginPage } from './pages/LoginPage';
import { SecurityPage } from './pages/SecurityPage';
import { SessionsPage } from './pages/SessionsPage';
import { UsersPage } from './pages/UsersPage';
import type { ReactNode } from 'react';

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (!auth.authed) return <Navigate to="/login" replace />;
  return children;
}

export function App() {
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <Shell />
                </RequireAuth>
              }
            >
              <Route index element={<DashboardPage />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="drives" element={<DrivesPage />} />
              <Route path="applications" element={<ApplicationsPage />} />
              <Route path="balances" element={<BalancesPage />} />
              <Route path="platform-fees" element={<PlatformFeesPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
              <Route path="security" element={<SecurityPage />} />
              <Route path="audit" element={<AuditPage />} />
              <Route path="sessions" element={<SessionsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
