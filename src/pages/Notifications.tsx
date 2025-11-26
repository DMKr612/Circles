import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useNavigate } from "react-router-dom";

export default function NotificationsPage() {
  const navigate = useNavigate();

  const [uid, setUid] = useState<string | null>(null);
  const [incomingRequests, setIncomingRequests] = useState<any[]>([]);
  const [groupInvites, setGroupInvites] = useState<any[]>([]);
  const [groupNotifs, setGroupNotifs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data: auth } = await supabase.auth.getUser();
      const myUid = auth?.user?.id || null;
      if (!myUid) {
        navigate("/onboarding");
        return;
      }
      setUid(myUid);

      // -------- FRIEND REQUESTS ----------
      const { data: incoming } = await supabase
        .from("friendships")
        .select("id,user_id_a,user_id_b,status,requested_by, profiles!friendships_user_id_a_fkey(name,avatar_url)")
        .eq("user_id_b", myUid)
        .eq("status", "pending");
      setIncomingRequests(incoming ?? []);

      // -------- GROUP INVITES -----------
      const { data: inv } = await supabase
        .from("group_members")
        .select("group_id, role, status, created_at, groups(title)")
        .eq("user_id", myUid)
        .in("status", ["pending", "invited"])
        .order("created_at", { ascending: false });
      setGroupInvites(inv ?? []);

      // -------- GROUP MESSAGE NOTIFICATIONS -------
      const { data: gm } = await supabase
        .from("group_members")
        .select("group_id")
        .eq("user_id", myUid)
        .eq("status", "active");

      const gIds = gm?.map((r: any) => r.group_id) || [];

      if (gIds.length > 0) {
        const { data: msgs } = await supabase
          .from("group_messages")
          .select("group_id, body, created_at, groups(title), user_id")
          .in("group_id", gIds)
          .neq("user_id", myUid)
          .order("created_at", { ascending: false });
        setGroupNotifs(msgs ?? []);
      }

      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <div className="p-6 text-neutral-600">Loading…</div>;

  return (
    <div className="max-w-xl mx-auto pt-20 p-4 space-y-6">
      {/* Back Button */}
      <button
        onClick={() => navigate("/profile")}
        className="mb-4 inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1.5 text-sm hover:bg-black/[0.04]"
      >
        ← Back
      </button>
      <h1 className="text-xl font-semibold mb-4">Notifications</h1>

      {/* FRIEND REQUESTS */}
      <section>
        <h2 className="text-base font-semibold text-neutral-800 mb-3">Friend Requests</h2>
        {incomingRequests.length === 0 ? (
          <div className="text-sm text-neutral-600">No new requests.</div>
        ) : (
          incomingRequests.map((r) => (
            <div key={r.id} className="p-4 border rounded-xl bg-white shadow-sm flex items-center justify-between mb-3">
              <div>
                <div className="font-medium">{r.profiles?.name ?? r.user_id_a.slice(0,6)}</div>
              </div>
              <div className="flex gap-2">
                <button className="bg-emerald-600 text-white px-3 rounded">Accept</button>
                <button className="border px-3 rounded">Decline</button>
              </div>
            </div>
          ))
        )}
      </section>

      {/* GROUP INVITES */}
      <section>
        <h2 className="text-base font-semibold text-neutral-800 mb-3">Group Invites</h2>
        {groupInvites.length === 0 ? (
          <div className="text-sm text-neutral-600">No group invitations.</div>
        ) : (
          groupInvites.map((gi) => (
            <div key={gi.group_id} className="p-4 border rounded-xl bg-white shadow-sm flex items-center justify-between mb-3">
              <div>
                <div className="font-medium">{gi.groups?.title}</div>
                <div className="text-xs text-neutral-500">Status: {gi.status}</div>
              </div>
              <div className="flex gap-2">
                <button className="bg-emerald-600 text-white px-3 rounded">Accept</button>
                <button className="border px-3 rounded">Decline</button>
              </div>
            </div>
          ))
        )}
      </section>

      {/* GROUP MESSAGES */}
      <section>
        <h2 className="text-base font-semibold text-neutral-800 mb-3">Group Messages</h2>
        {groupNotifs.length === 0 ? (
          <div className="text-sm text-neutral-600">No unread messages.</div>
        ) : (
          groupNotifs.map((n) => (
            <div key={n.created_at} className="p-4 border rounded-xl bg-white shadow-sm flex items-center justify-between mb-3">
              <div>
                <div className="font-medium">{n.groups?.title}</div>
                <div className="text-xs text-neutral-500">{n.body.slice(0,60)}</div>
              </div>
              <button
                onClick={() => navigate(`/group/${n.group_id}`)}
                className="text-emerald-700 text-sm"
              >
                Open
              </button>
            </div>
          ))
        )}
      </section>
    </div>
  );
}