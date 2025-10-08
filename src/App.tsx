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
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";

// Pages
import BrowsePage from "./pages/Browse";
import CreateGroup from "./pages/CreateGroup";
import GroupDetail from "./pages/GroupDetail";
import Groups from "./pages/Groups";
import Profile from "./pages/Profile";
import GroupsByGame from "./pages/groups/GroupsByGame";
import MyGroups from "./pages/groups/MyGroups";
const Onboarding = lazy(() => import("./pages/Onboarding"));

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
function RequireAuth({ children }: PropsWithChildren) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return null;
  if (!user) return <Navigate to="/onboarding" replace state={{ from: loc }} />;
  return <>{children}</>;
}

/* =========================
   HomeButton
   ========================= */
function HomeButton() {
  return (
    <div className="fixed top-4 left-4 z-50">
      <Link
        to="/onboarding"
        className="flex items-center justify-center h-10 w-10 rounded-full border border-black/10 bg-white/90 text-xl shadow-md hover:bg-black/[0.04]"
        aria-label="Onboarding"
        title="Onboarding"
      >
        🎯
      </Link>
    </div>
  );
}

function FloatingNav() {
  const { user } = useAuth();
  const location = useLocation();
  const onOnboarding = location.pathname.startsWith("/onboarding");

  // Hide on onboarding, and when not authenticated
  if (!user || onOnboarding) return null;

  return (
    <div className="fixed inset-x-0 bottom-4 z-[60] flex items-center justify-center pointer-events-none">
      <nav className="pointer-events-auto flex items-center gap-4 rounded-full border border-black/10 bg-white/90 backdrop-blur px-4 py-2 shadow-lg">
        <Link
          to="/browse"
          className="grid h-12 w-12 place-items-center rounded-full border border-black/10 hover:bg-black/[0.04]"
          aria-label="Browse"
          title="Browse"
        >
          <span className="text-2xl">🔍</span>
        </Link>
        <Link
          to="/"
          className="grid h-12 w-12 place-items-center rounded-full border border-black/10 hover:bg-black/[0.04]"
          aria-label="Home"
          title="Home"
        >
          <span className="text-2xl">🏠</span>
        </Link>
        <Link
          to="/create"
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
  PropsWithChildren,
  { error: unknown }
> {
  constructor(props: PropsWithChildren) {
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
function RootRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return <Navigate to={user ? "/profile" : "/onboarding"} replace />;
}
function GroupRedirect() {
  const { id } = useParams();
  return <Navigate to={`/group/${id}`} replace />;
}

/* =========================
   App
   ========================= */
export default function App() {
  return (
    <AuthProvider>
      <HomeButton />
      <FloatingNav />
      <AppErrorBoundary>
        <Suspense
          fallback={
            <div className="grid min-h-screen place-items-center text-sm text-neutral-600">
              Loading…
            </div>
          }
        >
          <Routes>
            {/* Root: go to profile if logged in, else onboarding */}
            <Route path="/" element={<RootRoute />} />

            {/* Public */}
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/browse" element={<BrowsePage />} />
            <Route path="/groups" element={<Groups />} />

            {/* Protected */}
            <Route
              path="/profile"
              element={
                <RequireAuth>
                  <Profile />
                </RequireAuth>
              }
            />
            <Route
              path="/create"
              element={
                <RequireAuth>
                  <CreateGroup />
                </RequireAuth>
              }
            />
            <Route
              path="/group/:id"
              element={
                <RequireAuth>
                  <GroupDetail />
                </RequireAuth>
              }
            />
            <Route
              path="/groups/game/:game"
              element={
                <RequireAuth>
                  <GroupsByGame />
                </RequireAuth>
              }
            />
            <Route
              path="/groups/mine"
              element={
                <RequireAuth>
                  <MyGroups />
                </RequireAuth>
              }
            />

            {/* Legacy redirect */}
            <Route path="/groups/:id" element={<GroupRedirect />} />

            {/* Catch-all */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AppErrorBoundary>
    </AuthProvider>
  );
}