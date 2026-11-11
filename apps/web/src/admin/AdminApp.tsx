// Admin shell: auth guard, admin check, property context, layout and routes.
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { must, qk, supabase } from './api.ts';
import { Ctx, useAdmin } from './context.tsx';
import { Login } from './Login.tsx';
import { ResetPassword } from './ResetPassword.tsx';
import type { AdminRow, PropertyRow } from './types.ts';
import { ConfirmProvider, ErrorBoundary, ErrorBox, Spinner, ToastProvider } from './ui.tsx';
import { Board } from './board/Board.tsx';
import { LeadDetail } from './lead/LeadDetail.tsx';
import { Icon, type IconName } from '../lib/icons.tsx';
import { SETTINGS_SECTIONS } from './settings/sections.ts';

const FormBuilder = lazy(() => import('./form/FormBuilder.tsx'));
const Profiles = lazy(() => import('./profiles/Profiles.tsx'));
const Settings = lazy(() => import('./settings/Settings.tsx'));
const Funnel = lazy(() => import('./funnel/Funnel.tsx'));
const Audit = lazy(() => import('./audit/Audit.tsx'));
const Admins = lazy(() => import('./admins/Admins.tsx'));

const PROP_KEY = 'sls.admin.property';

/** Invite / recovery links land with #…type=invite|recovery; remember it before supabase-js consumes the hash. */
const ARRIVED_TO_SET_PASSWORD = typeof location !== 'undefined' && /type=(invite|recovery)/.test(location.hash);

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
  const nav = useNavigate();
  useEffect(() => {
    if (ARRIVED_TO_SET_PASSWORD && location.pathname !== '/admin/reset') nav('/admin/reset', { replace: true });
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((e, s) => {
      setSession(s);
      if (e === 'PASSWORD_RECOVERY') nav('/admin/reset', { replace: true });
      if (!s) qc.clear();
    });
    return () => data.subscription.unsubscribe();
  }, [qc, nav]);
  const loc = useLocation();
  if (session === undefined) return <Spinner />;
  if (loc.pathname === '/admin/reset') return <ResetPassword session={session} />;
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
          <h1 className="text-lg font-semibold">You're signed in but not an admin — ask an owner to add you</h1>
          <p className="text-sm text-stone-600">Signed in as {session.user.email}.</p>
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

type NavLeaf = { to: string; label: string; icon: IconName; end?: boolean; ownerOnly?: boolean };
type NavGroup = { heading: string; items: NavLeaf[]; collapsible?: { id: string; label: string; icon: IconName; base: string } };

const NAV: NavGroup[] = [
  {
    heading: 'Leads',
    items: [
      { to: '/admin', label: 'Lead board', icon: 'leads', end: true },
      { to: '/admin/funnel', label: 'Funnel', icon: 'funnel' },
    ],
  },
  {
    heading: 'Questionnaire',
    items: [
      { to: '/admin/form', label: 'Form builder', icon: 'form' },
      { to: '/admin/profiles', label: 'Ideal profiles', icon: 'target' },
    ],
  },
  {
    heading: 'Settings',
    collapsible: { id: 'settings', label: 'Settings', icon: 'settings', base: '/admin/settings' },
    items: SETTINGS_SECTIONS.map((x) => ({ to: `/admin/settings/${x.slug}`, label: x.label, icon: x.icon })),
  },
  {
    heading: 'Team',
    items: [
      { to: '/admin/admins', label: 'Admins', icon: 'team', ownerOnly: true },
      { to: '/admin/audit', label: 'Audit log', icon: 'audit' },
    ],
  },
];

/** Phone bottom bar: the four places people go most, plus the full menu. */
const TABS: NavLeaf[] = [
  { to: '/admin', label: 'Leads', icon: 'leads', end: true },
  { to: '/admin/form', label: 'Form', icon: 'form' },
  { to: '/admin/profiles', label: 'Profiles', icon: 'target' },
  { to: '/admin/settings', label: 'Settings', icon: 'settings' },
];

const COLLAPSE_KEY = 'sls.admin.nav.collapsed';
function readCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

function titleFor(path: string): string {
  if (path.startsWith('/admin/leads/')) return 'Lead';
  const hit = NAV.flatMap((g) => g.items).find((l) => (l.end ? path === l.to : path.startsWith(l.to)));
  return hit?.label ?? (path.startsWith('/admin/settings') ? 'Settings' : 'Lead board');
}

function Layout() {
  const { property } = useAdmin();
  const [drawer, setDrawer] = useState(false);
  const loc = useLocation();
  useEffect(() => setDrawer(false), [loc.pathname]);
  useEffect(() => {
    document.title = `Admin · ${property.name}`;
  }, [property.name]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);
  const inSettings = loc.pathname.startsWith('/admin/settings');
  return (
    <div className="min-h-dvh bg-stone-50">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-stone-200 bg-white md:flex">
        <Sidebar />
      </aside>

      {/* phone top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-stone-200 bg-white/95 px-2 backdrop-blur md:hidden">
        <button className="btn-ghost btn-icon" aria-label="Open menu" aria-expanded={drawer} onClick={() => setDrawer(true)}>
          <Icon name="menu" size={22} />
        </button>
        <span className="min-w-0 flex-1 truncate font-semibold text-stone-900">{titleFor(loc.pathname)}</span>
        {property.status === 'closed' && <span className="mr-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Form closed</span>}
      </header>

      {/* phone drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-stone-900/40" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[85%] max-w-xs bg-white shadow-xl">
            <Sidebar onClose={() => setDrawer(false)} />
          </div>
        </div>
      )}

      <main className="px-3 pb-24 pt-4 sm:px-4 md:ml-64 md:px-8 md:pb-10 md:pt-6">
        <div className="mx-auto max-w-6xl">
          <ErrorBoundary key={loc.pathname}>
            <Suspense fallback={<Spinner />}>
              <Routes>
                <Route index element={<Board />} />
                <Route path="leads/:id" element={<LeadDetail />} />
                <Route path="form" element={<FormBuilder />} />
                <Route path="profiles" element={<Profiles />} />
                <Route path="funnel" element={<Funnel />} />
                <Route path="settings" element={<Navigate to="/admin/settings/property" replace />} />
                <Route path="settings/:section" element={<Settings />} />
                <Route path="audit" element={<Audit />} />
                <Route path="admins" element={<Admins />} />
                <Route path="*" element={<Navigate to="/admin" replace />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>

      {/* phone bottom tabs */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-stone-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Quick">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `flex h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${isActive || (t.to === '/admin/settings' && inSettings) ? 'text-brand-700' : 'text-stone-500'}`
            }
          >
            <Icon name={t.icon} size={22} />
            {t.label}
          </NavLink>
        ))}
        <button className="flex h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-stone-500" onClick={() => setDrawer(true)}>
          <Icon name="more" size={22} />
          More
        </button>
      </nav>
    </div>
  );
}

function Sidebar({ onClose }: { onClose?: () => void }) {
  const { me, property, properties, setPropertyId } = useAdmin();
  const loc = useLocation();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsed);
  const toggle = (id: string) =>
    setCollapsed((c) => {
      const next = { ...c, [id]: !c[id] };
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      } catch {
        /* private mode */
      }
      return next;
    });
  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center gap-3 border-b border-stone-200 px-4 py-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-700 text-white">
          <Icon name="store" size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight text-stone-900">Lead Screener</p>
          {properties.length > 1 ? (
            <select className="mt-0.5 w-full truncate border-0 bg-transparent p-0 text-xs text-stone-500 focus:ring-0" aria-label="Property" value={property.id} onChange={(e) => setPropertyId(e.target.value)}>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="truncate text-xs text-stone-500">{property.name}</p>
          )}
        </div>
        {onClose && (
          <button className="btn-ghost btn-icon -mr-2" aria-label="Close menu" onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
        )}
      </div>
      {property.status === 'closed' && (
        <p className="mx-3 mt-3 flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-800">
          <Icon name="alert" size={16} />
          The form is closed to new people
        </p>
      )}
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Main">
        {NAV.map((g) => {
          const items = g.items.filter((n) => !n.ownerOnly || me.role === 'owner');
          if (!items.length) return null;
          if (g.collapsible) {
            const c = g.collapsible;
            const inside = loc.pathname.startsWith(c.base);
            const open = inside || !collapsed[c.id];
            return (
              <div key={g.heading}>
                <button
                  className={`flex h-10 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium ${inside ? 'text-brand-800' : 'text-stone-700 hover:bg-stone-100'}`}
                  aria-expanded={open}
                  aria-controls={`nav-${c.id}`}
                  onClick={() => !inside && toggle(c.id)}
                >
                  <Icon name={c.icon} />
                  <span className="flex-1 text-left">{c.label}</span>
                  <Icon name="down" size={16} className={`text-stone-400 transition-transform ${open ? '' : '-rotate-90'}`} />
                </button>
                {open && (
                  <div id={`nav-${c.id}`} className="ml-5 mt-1 space-y-0.5 border-l border-stone-200 pl-3">
                    {items.map((n) => (
                      <NavItem key={n.to} {...n} sub />
                    ))}
                  </div>
                )}
              </div>
            );
          }
          return (
            <div key={g.heading}>
              <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-stone-400">{g.heading}</p>
              <div className="space-y-0.5">
                {items.map((n) => (
                  <NavItem key={n.to} {...n} />
                ))}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-stone-200 p-3">
        <div className="flex items-center gap-3 px-2 py-1">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold uppercase text-brand-800">{me.email.slice(0, 1)}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-stone-800">{me.email}</p>
            <p className="text-xs capitalize text-stone-500">{me.role}</p>
          </div>
          <button className="btn-ghost btn-icon" onClick={() => supabase.auth.signOut()} aria-label="Sign out" title="Sign out">
            <Icon name="logout" />
          </button>
        </div>
      </div>
    </div>
  );
}

function NavItem({ to, label, end, icon, sub }: NavLeaf & { sub?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-xl px-3 text-sm font-medium transition ${sub ? 'h-9' : 'h-10'} ${
          isActive ? 'bg-brand-50 text-brand-800' : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
        }`
      }
    >
      <Icon name={icon} size={sub ? 16 : 18} />
      {label}
    </NavLink>
  );
}
