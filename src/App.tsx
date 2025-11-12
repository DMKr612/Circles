// src/App.tsx
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
  type PropsWithChildren,
} from "react";
import {
  Routes,
  Route,
  Link,
  Navigate,
  Outlet,
  useLocation,
  useParams,
} from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";

// Pages (lazy imports)
const BrowsePage = lazy(() => import("./pages/Browse"));
const CreateGroup = lazy(() => import("./pages/CreateGroup"));
const GroupDetail = lazy(() => import("./pages/GroupDetail"));
const Groups = lazy(() => import("./pages/Groups"));
const Profile = lazy(() => import("./pages/Profile"));
const GroupsByGame = lazy(() => import("./pages/groups/GroupsByGame"));
const MyGroups = lazy(() => import("./pages/groups/MyGroups"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const JoinByCode = lazy(() => import("./pages/JoinByCode"));

// ---- Route prefetch helpers (Step 1) ----
const routePrefetchers: Record<string, () => void> = {
  "/onboarding": () => { import("./pages/Onboarding"); },
  "/browse":     () => { import("./pages/Browse"); },
  "/profile":    () => { import("./pages/Profile"); },
  "/create":     () => { import("./pages/CreateGroup"); },
  "/groups":     () => { import("./pages/Groups"); },
  "/groups/mine":() => { import("./pages/groups/MyGroups"); },
};
function prefetchRoute(path: string) {
  try { routePrefetchers[path]?.(); } catch {}
}
// ---- End prefetch helpers ----

/* =========================
   Auth (single source)
   ========================= */
type AuthCtx = { user: User | null; loading: boolean };
const AuthContext = createContext<AuthCtx>({ user: null, loading: true });
function useAuth() {
  return useContext(AuthContext);
}
function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let on = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!on) return;
      setUser(data.user ?? null);
      setLoading(false);
    })();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setUser(s?.user ?? null);
    });
    return () => {
      subscription.unsubscribe();
      on = false;
    };
  }, []);

  const value = useMemo(() => ({ user, loading }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/* =========================
   Guards
   ========================= */
function RequireAuth({ children }: PropsWithChildren): JSX.Element | null {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center text-sm text-neutral-600">
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/onboarding" replace state={{ from: loc.pathname }} />;
  return <>{children}</>;
}

/* =========================
   HomeButton (REMOVED)
   ========================= */
// The HomeButton function that was here (lines 106-119) has been removed.

function FloatingNav() {
  const { user } = useAuth();
  const location = useLocation();
  const onOnboarding = location.pathname.startsWith("/onboarding");

  // Dock visibility: show on scroll or when hovering the middle button; fade out after 3s
  const [dockVisible, setDockVisible] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHideTimer = () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
  const scheduleHide = (ms = 3000) => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => setDockVisible(false), ms);
  };

  useEffect(() => {
    const onScroll = () => {
      setDockVisible(true);
      scheduleHide(3000);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll as any);
      clearHideTimer();
    };
  }, []);

  // Hide on onboarding, and when not authenticated
  if (!user || onOnboarding) return null;

  return (
    <div className={`fixed inset-x-0 bottom-4 z-[60] flex items-center justify-center pointer-events-none transition-opacity duration-300 ${dockVisible ? "opacity-100" : "opacity-0"}`}>
      <nav className="pointer-events-auto flex items-center gap-4 rounded-full border border-black/10 bg-white/90 backdrop-blur px-4 py-2 shadow-lg">
        <Link
          to="/browse"
          onMouseEnter={() => prefetchRoute("/browse")}
          className="grid h-12 w-12 place-items-center rounded-full border border-black/10 hover:bg-black/[0.04]"
          aria-label="Browse"
          title="Browse"
        >
          <span className="text-2xl">🔍</span>
        </Link>
        <Link
          to="/profile"
          onMouseEnter={() => { setDockVisible(true); scheduleHide(3000); }}
          onFocus={() => { setDockVisible(true); scheduleHide(3000); }}
          onMouseLeave={() => { scheduleHide(3000); }}
          onBlur={() => { scheduleHide(3000); }}
          className="grid h-12 w-12 place-items-center rounded-full border border-black/10 hover:bg-black/[0.04]"
          aria-label="Home"
          title="Home"
        >
          <span className="text-2xl">🏠</span>
        </Link>
        <Link
          to="/create"
          onMouseEnter={() => prefetchRoute("/create")}
          className="grid h-12 w-12 place-items-center rounded-full border border-black/10 hover:bg-black/[0.04]"
          aria-label="Create group"
          title="Create group"
        >
          <span className="text-2xl">➕</span>
        </Link>
      </nav>
    </div>
  );
}

/* =========================
   Error Boundary
   ========================= */
class AppErrorBoundary extends React.Component<
  { children?: React.ReactNode },
  { error: unknown }
> {
  constructor(props: { children?: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="grid min-h-screen place-items-center p-6">
          <div className="max-w-md text-center">
            <h1 className="text-2xl font-bold">Something broke</h1>
            <p className="text-sm text-neutral-600 break-words mt-2">
              {String((this.state.error as any)?.message ?? this.state.error)}
            </p>
            <button
              className="mt-4 rounded-md border border-black/10 bg-white px-3 py-2 text-sm hover:bg-black/[0.04]"
              onClick={() => location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children as any;
  }
}

/* =========================
   Root helpers
   ========================= */
// REMOVED the RootRoute function
function GroupRedirect() {
  const { id } = useParams();
  return <Navigate to={`/group/${id}`} replace />;
}

/* =========================
   App
   ========================= */
export default function App() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Disable browser scroll restoration (prevents loading at old offsets)
  useEffect(() => {
    try {
      if ('scrollRestoration' in history) {
        (history as any).scrollRestoration = 'manual';
      }
    } catch {}
  }, []);

  // Always reset scroll to top on route changes
  const loc = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc.pathname, loc.search]);

  return (
    <div id="page-root" className="min-h-dvh flow-root flex flex-col">
      <AuthProvider>
          {/* REMOVED <HomeButton /> */}
          
          {/* --- THIS IS THE SUPPORT BUTTON YOU ASKED FOR --- */}
          <button
            onClick={() => {
              // You can build this out later
              console.log("Support button clicked");
            }}
            className="fixed bottom-4 left-4 z-40 grid h-12 w-12 place-items-center rounded-full border border-black/10 bg-white text-2xl shadow-lg transition-transform hover:scale-105"
            title="Support"
            aria-label="Support"
          >
            <span>❓</span>
          </button>
          {/* --- END OF SUPPORT BUTTON --- */}

          <FloatingNav />
          <AppErrorBoundary>
            <Suspense
              fallback={
                <div className="grid min-h-dvh place-items-center text-sm text-neutral-600">
                  Loading…
                </div>
              }
            >
              <Routes>
                {/* REMOVED the RootRoute path */}

                {/* Public */}
                <Route path="/onboarding" element={<Onboarding />} />
                <Route path="/browse" element={<BrowsePage />} />
                <Route path="/groups" element={<Groups />} />
                <Route path="/invite/:code" element={<JoinByCode />} />

                {/* Protected */}
                <Route element={<RequireAuth><Outlet /></RequireAuth>}>
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/profile/:userId" element={<Profile />} />
                  <Route path="/create" element={<CreateGroup />} />
                  <Route path="/group/:id" element={<GroupDetail />} />
                  <Route path="/groups/game/:game" element={<GroupsByGame />} />
                  <Route path="/groups/mine" element={<MyGroups />} />
                </Route>

                {/* Legacy redirect */}
                <Route path="/groups/:id" element={<GroupRedirect />} />

                {/* Catch-all */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </AppErrorBoundary>
      </AuthProvider>
    </div>
  );
}