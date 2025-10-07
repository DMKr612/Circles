import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function RequireAuth({ children }: { children: JSX.Element }) {
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const loc = useLocation();

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!mounted) return;
      setAuthed(!!data.user);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  if (loading) return null; // prevents flash + wrong redirect
  if (!authed) return <Navigate to="/login" replace state={{ from: loc }} />;
  return children;
}