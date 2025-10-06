import React, { useEffect, useState, type FormEvent, lazy, Suspense } from "react";
import type { PropsWithChildren } from "react";
import { Routes, Route, Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
// Onboarding will be lazy-loaded below
import Create from "./pages/CreateGroup";
import BrowsePage from "./pages/Browse";
import GroupDetail from "./pages/GroupDetail";
import Profile from "./pages/Profile";
import GroupsByGame from "./pages/groups/GroupsByGame";
import MyGroups from "./pages/groups/MyGroups";

const Onboarding = lazy(() => import("./pages/Onboarding"));



/** Small hook to read the current auth user and keep it in sync */
function useAuthUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!isMounted) return;
      setUser(data.user);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setUser(s?.user ?? null);
    });
    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return { user, loading };
}

function Header() {
  const { user } = useAuthUser();
  return (
    <header className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b border-black/5">
      <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
        <Link to="/onboarding" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-emerald-700 text-white font-bold">c</span>
          <span className="text-xl font-semibold tracking-tight">Circles</span>
        </Link>
        <nav className="flex items-center gap-3">
          <Link
            to="/browse"
            className="hidden sm:inline-flex rounded-md px-3 py-2 text-sm border border-black/10 hover:bg-black/[0.04]"
          >
            Browse
          </Link>
          {user && (
            <>
              <Link
                to="/create"
                className="hidden sm:inline-flex rounded-md px-3 py-2 text-sm border border-black/10 hover:bg-black/[0.04]"
              >
                Create
              </Link>
              <Link
                to="/profile"
                className="hidden sm:inline-flex rounded-md px-3 py-2 text-sm border border-black/10 hover:bg-black/[0.04]"
              >
                Profile
              </Link>
            </>
          )}
          {!user ? (
            <>
              <Link
                to="/#auth"
                className="rounded-md px-3 py-2 text-sm border border-black/10 hover:bg-black/[0.04]"
              >
                Sign In
              </Link>
              <Link
                to="/#auth"
                className="rounded-md px-3 py-2 text-sm text-white bg-emerald-700 hover:brightness-110"
              >
                Sign Up
              </Link>
            </>
          ) : (
            <Link to="/profile" className="text-xs text-neutral-700 hover:text-neutral-900 underline-offset-2 hover:underline">
              {user.email}
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

/** RequireAuth: only render children if logged in, else send to /browse */
function RequireAuth({ children }: PropsWithChildren) {
  const { user, loading } = useAuthUser();
  if (loading) return null;
  if (!user) return <Navigate to="/browse" replace />;
  return <>{children}</>;
}

/**
 * RequireProfile: if logged in but profile is incomplete (no name),
 * redirect to /profile (unless we're already there).
 */
function RequireProfile({ children }: PropsWithChildren) {
  const { user, loading } = useAuthUser();
  const [checking, setChecking] = useState(true);
  const [ok, setOk] = useState(false);
  const location = useLocation();
  const nav = useNavigate();

  useEffect(() => {
    (async () => {
      if (loading) return;
      if (!user) { setChecking(false); setOk(false); return; }
      const { data, error } = await supabase
        .from("profiles")
        .select("name")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        // If the table isn't ready yet, allow navigation so the app isn't stuck.
        setOk(true);
      } else if (!data?.name) {
        // If profile incomplete, force user to Profile page unless already there.
        if (location.pathname !== "/profile") {
          nav("/profile", { replace: true });
          return;
        }
        setOk(true);
      } else {
        setOk(true);
      }
      setChecking(false);
    })();
  }, [loading, user, location.pathname, nav]);

  if (loading || checking) return null;
  if (!user) return <Navigate to="/browse" replace />;
  if (!ok) return null;
  return <>{children}</>;
}

function OnboardingGate({ children }: PropsWithChildren) {
  const location = useLocation();
  const seen = typeof window !== "undefined" && localStorage.getItem("onboardingSeen") === "1";
  if (!seen && location.pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }
  return <>{children}</>;
}

function Home() {
  const { user, loading } = useAuthUser();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => {
    if (loc.hash === "#auth") setShowForm(true);
  }, [loc.hash]);
  console.log("ENV URL:", import.meta.env.VITE_SUPABASE_URL);

  async function doSignUp(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    const res = await supabase.auth.signUp({ email, password }); // password >= 6
    console.log("SIGNUP RESULT:", res);
    if (res.error) {
      setMsg(res.error.message); // show precise reason
    } else {
      nav("/onboarding");
    }
  }

  async function doSignIn(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setMsg(error.message);
    else nav("/browse");
  }

  async function doSignOut() {
    await supabase.auth.signOut();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="relative w-24 h-24">
          <div className="absolute inset-0 animate-ping-slow">
            <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
              <circle cx="84" cy="100" r="64" fill="#2EA6FF" />
            </svg>
          </div>
          <div className="absolute inset-0 animate-ping-delay">
            <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
              <circle cx="116" cy="100" r="64" fill="#7C3AED" />
            </svg>
          </div>
        </div>
        <style>{`
          @keyframes pingScale {
            0%, 100% { transform: scale(1); opacity: 0.8; }
            50% { transform: scale(0.6); opacity: 0.5; }
          }
          .animate-ping-slow {
            animation: pingScale 2s infinite ease-in-out;
          }
          .animate-ping-delay {
            animation: pingScale 2s infinite ease-in-out;
            animation-delay: 1s;
          }
        `}</style>
      </div>
    );
  }


  return (
    <main className="min-h-[calc(100vh-56px)] bg-neutral-50">
      <section className="mx-auto max-w-6xl px-4 py-20 sm:py-24 text-center">
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-neutral-900">
          Connect. Play. Compete.
        </h1>
        <p className="mt-4 text-base sm:text-lg text-neutral-600 max-w-2xl mx-auto">
          Join gaming circles in your city, create groups for your favorite games,
          and connect with players who share your passion.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          {!user ? (
            <>
              <button
                onClick={() => setShowForm(true)}
                className="rounded-md bg-emerald-700 px-5 py-2.5 text-white font-medium hover:brightness-110"
              >
                Get Started
              </button>
              <Link
                to="/browse"
                className="rounded-md border border-black/10 bg-white px-5 py-2.5 font-medium hover:bg-black/[0.04]"
              >
                Explore Platform
              </Link>
            </>
          ) : (
            <>
              <Link
                to="/browse"
                className="rounded-md bg-emerald-700 px-5 py-2.5 text-white font-medium hover:brightness-110"
              >
                Go to Dashboard
              </Link>
              <button
                onClick={doSignOut}
                className="rounded-md border border-black/10 bg-white px-5 py-2.5 font-medium hover:bg-black/[0.04]"
              >
                Sign Out
              </button>
            </>
          )}
        </div>
      </section>

      {/* Feature cards */}
      <section className="mx-auto max-w-6xl px-4 pb-20">
        <div className="grid gap-6 sm:grid-cols-3">
          <div className="rounded-xl border border-black/10 bg-white shadow-sm px-6 py-8 text-center">
            <div className="mx-auto mb-4 grid h-10 w-10 place-items-center rounded-md bg-emerald-100 text-lg">🧑‍🤝‍🧑</div>
            <h3 className="font-semibold text-neutral-900">Create Groups</h3>
            <p className="mt-2 text-sm text-neutral-600">Start gaming groups for your favorite games and invite players to join your circle.</p>
          </div>
          <div className="rounded-xl border border-black/10 bg-white shadow-sm px-6 py-8 text-center">
            <div className="mx-auto mb-4 grid h-10 w-10 place-items-center rounded-md bg-emerald-100 text-lg">📍</div>
            <h3 className="font-semibold text-neutral-900">Find Local Players</h3>
            <p className="mt-2 text-sm text-neutral-600">Discover gamers in your city and connect with players nearby for in-person or online gaming.</p>
          </div>
          <div className="rounded-xl border border-black/10 bg-white shadow-sm px-6 py-8 text-center">
            <div className="mx-auto mb-4 grid h-10 w-10 place-items-center rounded-md bg-emerald-100 text-lg">⭐️</div>
            <h3 className="font-semibold text-neutral-900">Match &amp; Play</h3>
            <p className="mt-2 text-sm text-neutral-600">Get matched with players based on your game preferences, skill level, and location.</p>
          </div>
        </div>
      </section>

      {/* Auth card (modal-like) */}
      {!user && showForm && (
        <div className="fixed inset-0 z-[200] grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-lg border border-black/10 p-6">
            <h2 className="text-xl font-semibold text-neutral-900 text-center">Welcome back</h2>
            <p className="mt-1 text-sm text-neutral-500 text-center">Sign in to your account to continue gaming</p>
            <form className="mt-5 space-y-3" onSubmit={doSignIn}>
              <label className="block">
                <div className="mb-1.5 text-[13px] text-neutral-600">Email</div>
                <input className="w-full rounded-md border border-black/10 bg-white px-3 py-2 text-[15px] outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-300" type="email" placeholder="you@example.com" value={email} onChange={(e)=>setEmail(e.target.value)} required />
              </label>
              <label className="block">
                <div className="mb-1.5 text-[13px] text-neutral-600">Password</div>
                <input className="w-full rounded-md border border-black/10 bg-white px-3 py-2 text-[15px] outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-300" type="password" placeholder="Password (min 6)" value={password} onChange={(e)=>setPassword(e.target.value)} required />
              </label>
              {msg && <div className="text-red-600 text-sm">{msg}</div>}
              <div className="flex gap-2">
                <button onClick={doSignUp} type="button" className="flex-1 rounded-md bg-neutral-900 px-4 py-2.5 text-white text-[15px] font-medium hover:brightness-110">Sign Up</button>
                <button type="submit" className="flex-1 rounded-md bg-emerald-700 px-4 py-2.5 text-white text-[15px] font-medium hover:brightness-110">Sign In</button>
              </div>
              <button type="button" onClick={()=>setShowForm(false)} className="block mx-auto mt-2 text-sm text-neutral-500 hover:text-neutral-700">Close</button>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

function GroupRedirect() {
  const { id } = useParams();
  return <Navigate to={`/group/${id}`} replace />;
}

class AppErrorBoundary extends React.Component<PropsWithChildren, { error: unknown }> {
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

export default function App() {
  return (
    <>
      <Header />
      <AppErrorBoundary>
        <Suspense fallback={<div className="grid min-h-screen place-items-center text-sm text-neutral-600">Loading…</div>}>
          <Routes>
            <Route path="/" element={<Navigate to="/browse" replace />} />
            {/* Onboarding is now publicly accessible */}
            <Route path="/onboarding" element={<Onboarding />} />
            {/* Protected app pages must have onboarding seen and a completed profile */}
            <Route path="/browse" element={<OnboardingGate><RequireProfile><BrowsePage /></RequireProfile></OnboardingGate>} />
            <Route path="/create" element={<OnboardingGate><RequireProfile><Create /></RequireProfile></OnboardingGate>} />
            <Route path="/group/:id" element={<OnboardingGate><RequireProfile><GroupDetail /></RequireProfile></OnboardingGate>} />
            <Route path="/groups/game/:game" element={<OnboardingGate><RequireProfile><GroupsByGame /></RequireProfile></OnboardingGate>} />
            <Route path="/groups/mine" element={<OnboardingGate><RequireProfile><MyGroups /></RequireProfile></OnboardingGate>} />
            <Route path="/profile" element={<OnboardingGate><RequireProfile><Profile /></RequireProfile></OnboardingGate>} />
            <Route path="/groups/:id" element={<GroupRedirect />} />
            <Route path="*" element={<Navigate to="/browse" replace />} />
          </Routes>
        </Suspense>
      </AppErrorBoundary>
    </>
  );
}
