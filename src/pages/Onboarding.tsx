import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { supabase } from "@/lib/supabase";

type Slide = {
  title: string;
  text: string;
  image: string;
};

const SLIDES: Slide[] = [
  {
    title: "Welcome to Circles",
    text: "Create and join micro-groups for games, study, and local meetups.",
    image: `${import.meta.env.BASE_URL}image2.png`,
  },
  {
    title: "Find Your People",
    text: "Match by interests. See active circles. Join in two taps.",
    image: `${import.meta.env.BASE_URL}image3.png`,
  },
  {
    title: "Chat & Organize",
    text: "Lightweight DMs, clean group chats, quick polls and events.",
    image: `${import.meta.env.BASE_URL}image.png`,
  },
  {
    title: "Privacy First",
    text: "You choose what to share. RLS-secured backend powered by Supabase.",
    image: `${import.meta.env.BASE_URL}image4.png`,
  },
  {
    title: "Join Circles Now",
    text: "Sign in to start connecting with others!",
    image: `${import.meta.env.BASE_URL}image5.png`,
  },
];

export default function Onboarding() {
  const [index, setIndex] = useState(0);
  const [imgOk, setImgOk] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [authErr, setAuthErr] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation() as any;
  const prefersReducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setImgOk(null);
  }, [index]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const user = data.user;
      setUserEmail(user?.email ?? null);
      if (user) {
        // Skip onboarding if logged in
        localStorage.setItem("onboardingSeen", "1");
        const ls = localStorage.getItem("postLoginRedirect");
        const fromState = location?.state?.from as string | undefined;
        const dest = ls || fromState || "/profile";
        if (ls) localStorage.removeItem("postLoginRedirect");
        navigate(dest, { replace: true });
      }
    });
  }, [navigate, location]);

  useEffect(() => {
    const sub = supabase.auth.onAuthStateChange((_evt, session) => {
      if (!session?.user) return;
      const ls = localStorage.getItem("postLoginRedirect");
      const fromState = location?.state?.from as string | undefined;
      const dest = ls || fromState || "/profile";
      if (ls) localStorage.removeItem("postLoginRedirect");
      navigate(dest, { replace: true });
    });
    return () => { sub.data.subscription.unsubscribe(); };
  }, [location, navigate]);

  const isLast = index === SLIDES.length - 1;

  const duration = prefersReducedMotion ? 0 : 0.45;
  const transition = useMemo(() => ({ duration, ease: [0.22, 1, 0.36, 1] as any }), [duration]);

  function goto(i: number) {
    if (i < 0 || i >= SLIDES.length) return;
    setIndex(i);
  }

  function next() {
    if (isLast) {
      // stay on the last slide and show auth options instead of navigating away
      setShowEmailForm(true);
    } else {
      setIndex((i) => Math.min(i + 1, SLIDES.length - 1));
    }
  }

  function back() {
    setIndex((i) => Math.max(i - 1, 0));
  }

  // keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") back();
      if (e.key.toLowerCase() === "escape") skip();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function skip() {
    localStorage.setItem("onboardingSeen", "1");
    setIndex(SLIDES.length - 1);
    setShowEmailForm(true);
  }

  // swipe/drag navigation
  const dragThreshold = 90;
  function handleDragEnd(_: any, info: { offset: { x: number } }) {
    const x = info?.offset?.x ?? 0;
    if (x <= -dragThreshold) next();
    else if (x >= dragThreshold) back();
  }

  // segmented progress (0..100)
  const progressPct = ((index + 1) / SLIDES.length) * 100;

  const base = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");
  const redirectTo = `${window.location.origin}${base}/auth/callback`;

  async function loginFacebook() {
    try {
      setAuthErr(null);
      localStorage.setItem("onboardingSeen", "1");
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "facebook",
        options: { redirectTo },
      });
      if (error) throw error;
    } catch (err: any) {
      setAuthErr(err?.message ?? "Failed to start Facebook login");
    }
  }

  async function loginGoogle() {
    try {
      setAuthErr(null);
      localStorage.setItem("onboardingSeen", "1");
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });
      if (error) throw error;
    } catch (err: any) {
      setAuthErr(err?.message ?? "Failed to start Google login");
    }
  }

  async function submitCreds(e: React.FormEvent) {
    e.preventDefault();
    setAuthErr(null);
    if (!email.trim() || !password.trim()) {
      setAuthErr("Enter email and password");
      return;
    }
    try {
      setAuthBusy(true);
      localStorage.setItem("onboardingSeen", "1");
      if (authMode === "signup") {
        const { error } = await supabase.auth.signUp({ email: email.trim(), password: password.trim() });
        if (error) throw error;
        // Do not navigate here; onAuthStateChange will redirect appropriately
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: password.trim() });
        if (error) throw error;
        // Do not navigate here; onAuthStateChange will redirect appropriately
      }
    } catch (err: any) {
      setAuthErr(err?.message ?? "Authentication failed");
    } finally {
      setAuthBusy(false);
    }
  }

  return (
    <div
      ref={containerRef}
      className="min-h-dvh w-full bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white flex flex-col"
      aria-label="Onboarding"
    >


      {/* Slide area */}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={index}
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -60 }}
            transition={transition}
            className="w-full max-w-md"
          >
            <motion.div
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              onDragEnd={handleDragEnd}
              className="text-center select-none"
            >
              {imgOk === false ? (
                <div className="mx-auto mb-6 w-64 h-64 flex items-center justify-center rounded-lg border border-white/40 bg-white/10 text-xs text-white/90 p-3">
                  Missing image:
                  <span className="ml-1 break-all">{SLIDES[index].image}</span>
                </div>
              ) : (
                <img
                  src={SLIDES[index].image}
                  alt={SLIDES[index].title}
                  className="mx-auto mb-6 w-full max-w-[28rem] md:max-w-[32rem] h-auto object-contain drop-shadow-2xl"
                  draggable={false}
                  onLoad={() => setImgOk(true)}
                  onError={(e) => { console.error('Onboarding image failed to load:', SLIDES[index].image); setImgOk(false); }}
                />
              )}
              <h1 className="text-3xl font-extrabold mb-3">{SLIDES[index].title}</h1>
              <p className="text-base/7 opacity-95">{SLIDES[index].text}</p>
              {isLast && (
                <div className="mt-6 w-full max-w-sm mx-auto">
                  {!showEmailForm ? (
                    <>
                      <div className="grid grid-cols-1 gap-3">
                        <button
                          onClick={loginGoogle}
                          className="w-full rounded-lg bg-white/90 px-4 py-3 font-semibold text-indigo-700 hover:bg-white"
                        >
                          Continue with Google
                        </button>
                        <button
                          onClick={() => { setShowEmailForm(true); setAuthErr(null); }}
                          className="w-full rounded-lg bg-white text-indigo-700 px-4 py-3 font-semibold"
                        >
                          Continue with Email
                        </button>
                        <button
                          onClick={loginFacebook}
                          className="w-full rounded-lg bg-[#1877F2] px-4 py-3 font-semibold text-white"
                        >
                          Continue with Facebook
                        </button>
                      </div>

                      <p className="mt-4 text-center text-[10px] text-white/60">
                        By continuing, you agree to our{" "}
                        <Link to="/legal" className="underline hover:text-white">
                          Terms & Privacy Policy
                        </Link>
                        .
                      </p>
                    </>
                  ) : (
                    <form onSubmit={submitCreds} className="grid grid-cols-1 gap-3">
                      <input
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full rounded-lg border border-white/30 bg-white/10 px-3 py-3 text-white placeholder-white/70 outline-none focus:bg-white/15"
                      />
                      <input
                        type="password"
                        placeholder="Password (min 6)"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full rounded-lg border border-white/30 bg-white/10 px-3 py-3 text-white placeholder-white/70 outline-none focus:bg-white/15"
                      />
                      <button
                        type="submit"
                        disabled={authBusy}
                        className={`w-full rounded-lg px-4 py-3 font-semibold ${authBusy ? "bg-white/40" : "bg-white text-indigo-700"}`}
                      >
                        {authBusy ? "Please wait…" : authMode === "signup" ? "Sign up" : "Sign in"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setAuthMode(authMode === "signup" ? "signin" : "signup")}
                        className="text-sm underline opacity-90"
                      >
                        {authMode === "signup" ? "Have an account? Sign in" : "No account? Sign up"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowEmailForm(false)}
                        className="text-xs opacity-75 hover:opacity-100"
                      >
                        ← Back to options
                      </button>
                    </form>
                  )}
                  {authErr && <div className="mt-3 rounded border border-red-200 bg-red-50/90 px-3 py-2 text-sm text-red-800">{authErr}</div>}
                </div>
              )}
            </motion.div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom controls */}
      <div className={`px-6 pb-6 ${isLast && showEmailForm ? "hidden" : ""}` }>
        {/* segmented progress */}
        <div className="mb-5">
          <div className="h-1.5 w-full bg-white/25 rounded-full overflow-hidden">
            <div
              className="h-full bg-white rounded-full transition-all"
              style={{ width: `${progressPct}%` }}
              aria-hidden
            />
          </div>
          <div className="sr-only" role="status" aria-live="polite">
            {Math.round(progressPct)} percent complete
          </div>
        </div>

        <div className="flex items-center justify-between">
          <button
            onClick={back}
            disabled={index === 0}
            className="px-4 py-2 rounded bg-white text-indigo-700 font-semibold disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-white/40"
            aria-label="Previous"
          >
            Back
          </button>

          {/* clickable dots */}
          <div className="flex gap-2">
            {SLIDES.map((_, i) => (
              <button
                key={i}
                aria-label={`Go to slide ${i + 1}`}
                onClick={() => goto(i)}
                className={`w-3 h-3 rounded-full transition-opacity ${i === index ? "bg-white" : "bg-white/50 hover:bg-white/70"}`}
              />
            ))}
          </div>

          <button
            onClick={next}
            className="px-4 py-2 rounded bg-white text-indigo-700 font-semibold focus:outline-none focus:ring-2 focus:ring-white/40"
            aria-label={isLast ? "Login" : "Next"}
          >
            {isLast ? "Login" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
