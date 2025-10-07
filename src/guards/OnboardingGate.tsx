import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function OnboardingGate({ children }: { children: JSX.Element }) {
  const [loading, setLoading] = useState(true);
  const [needsOnboarding, setNeeds] = useState<boolean>(false);
  const loc = useLocation();

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setNeeds(false); setLoading(false); return; }
      const { data: profile } = await supabase
        .from("profiles")
        .select("user_id,name")
        .eq("user_id", user.id)
        .single();
      const need = !profile || !profile.name || profile.name.trim() === "";
      if (!mounted) return;
      setNeeds(need);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  if (loading) return null;
  if (needsOnboarding && loc.pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }
  return children;
}