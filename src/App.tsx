// src/App.tsx
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
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
import { Home, Search, PlusSquare, User as UserIcon, HelpCircle } from "lucide-react"; // Modern icons
import Layout from "@/components/Layout";


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
const NotificationsPage = lazy(() => import("./pages/Notifications"));
const Chats = lazy(() => import("./pages/Chats"));
const Legal = lazy(() => import("./pages/Legal"));
const AuthCallback = lazy(() => import("./pages/AuthCallback"));

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
export function useAuth() {
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
   Bottom Nav (Modern & Stylish)
   ========================= */
function BottomNav() {
  const { user } = useAuth();
  const location = useLocation();
  const onOnboarding = location.pathname.startsWith("/onboarding");

  // Hide on onboarding, and when not authenticated
  if (!user || onOnboarding) return null;

  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[60] border-t border-neutral-200 bg-white/90 backdrop-blur-md pb-[env(safe-area-inset-bottom)]">
      <nav className="flex h-16 items-center justify-around px-6">
        <Link
          to="/browse"
          onMouseEnter={() => prefetchRoute("/browse")}
          className={`group flex flex-col items-center justify-center gap-1 transition-all duration-200 ${
            isActive("/browse") ? "text-black" : "text-neutral-400 hover:text-neutral-600"
          }`}
          aria-label="Browse"
        >
          <Search
            strokeWidth={isActive("/browse") ? 2.8 : 2}
            className={`h-7 w-7 transition-transform duration-200 ${isActive("/browse") ? "scale-110" : "group-hover:scale-105"}`}
          />
        </Link>
        
        <Link
          to="/create"
          onMouseEnter={() => prefetchRoute("/create")}
          className={`group flex flex-col items-center justify-center gap-1 transition-all duration-200 ${
            isActive("/create") ? "text-black" : "text-neutral-400 hover:text-neutral-600"
          }`}
          aria-label="Create"
        >
          <PlusSquare
            strokeWidth={isActive("/create") ? 2.8 : 2}
             className={`h-7 w-7 transition-transform duration-200 ${isActive("/create") ? "scale-110" : "group-hover:scale-105"}`}
          />
        </Link>

        <Link
          to="/profile"
          onMouseEnter={() => prefetchRoute("/profile")}
           className={`group flex flex-col items-center justify-center gap-1 transition-all duration-200 ${
            isActive("/profile") ? "text-black" : "text-neutral-400 hover:text-neutral-600"
          }`}
          aria-label="Profile"
        >
           <UserIcon
             strokeWidth={isActive("/profile") ? 2.8 : 2}
             className={`h-7 w-7 transition-transform duration-200 ${isActive("/profile") ? "scale-110" : "group-hover:scale-105"}`}
           />
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

  // Disable browser scroll restoration
  useEffect(() => {
    try {
      if ('scrollRestoration' in history) {
        (history as any).scrollRestoration = 'manual';
      }
    } catch {}
  }, []);

  const loc = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc.pathname, loc.search]);

  return (
    // Added 'pb-20' to ensure content clears the bottom nav
    <div id="page-root" className="min-h-dvh flow-root flex flex-col">
      <AuthProvider>
          {/* Support Button - Styled cleaner */}
          <button
            onClick={() => window.open("mailto:support@yourdomain.com?subject=Help%20with%20Circles%20App", "_blank")}
            className="fixed top-4 right-4 z-50 grid h-10 w-10 place-items-center rounded-full bg-white text-neutral-600 shadow-md ring-1 ring-black/5 transition-transform hover:scale-105 hover:text-black"
            title="Support"
            aria-label="Support"
          >
            <HelpCircle className="h-6 w-6" />
          </button>

          
          <AppErrorBoundary>
            <Suspense
              fallback={
                <div className="grid min-h-dvh place-items-center text-sm text-neutral-600">
                  Loading…
                </div>
              }
            >
              <Routes>
                <Route path="/" element={<Navigate to="/browse" replace />} />
                <Route path="/onboarding" element={<Onboarding />} />
                <Route path="/legal" element={<Legal />} />
                <Route path="/invite/:code" element={<JoinByCode />} />
                <Route path="/auth/callback" element={<AuthCallback />} />

                <Route element={<RequireAuth><Layout /></RequireAuth>}>
                  <Route path="/browse" element={<BrowsePage />} />
                  <Route path="/groups" element={<Groups />} />
                  <Route path="/notifications" element={<NotificationsPage />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/profile/:userId" element={<Profile />} />
                  <Route path="/create" element={<CreateGroup />} />
                  <Route path="/group/:id" element={<GroupDetail />} />
                  <Route path="/groups/game/:game" element={<GroupsByGame />} />
                  <Route path="/groups/mine" element={<MyGroups />} />
                  <Route path="/chats" element={<Chats />} />
                </Route>

                <Route path="/groups/:id" element={<GroupRedirect />} />
                <Route path="*" element={<Navigate to="/onboarding" replace />} />
              </Routes>
            </Suspense>
          </AppErrorBoundary>
      </AuthProvider>
    </div>
  );
}
