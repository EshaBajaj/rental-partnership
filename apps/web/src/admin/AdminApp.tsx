// Admin shell: auth guard, admin check, property context, layout and routes.
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { must, qk, supabase } from './api.ts';
import { Ctx, useAdmin } from './context.tsx';
import { Login } from './Login.tsx';
import type { AdminRow, PropertyRow } from './types.ts';
import { ConfirmProvider, ErrorBoundary, ErrorBox, Spinner, ToastProvider } from './ui.tsx';
import { Board } from './board/Board.tsx';
import { LeadDetail } from './lead/LeadDetail.tsx';

const FormBuilder = lazy(() => import('./form/FormBuilder.tsx'));
const Profiles = lazy(() => import('./profiles/Profiles.tsx'));
const Settings = lazy(() => import('./settings/Settings.tsx'));
const Funnel = lazy(() => import('./funnel/Funnel.tsx'));
const Audit = lazy(() => import('./audit/Audit.tsx'));

const PROP_KEY = 'sls.admin.property';

export default function AdminApp() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <AuthGate />
      </ConfirmProvider>
    </ToastProvider>
  );
}

function AuthGate() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const qc = useQueryClient();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) qc.clear();
    });
    return () => data.subscription.unsubscribe();
  }, [qc]);
  const loc = useLocation();
  if (session === undefined) return <Spinner />;
  if (!session) return loc.pathname === '/admin/login' ? <Login /> : <Navigate to="/admin/login" replace />;
  if (loc.pathname === '/admin/login') return <Navigate to="/admin" replace />;
  return <AdminGate session={session} />;
}

function AdminGate({ session }: { session: Session }) {
  const me = useQuery({
    queryKey: [...qk.me, session.user.id],
    queryFn: async () => must(await supabase.from('admins').select('*').eq('user_id', session.user.id).maybeSingle()) as AdminRow | null,
  });
  const props = useQuery({
    queryKey: qk.properties,
    enabled: !!me.data,
    queryFn: async () => must(await supabase.from('properties').select('*').order('created_at')) as PropertyRow[],
  });
  const [pid, setPid] = useState<string | null>(() => {
    try {
      return localStorage.getItem(PROP_KEY);
    } catch {
      return null;
    }
  });
  const property = useMemo(() => props.data?.find((p) => p.id === pid) ?? props.data?.[0], [props.data, pid]);

  if (me.isLoading) return <Spinner />;
  if (me.error) return <div className="p-6"><ErrorBox error={me.error} onRetry={() => me.refetch()} /></div>;
  if (!me.data)
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <div className="card max-w-sm space-y-3 p-6 text-center">
          <h1 className="text-lg font-semibold">Your account is not an admin</h1>
          <p className="text-sm text-stone-600">
            You are signed in as {session.user.email}. Ask the owner to add this email in Settings → Admins.
          </p>
          <button className="btn-secondary" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </div>
    );
  if (props.isLoading) return <Spinner />;
  if (props.error) return <div className="p-6"><ErrorBox error={props.error} onRetry={() => props.refetch()} /></div>;
  if (!property) return <div className="p-6"><ErrorBox error="No property exists yet. Run the seed (see docs/DEPLOY.md)." /></div>;

  const setPropertyId = (id: string) => {
    setPid(id);
    try {
      localStorage.setItem(PROP_KEY, id);
    } catch {
      /* private mode */
    }
  };
  return (
    <Ctx.Provider value={{ session, me: me.data, property, properties: props.data ?? [], setPropertyId }}>
      <Layout />
    </Ctx.Provider>
  );
}

const NAV = [
  { to: '/admin', label: 'Leads', end: true },
  { to: '/admin/form', label: 'Form' },
  { to: '/admin/profiles', label: 'Profiles' },
  { to: '/admin/funnel', label: 'Funnel' },
  { to: '/admin/settings', label: 'Settings' },
  { to: '/admin/audit', label: 'Audit' },
];

function Layout() {
  const { me, property, properties, setPropertyId } = useAdmin();
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  useEffect(() => setMenu(false), [loc.pathname]);
  useEffect(() => {
    document.title = `Admin · ${property.name}`;
  }, [property.name]);
  return (
    <div className="min-h-dvh bg-stone-100">
      <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2">
          <button className="btn-ghost px-2 md:hidden" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            ☰
          </button>
          <span className="font-semibold text-brand-800">Lead Screener</span>
          {properties.length > 1 ? (
            <select className="input w-auto py-1 text-sm" aria-label="Property" value={property.id} onChange={(e) => setPropertyId(e.target.value)}>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="hidden truncate text-sm text-stone-500 sm:inline">{property.name}</span>
          )}
          {property.status === 'closed' && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">Form closed</span>}
          <nav className="ml-4 hidden gap-1 md:flex" aria-label="Main">
            {NAV.map((n) => (
              <NavItem key={n.to} {...n} />
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-xs text-stone-500 lg:inline">
              {me.email} · {me.role}
            </span>
            <button className="btn-ghost px-2 py-1 text-sm" onClick={() => supabase.auth.signOut()}>
              Sign out
            </button>
          </div>
        </div>
        {menu && (
          <nav className="flex flex-col border-t border-stone-200 px-2 py-2 md:hidden" aria-label="Main mobile">
            {NAV.map((n) => (
              <NavItem key={n.to} {...n} />
            ))}
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-6xl px-3 py-4 sm:px-4">
        <ErrorBoundary key={loc.pathname}>
          <Suspense fallback={<Spinner />}>
            <Routes>
              <Route index element={<Board />} />
              <Route path="leads/:id" element={<LeadDetail />} />
              <Route path="form" element={<FormBuilder />} />
              <Route path="profiles" element={<Profiles />} />
              <Route path="funnel" element={<Funnel />} />
              <Route path="settings" element={<Settings />} />
              <Route path="audit" element={<Audit />} />
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}

function NavItem({ to, label, end }: { to: string; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-brand-50 text-brand-800' : 'text-stone-600 hover:bg-stone-100'}`}
    >
      {label}
    </NavLink>
  );
}
