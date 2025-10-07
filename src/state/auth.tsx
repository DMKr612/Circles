import React, { createContext, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

type Profile = { name?: string | null; user_id: string } | null;

type AuthState = {
  user: User | null;
  profile: Profile;
  loading: boolean;
};

const AuthCtx = createContext<AuthState>({ user: null, profile: null, loading: true });

export function AuthProvider({ children }: React.PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!mounted) return;
      const u = data?.user ?? null;
      setUser(u);

      if (u) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("user_id,name")
          .eq("user_id", u.id)
          .maybeSingle();
        if (!mounted) return;
        setProfile(prof ?? null);
      } else {
        setProfile(null);
      }
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        supabase
          .from("profiles")
          .select("user_id,name")
          .eq("user_id", u.id)
          .maybeSingle()
          .then(({ data }) => setProfile(data ?? null));
      } else {
        setProfile(null);
      }
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  return (
    <AuthCtx.Provider value={{ user, profile, loading }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  return useContext(AuthCtx);
}