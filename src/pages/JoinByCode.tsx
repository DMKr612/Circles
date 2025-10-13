import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function JoinByCode() {
  const { code } = useParams<{ code: string }>();
  const nav = useNavigate();
  const [msg, setMsg] = useState("Joining…");

  useEffect(() => {
    (async () => {
      if (!code) { setMsg("Invalid link"); return; }

      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) {
        localStorage.setItem("postLoginRedirect", `/invite/${code}`);
        window.location.href = `${window.location.origin}/onboarding`;
        return;
      }

      const { data: gid, error } = await supabase.rpc("join_via_code", { p_code: code });
      if (error) { setMsg(error.message); return; }

      nav(`/group/${gid}`, { replace: true });
    })();
  }, [code]);

  return (
    <div className="mx-auto max-w-md p-6 text-sm text-neutral-700">{msg}</div>
  );
}