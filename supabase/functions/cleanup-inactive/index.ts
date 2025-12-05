import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const pushWebhook = Deno.env.get("PUSH_WEBHOOK");

const supabase = createClient(url, serviceKey);

serve(async () => {
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: stale, error } = await supabase
    .from("groups")
    .select("id, host_id, title, updated_at")
    .lt("updated_at", cutoff);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (stale?.length) {
    await supabase.from("notifications").insert(
      stale.map((g) => ({
        user_id: g.host_id,
        kind: "group_expiring",
        payload: { group_id: g.id, title: g.title, updated_at: g.updated_at },
      }))
    );

    if (pushWebhook) {
      try {
        await fetch(pushWebhook, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "group_expiring", groups: stale }),
        });
      } catch {
        // ignore push errors for now
      }
    }

    await supabase.from("groups").delete().lt("updated_at", cutoff);
  }

  return new Response(JSON.stringify({ deleted: stale?.length ?? 0 }), {
    headers: { "content-type": "application/json" },
  });
});
