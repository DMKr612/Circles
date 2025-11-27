import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useNavigate } from "react-router-dom";

export default function NotificationsPage() {
  const navigate = useNavigate();

  const [uid, setUid] = useState<string | null>(null);
  const [incomingRequests, setIncomingRequests] = useState<any[]>([]);
  const [groupInvites, setGroupInvites] = useState<any[]>([]);
  const [groupNotifs, setGroupNotifs] = useState<any[]>([]);
  const [activePolls, setActivePolls] = useState<any[]>([]);
  const [newMembers, setNewMembers] = useState<any[]>([]);
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

      const { data: incoming } = await supabase
        .from("friendships")
        .select("id,user_id_a,user_id_b,status,requested_by, profiles!friendships_user_id_a_fkey(name,avatar_url)")
        .eq("user_id_b", myUid)
        .eq("status", "pending");
      setIncomingRequests(incoming ?? []);

      const { data: inv } = await supabase
        .from("group_members")
        .select("group_id, role, status, created_at, groups(title)")
        .eq("user_id", myUid)
        .in("status", ["pending", "invited"])
        .order("created_at", { ascending: false });
      setGroupInvites(inv ?? []);

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
          .order("created_at", { ascending: false })
          .limit(10);
        setGroupNotifs(msgs ?? []);

        const { data: polls } = await supabase
          .from("group_polls")
          .select("id, title, group_id, groups(title)")
          .in("group_id", gIds)
          .eq("status", "open");
        setActivePolls(polls ?? []);

        const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        const { data: members } = await supabase
          .from("group_members")
          .select("group_id, user_id, created_at, groups(title), profiles(name)")
          .in("group_id", gIds)
          .neq("user_id", myUid)
          .gt("created_at", twoDaysAgo)
          .order("created_at", { ascending: false });
        setNewMembers(members ?? []);
      }

      // Deduplicate polls by id (in case of duplicates)
      const uniquePollsMap = new Map<string, any>();
      (activePolls ?? []).forEach(poll => {
        if (!uniquePollsMap.has(poll.id)) {
          uniquePollsMap.set(poll.id, poll);
        }
      });
      const uniquePolls = Array.from(uniquePollsMap.values());
      setActivePolls(uniquePolls);

      setLoading(false);
    }
    load();
  }, []);

  const handleAcceptFriend = async (id: string, fromId: string) => {
    await supabase.rpc("accept_friend", { from_id: fromId });
    setIncomingRequests(prev => prev.filter(r => r.id !== id));
  };

  const handleGroupInvite = async (gid: string, action: "accept" | "decline") => {
    if (!uid) return;
    if (action === "accept") {
      await supabase.from("group_members").update({ status: "active" }).eq("group_id", gid).eq("user_id", uid);
    } else {
      await supabase.from("group_members").delete().eq("group_id", gid).eq("user_id", uid);
    }
    setGroupInvites(prev => prev.filter(i => i.group_id !== gid));
  };

  if (loading) return <div className="pt-24 p-6 text-neutral-500 text-center">Loading updates...</div>;

  // Build unified events list
  const now = Date.now();
  const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

  type EventItem = {
    id: string;
    type: string;
    created_at: string;
    content: JSX.Element;
  };

  const events: EventItem[] = [];

  incomingRequests.forEach(r => {
    events.push({
      id: `friend_${r.id}`,
      type: "friend_request",
      created_at: r.created_at || new Date().toISOString(),
      content: (
        <div className="p-3 border border-neutral-200 rounded-xl bg-white shadow-sm flex items-center justify-between">
          <div className="font-medium text-neutral-900">{r.profiles?.name ?? "Unknown User"}</div>
          <div className="flex gap-2">
            <button onClick={() => handleAcceptFriend(r.id, r.user_id_a)} className="bg-emerald-600 text-white px-3 py-1.5 text-xs font-bold rounded-full shadow-sm">Accept</button>
          </div>
        </div>
      )
    });
  });

  groupInvites.forEach(gi => {
    events.push({
      id: `group_invite_${gi.group_id}`,
      type: "group_invite",
      created_at: gi.created_at || new Date().toISOString(),
      content: (
        <div className="p-3 border border-neutral-200 rounded-xl bg-white shadow-sm flex items-center justify-between">
          <div>
            <div className="font-medium text-neutral-900">{gi.groups?.title || "Untitled Group"}</div>
            <div className="text-[10px] text-neutral-500">You were invited</div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => handleGroupInvite(gi.group_id, "accept")} className="bg-emerald-600 text-white px-3 py-1.5 text-xs font-bold rounded-full shadow-sm">Join</button>
            <button onClick={() => handleGroupInvite(gi.group_id, "decline")} className="text-neutral-500 border px-3 py-1.5 text-xs font-bold rounded-full">Decline</button>
          </div>
        </div>
      )
    });
  });

  activePolls.forEach(poll => {
    events.push({
      id: `poll_${poll.id}`,
      type: "poll",
      created_at: poll.created_at || new Date().toISOString(),
      content: (
        <div className="p-3 border border-blue-100 bg-blue-50/50 rounded-xl flex items-center justify-between">
          <div>
            <div className="font-bold text-blue-900 text-sm">{poll.title}</div>
            <div className="text-[10px] text-blue-600">in {poll.groups?.title}</div>
          </div>
          <button onClick={() => navigate(`/group/${poll.group_id}`)} className="text-white bg-blue-600 px-3 py-1.5 text-xs font-bold rounded-full">Vote</button>
        </div>
      )
    });
  });

  newMembers.forEach((m, i) => {
    events.push({
      id: `new_member_${i}_${m.group_id}_${m.user_id}`,
      type: "new_member",
      created_at: m.created_at,
      content: (
        <div className="p-3 border border-neutral-100 bg-white rounded-xl flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold">
            {(m.profiles?.name || "?").slice(0, 1)}
          </div>
          <div>
            <div className="text-sm text-neutral-900">
              <span className="font-bold">{m.profiles?.name || "Someone"}</span> joined <span className="font-bold">{m.groups?.title}</span>
            </div>
            <div className="text-[10px] text-neutral-400">{new Date(m.created_at).toLocaleDateString()}</div>
          </div>
        </div>
      )
    });
  });

  groupNotifs.forEach((n, i) => {
    events.push({
      id: `group_msg_${i}_${n.group_id}`,
      type: "group_message",
      created_at: n.created_at,
      content: (
        <div onClick={() => navigate(`/group/${n.group_id}`)} className="p-3 border border-neutral-200 rounded-xl bg-white shadow-sm active:scale-[0.99] transition-transform cursor-pointer">
          <div className="flex justify-between items-start mb-1">
            <div className="font-bold text-sm text-neutral-900">{n.groups?.title}</div>
            <div className="text-[10px] text-neutral-400">
              {new Date(n.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
          <div className="text-xs text-neutral-600 line-clamp-1">{n.body}</div>
        </div>
      )
    });
  });

  // Sort events by created_at descending
  events.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // Split events into recent (<24h) and older (>24h)
  const recentEvents = events.filter(e => new Date(e.created_at).getTime() >= twentyFourHoursAgo);
  const olderEvents = events.filter(e => new Date(e.created_at).getTime() < twentyFourHoursAgo);

  const isEmpty = events.length === 0;

  return (
    <div className="max-w-xl mx-auto pt-20 p-4 pb-24 space-y-6">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold text-neutral-900">Activity</h1>
      </div>

      {isEmpty && (
        <div className="py-10 text-center text-neutral-500">
          <div className="text-4xl mb-2">💤</div>
          <p>All caught up! No new activity.</p>
        </div>
      )}

      {recentEvents.length > 0 && (
        <section>
          <h2 className="text-xs font-bold text-neutral-400 uppercase tracking-wide mb-2">Recent</h2>
          <div className="space-y-2">
            {recentEvents.map(e => (
              <div key={e.id}>{e.content}</div>
            ))}
          </div>
        </section>
      )}

      {olderEvents.length > 0 && (
        <section>
          <h2 className="text-xs font-bold text-neutral-400 uppercase tracking-wide mb-2">Older</h2>
          <div className="space-y-2">
            {olderEvents.map(e => (
              <div key={e.id}>{e.content}</div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}