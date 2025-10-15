
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
    try {
      const { data, error } = await supabase.auth.getUser();
      if (!alive) return;
      if (error) console.error('[RequireAuth] getUser error:', error);
      console.log('[RequireAuth]', { path: loc.pathname, user: !!data?.user });
      setOk(!!data?.user);
    } catch (e) {
      console.error('[RequireAuth] exception:', e);
      setOk(false);
    } finally {
      if (alive) setReady(true);
    }
  })();
  return () => { alive = false; };
}, [loc.pathname]);
if (!ready) return <div style={{ textAlign: "center", marginTop: "20%" }}>Loading...</div>;
  return ok ? <>{children}</> : (
    <Navigate to="/onboarding" state={{ from: loc.pathname }} replace />
  );
}