
import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { supabase } from '@/lib/supabase';

export default function RequireAuth({ children }: React.PropsWithChildren): JSX.Element | null {
  const [ready, setReady] = useState(false);
  const [ok, setOk] = useState(false);
  const loc = useLocation();

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!alive) return;
      setOk(!!data.user);
      setReady(true);
    })();
    return () => { alive = false; };
  }, []);

  if (!ready) return null; // small loading gap
  return ok ? <>{children}</> : (
    <Navigate to="/onboarding" state={{ from: loc.pathname }} replace />
  );
}