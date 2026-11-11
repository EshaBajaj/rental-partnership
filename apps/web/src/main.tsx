import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { DEFAULT_SLUG } from './lib/env.ts';
import { RespondentApp } from './respondent/RespondentApp.tsx';

const AdminApp = lazy(() => import('./admin/AdminApp.tsx'));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 2, refetchOnWindowFocus: false, staleTime: 30_000 } },
});

function Loading() {
  return <div className="flex min-h-dvh items-center justify-center text-stone-500">Loading…</div>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to={`/f/${DEFAULT_SLUG}`} replace />} />
          <Route path="/f/:slug" element={<RespondentApp />} />
          <Route
            path="/admin/*"
            element={
              <Suspense fallback={<Loading />}>
                <AdminApp />
              </Suspense>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
