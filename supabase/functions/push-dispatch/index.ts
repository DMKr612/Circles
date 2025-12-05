import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const webhook = Deno.env.get("PUSH_WEBHOOK");

const supabase = createClient(url, serviceKey);

type Payload = {
  userIds: string[];
  type: string;
  payload?: Record<string, unknown>;
};

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  if (!body?.userIds?.length || !body.type) {
    return new Response("Missing userIds or type", { status: 400 });
  }

  await supabase.from("notifications").insert(
    body.userIds.map((uid) => ({
      user_id: uid,
      kind: body.type,
      payload: body.payload ?? {},
      is_read: false,
    }))
  );

  if (webhook) {
    try {
      await fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      // ignore push send failures for now
    }
  }

  return new Response(JSON.stringify({ delivered: body.userIds.length }), {
    headers: { "content-type": "application/json" },
  });
});
