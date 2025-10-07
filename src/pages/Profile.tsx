import React, { useEffect, useMemo, useState, useRef } from "react";
import { supabase } from "../lib/supabase";
import { Link } from "react-router-dom";


// Types
type PreviewGroup = { id: string; title: string; game: string | null; category: string | null };
type Thread = {
  other_id: string;
  name: string;
  avatar_url: string | null;
  last_body: string;
  last_at: string;
  last_from_me: boolean;
  unread: boolean;
};
type GameStat = { game: string; count: number };

function timeAgo(iso: string) {
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  const m = Math.floor(diff / 60); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24); return `${days}d`;
}

export default function Profile() {
  // Auth + profile
  const [uid, setUid] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [name, setName] = useState<string>("");
  // Settings modal state
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sName, setSName] = useState<string>("");
  const [sCity, setSCity] = useState<string>("");
  const [sTimezone, setSTimezone] = useState<string>("UTC");
  const [sInterests, setSInterests] = useState<string>("");
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);

  // Stats
  const [groupsCreated, setGroupsCreated] = useState<number>(0);
  // Joined + filter
  const [groupsJoined, setGroupsJoined] = useState<number>(0);
  const [joinedPreview, setJoinedPreview] = useState<PreviewGroup[]>([]);
  const [groupFilter, setGroupFilter] = useState<'created' | 'joined' | 'all'>('created');

  // Games played stats
  const [gamesTotal, setGamesTotal] = useState<number>(0);
  const [gameStats, setGameStats] = useState<GameStat[]>([]);
  const [gamesModalOpen, setGamesModalOpen] = useState(false);
  // Previews
  const [createdPreview, setCreatedPreview] = useState<PreviewGroup[]>([]);


  const visibleGroups = useMemo(() => {
    if (groupFilter === 'created') return createdPreview;
    if (groupFilter === 'joined') return joinedPreview;
    const map = new Map<string, PreviewGroup>();
    for (const g of createdPreview) if (g?.id) map.set(g.id, g);
    for (const g of joinedPreview) if (g?.id && !map.has(g.id)) map.set(g.id, g);
    return Array.from(map.values());
  }, [groupFilter, createdPreview, joinedPreview]);

  const visibleCount = useMemo(() => {
    if (groupFilter === 'created') return groupsCreated;
    if (groupFilter === 'joined') return groupsJoined;
    const ids = new Set<string>();
    createdPreview.forEach(g => g?.id && ids.add(g.id));
    joinedPreview.forEach(g => g?.id && ids.add(g.id));
    return ids.size;
  }, [groupFilter, groupsCreated, groupsJoined, createdPreview, joinedPreview]);

  // UI
  const initials = useMemo(() => (name || email || "?").slice(0, 2).toUpperCase(), [name, email]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Direct (DM) panel state
  const [dmTargetId, setDmTargetId] = useState<string | null>(null);
  const [dmLoading, setDmLoading] = useState(false);
  const [dmError, setDmError] = useState<string | null>(null);
  const [dmMsgs, setDmMsgs] = useState<Array<{ id: string; from_id: string; to_id: string; body: string; created_at: string }>>([]);
  const [dmInput, setDmInput] = useState("");
  const dmEndRef = useRef<HTMLDivElement | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadQuery, setThreadQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  // Sidebar open/close + notifications popover
const [sidebarOpen, setSidebarOpen] = useState(true);
const sidebarRef = useRef<HTMLDivElement | null>(null);
const [notifOpen, setNotifOpen] = useState(false);
const notifRef = useRef<HTMLDivElement | null>(null);

  // Friends + requests
  type FriendShipRow = {
    id: string;
    user_id_a: string;
    user_id_b: string;
    status: 'pending' | 'accepted' | 'blocked';
    requested_by: string;
  };
  const [friends, setFriends] = useState<FriendShipRow[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<FriendShipRow[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendShipRow[]>([]);
  // Profiles for accepted friends (used in right sidebar search)
  const [friendProfiles, setFriendProfiles] =
    useState<Map<string, { name: string; avatar_url: string | null }>>(new Map());

  // Merge DM threads with accepted friends for sidebar
  const sidebarItems = useMemo<Thread[]>(() => {
    const tMap = new Map<string, Thread>();
    threads.forEach(t => tMap.set(t.other_id, t));
    if (!uid) return threads;

    const out: Thread[] = [...threads];
    const friendIds = friends.map(f => (f.user_id_a === uid ? f.user_id_b : f.user_id_a));

    friendIds.forEach(fid => {
      if (tMap.has(fid)) return; // already in thread list
      const prof = friendProfiles.get(fid);
      out.push({
        other_id: fid,
        name: (prof?.name && prof.name.trim()) ? prof.name : fid.slice(0, 6),
        avatar_url: prof?.avatar_url ?? null,
        last_body: '',
        last_at: new Date(0).toISOString(),
        last_from_me: false,
        unread: false,
      });
    });

    out.sort((a, b) => (b.last_at > a.last_at ? 1 : (b.last_at < a.last_at ? -1 : 0)));
    return out;
  }, [threads, friends, friendProfiles, uid]);

  // Build friend options (accepted friends) for autocomplete
  const friendOptions = useMemo(() => {
    if (!uid) return [] as Array<{ id: string; name: string; avatar_url: string | null }>;
    const ids = friends.map(f => (f.user_id_a === uid ? f.user_id_b : f.user_id_a));
    return ids.map(id => ({
      id,
      name: friendProfiles.get(id)?.name || id.slice(0, 6),
      avatar_url: friendProfiles.get(id)?.avatar_url ?? null,
    }));
  }, [friends, friendProfiles, uid]);

  // View other profile modal
  const [viewOpen, setViewOpen] = useState(false);
  const [viewUserId, setViewUserId] = useState<string | null>(null);
  const [viewName, setViewName] = useState<string>("");
  const [viewAvatar, setViewAvatar] = useState<string | null>(null);
 const [viewFriendStatus, setViewFriendStatus] =
   useState<'none'|'pending_in'|'pending_out'|'accepted'|'blocked'>('none');


  useEffect(() => {
    dmEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [dmMsgs.length]);

  // Close sidebar / notifications when clicking outside
useEffect(() => {
  function onDown(e: MouseEvent) {
    const t = e.target as Node;

    // notifications popover
    if (notifOpen) {
      if (notifRef.current && !notifRef.current.contains(t)) {
        setNotifOpen(false);
      }
    }
    // sidebar collapse
    if (sidebarOpen) {
      if (sidebarRef.current && !sidebarRef.current.contains(t)) {
        setSidebarOpen(false);
      }
    }
  }
  document.addEventListener('mousedown', onDown);
  return () => document.removeEventListener('mousedown', onDown);
}, [notifOpen, sidebarOpen]);

  async function openThread(otherId: string) {
    if (!uid) return;
    setShowSuggestions(false);
    setDmError(null);
    setDmLoading(true);
    setDmMsgs([]);
    setDmTargetId(otherId);
    const { data: msgs } = await supabase
      .from("direct_messages")
      .select("id,from_id,to_id,body,created_at")
      .or(`and(from_id.eq.${uid},to_id.eq.${otherId}),and(from_id.eq.${otherId},to_id.eq.${uid})`)
      .order("created_at", { ascending: true })
      .limit(200);
    setDmMsgs(msgs ?? []);
    setDmLoading(false);
  }

  async function refreshFriendData(userId: string) {
    const { data: fr } = await supabase
      .from("friendships")
      .select("id,user_id_a,user_id_b,status,requested_by")
      .or(`user_id_a.eq.${userId},user_id_b.eq.${userId}`)
      .eq("status", "accepted");
    setFriends((fr ?? []) as any);

    const { data: incoming } = await supabase
      .from("friendships")
      .select("id,user_id_a,user_id_b,status,requested_by")
      .or(`user_id_a.eq.${userId},user_id_b.eq.${userId}`)
      .eq("status", "pending")
      .neq("requested_by", userId);
    setIncomingRequests((incoming ?? []) as any);

    const { data: outgoing } = await supabase
      .from("friendships")
      .select("id,user_id_a,user_id_b,status,requested_by")
      .eq("requested_by", userId)
      .eq("status", "pending");
    setOutgoingRequests((outgoing ?? []) as any);
  }

  async function openProfileView(otherId: string) {
    if (!uid) return;
    setViewUserId(otherId);

    const { data: prof } = await supabase
      .from("profiles")
      .select("user_id,name,avatar_url")
      .eq("user_id", otherId)
      .maybeSingle();
    setViewName((prof as any)?.name ?? otherId.slice(0,6));
    setViewAvatar((prof as any)?.avatar_url ?? null);

    const { data: rel } = await supabase
      .from("friendships")
      .select("id,user_id_a,user_id_b,status,requested_by")
      .or(`and(user_id_a.eq.${uid},user_id_b.eq.${otherId}),and(user_id_a.eq.${otherId},user_id_b.eq.${uid})`)
      .limit(1)
      .maybeSingle();

    let st: 'none'|'pending_in'|'pending_out'|'accepted'|'blocked' = 'none';
    if (rel) {
      if (rel.status === 'accepted') st = 'accepted';
      else if (rel.status === 'blocked') st = 'blocked';
      else if (rel.status === 'pending') {
        st = rel.requested_by === uid ? 'pending_out' : 'pending_in';
      }
    }
    setViewFriendStatus(st);
    setViewOpen(true);
  }

  async function sendFriendRequest(targetId: string) {
    await supabase.rpc("request_friend", { target_id: targetId });
    if (uid) await refreshFriendData(uid);
    setViewFriendStatus('pending_out');
  }

  async function acceptFriend(fromId: string) {
    await supabase.rpc("accept_friend", { from_id: fromId });
    if (uid) await refreshFriendData(uid);
    if (viewUserId === fromId) setViewFriendStatus('accepted');
  }

  async function removeFriend(otherId: string) {
    await supabase.rpc("remove_friend", { other_id: otherId });
    if (uid) await refreshFriendData(uid);
    if (viewUserId === otherId) setViewFriendStatus('none');
  }

  // Resolve display for current DM target
  const dmDisplay = useMemo(() => {
    if (!dmTargetId) return { name: "", avatar: null as string | null };
    const t = sidebarItems.find(x => x.other_id === dmTargetId);
    if (t) return { name: t.name, avatar: t.avatar_url };
    const p = friendProfiles.get(dmTargetId);
    return { name: p?.name || dmTargetId.slice(0,6), avatar: p?.avatar_url ?? null };
  }, [dmTargetId, sidebarItems, friendProfiles]);

  // Settings modal helpers
  async function openSettings() {
    if (!uid) return;
    setSettingsMsg(null);
    // load current profile fieldsƒ
    const { data: p, error } = await supabase
      .from("profiles")
      .select("name, city, timezone, interests")
      .eq("user_id", uid)
      .maybeSingle();
    if (error) { setSettingsMsg(error.message); setSettingsOpen(true); return; }
    setSName((p as any)?.name ?? "");
    setSCity((p as any)?.city ?? "");
    setSTimezone((p as any)?.timezone ?? "UTC");
    const ints = Array.isArray((p as any)?.interests) ? ((p as any).interests as string[]) : [];
    setSInterests(ints.join(", "));
    setSettingsOpen(true);
  }

  async function saveSettings(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!uid) return;
    setSettingsMsg(null);
    setSettingsSaving(true);
    try {
      // sanitize
      const name = sName.trim();
      const city = sCity.trim();
      const timezone = sTimezone.trim() || "UTC";
      const interests = sInterests.split(",").map(s => s.trim()).filter(Boolean);

      const { error } = await supabase
        .from("profiles")
        .update({ name, city, timezone, interests })
        .eq("user_id", uid);

      if (error) throw error;
      setName(name);
      setSettingsMsg("Saved.");
      setSettingsOpen(false);
    } catch (err: any) {
      setSettingsMsg(err?.message || "Failed to save");
    } finally {
      setSettingsSaving(false);
    }
  }

  // Logout function
  async function logout() {
    try {
      await supabase.auth.signOut();
      localStorage.removeItem("onboardingSeen");
      window.location.href = `${window.location.origin}/onboarding`;
    } catch (error) {
      console.error("Logout failed:", error);
      window.location.href = `${window.location.origin}/onboarding`;
    }
  }
  // Load friend profiles via RPC (uses auth.uid() on the server)
useEffect(() => {
  (async () => {
    if (!uid) { setFriendProfiles(new Map()); return; }
    const { data, error } = await supabase.rpc('get_my_friend_profiles');
    if (error) { setFriendProfiles(new Map()); return; }
    const m = new Map<string, { name: string; avatar_url: string | null }>();
    (data ?? []).forEach((p: any) => {
      m.set(p.user_id, { name: p.name ?? '', avatar_url: p.avatar_url ?? null });
    });
    setFriendProfiles(m);
  })();
}, [uid, friends.length]);

  // Load auth + profile + stats + previews
  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      setErr(null);
      const { data: auth } = await supabase.auth.getUser();
      const _uid = auth?.user?.id || null;
      const _email = auth?.user?.email || null;
      if (!_uid) { setLoading(false); setErr("Please sign in."); return; }
      if (off) return;
      setUid(_uid); setEmail(_email);

      // ESSENTIAL: profile + counts in parallel
      const [profResp, createdCountResp, joinedCountResp] = await Promise.all([
        supabase
          .from("profiles")
          .select("name, city, timezone, interests")
          .eq("user_id", _uid)
          .maybeSingle(),
        supabase
          .from("group_members")
          .select("*", { count: "exact", head: true })
          .eq("user_id", _uid)
          .eq("status", "active")
          .in("role", ["owner", "host"]),
        supabase
          .from("group_members")
          .select("*", { count: "exact", head: true })
          .eq("user_id", _uid)
          .eq("status", "active"),
      ]);

      if (!off) {
        const prof: any = profResp.data || {};
        setName(prof?.name ?? "");
        setSCity(prof?.city ?? "");
        setSTimezone(prof?.timezone ?? "UTC");
        const ints0 = Array.isArray(prof?.interests) ? (prof.interests as string[]) : [];
        setSInterests(ints0.join(", "));

        setGroupsCreated((createdCountResp.count as number | null) ?? 0);
        setGroupsJoined((joinedCountResp.count as number | null) ?? 0);

        // Allow the page to render now
        setLoading(false);
      }

      // NON-BLOCKING: heavy queries in background
      (async () => {
        // created previews (latest 5): membership role owner/host
        const { data: createdMemberships, error: cmErr } = await supabase
          .from("group_members")
          .select("group_id, created_at")
          .eq("user_id", _uid)
          .eq("status", "active")
          .in("role", ["owner", "host"])
          .order("created_at", { ascending: false })
          .limit(20);
        if (!off && cmErr) console.warn('createdMemberships error', cmErr);
        const createdIds = Array.from(new Set((createdMemberships ?? []).map((r: any) => r.group_id))).filter(Boolean);
        let createdGroups: any[] = [];
        if (createdIds.length) {
          const { data: cg } = await supabase
            .from("groups")
            .select("id,title,game,category,created_at")
            .in("id", createdIds)
            .order("created_at", { ascending: false })
            .limit(20);
          createdGroups = cg ?? [];
        }
        if (!off) {
          const seenC = new Set<string>();
          const uniqueC = createdGroups.filter((g: any) => g?.id && !seenC.has(g.id) && seenC.add(g.id)).slice(0, 5);
          setCreatedPreview(uniqueC as PreviewGroup[]);
        }

        // joined preview (latest joined groups) — any active membership
        const { data: joinedMemberships, error: jmErr } = await supabase
          .from("group_members")
          .select("group_id, created_at")
          .eq("user_id", _uid)
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(20);
        if (!off && jmErr) console.warn('joinedMemberships error', jmErr);
        const joinedIds = Array.from(new Set((joinedMemberships ?? []).map((r: any) => r.group_id))).filter(Boolean);
        let joinedGroups: any[] = [];
        if (joinedIds.length) {
          const { data: jg } = await supabase
            .from("groups")
            .select("id,title,game,category,created_at")
            .in("id", joinedIds)
            .order("created_at", { ascending: false })
            .limit(20);
          joinedGroups = jg ?? [];
        }
        if (!off) {
          const seenJ = new Set<string>();
          const uniqueJ = joinedGroups.filter((g: any) => g?.id && !seenJ.has(g.id) && seenJ.add(g.id)).slice(0, 5);
          setJoinedPreview(uniqueJ as PreviewGroup[]);
        }

        // games played: aggregate group_members by groups.game for this user
        const { data: gmRows } = await supabase
         .from("group_members")
         .select("group_id, groups(game)")
         .eq("user_id", _uid);

        if (!off) {
          const counts = new Map<string, number>();
          (gmRows ?? []).forEach((r: any) => {
          const gname = (r?.groups?.game || "Unknown") as string;
          counts.set(gname, (counts.get(gname) || 0) + 1);
        });
        const arr: GameStat[] = Array.from(counts.entries()).map(([game, count]) => ({ game, count }));
        arr.sort((a, b) => b.count - a.count || a.game.localeCompare(b.game));
        setGameStats(arr);
        setGamesTotal((gmRows ?? []).length);
      }

        // threads: latest 100 to reduce payload, then hydrate names
        const { data: recent } = await supabase
          .from("direct_messages")
          .select("id,from_id,to_id,body,created_at")
          .or(`from_id.eq.${_uid},to_id.eq.${_uid}`)
          .order("created_at", { ascending: false })
          .limit(100);
        const map = new Map<string, { last_body: string; last_at: string; last_from_me: boolean }>();
        (recent ?? []).forEach((m: any) => {
          const other = m.from_id === _uid ? m.to_id : m.from_id;
          if (!map.has(other)) {
            map.set(other, { last_body: m.body, last_at: m.created_at, last_from_me: m.from_id === _uid });
          }
        });
        const otherIds = Array.from(map.keys());
        let profMap = new Map<string, { name: string; avatar_url: string | null }>();
        if (otherIds.length) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("user_id,name,avatar_url")
            .in("user_id", otherIds);
          (profs ?? []).forEach((p: any) => {
            profMap.set(p.user_id, { name: p.name ?? "", avatar_url: p.avatar_url ?? null });
          });
        }
        const threadList: Thread[] = otherIds.map((oid) => {
          const meta = map.get(oid)!;
          const prof = profMap.get(oid) || { name: "", avatar_url: null };
          return {
            other_id: oid,
            name: prof.name || oid.slice(0, 6),
            avatar_url: prof.avatar_url ?? null,
            last_body: meta.last_body,
            last_at: meta.last_at,
            last_from_me: meta.last_from_me,
            unread: !meta.last_from_me,
          };
        });
        if (!off) setThreads(threadList);

        if (!off) await refreshFriendData(_uid);
      })();
    })();
    return () => { off = true; };
  }, []);

  async function sendDm() {
    if (!uid || !dmTargetId || !dmInput.trim()) return;
    const body = dmInput.trim();
    setDmInput("");
    const { data, error } = await supabase
      .from("direct_messages")
      .insert({ from_id: uid, to_id: dmTargetId, body })
      .select("id,from_id,to_id,body,created_at")
      .single();
    if (error) { setDmError(error.message); return; }
    setDmMsgs((prev) => [...prev, data!]);
  }

  if (loading) return (
    <div className="mx-auto max-w-4xl px-4 py-8 text-sm text-neutral-600">Loading…</div>
  );
  if (err) return (
    <div className="mx-auto max-w-4xl px-4 py-8 text-sm text-red-600">{err}</div>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
      {/* Header */}
      <div className="mb-6 flex items-center gap-4">
        <div className="grid h-16 w-16 place-content-center rounded-full bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300/60">
          <span className="text-2xl font-semibold tracking-wide">{initials}</span>
        </div>
        <div className="flex-1">
          <div className="text-lg font-semibold text-neutral-900">{name || email}</div>
          <div className="text-sm text-neutral-600">{email}</div>
                    <div className="mt-2 flex items-center gap-2">
            <Link to="/browse?created=1" className="rounded-md border border-black/10 bg-white px-3 py-1.5 text-sm hover:bg-black/[0.04]">Created</Link>
            <div ref={notifRef} className="relative">
  <button
    onClick={() => setNotifOpen(v => !v)}
    className="ml-2 inline-flex items-center gap-2 rounded-md border border-black/10 bg-white px-2 py-1.5 text-sm hover:bg-black/[0.04]"
  >
    <span>Notifications</span>
    <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-white text-xs">{incomingRequests.length}</span>
  </button>
  {notifOpen && (
    <div className="absolute right-0 z-50 mt-1 w-80 rounded-md border border-black/10 bg-white p-2 shadow-xl">
      <div className="mb-1 text-xs font-medium text-neutral-700">Recent activity</div>
      <ul className="max-h-64 overflow-y-auto divide-y">
        {/* Friend requests */}
        {incomingRequests.length > 0 && (
          <li className="py-2">
            <div className="mb-1 text-sm font-medium text-neutral-900">Friend requests</div>
            <ul className="space-y-1">
              {incomingRequests.slice(0, 5).map(r => {
                const other = r.user_id_a === uid ? r.user_id_b : r.user_id_a;
                const nm = friendProfiles.get(other)?.name || other.slice(0,6);
                return (
                  <li key={r.id} className="flex items-center justify-between">
                    <span className="text-sm text-neutral-800">{nm}</span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => acceptFriend(other)} className="rounded border border-black/10 px-2 py-0.5 text-xs">Accept</button>
                      <button onClick={() => removeFriend(other)} className="rounded border border-black/10 px-2 py-0.5 text-xs">Decline</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </li>
        )}
        {/* Recent messages (received) */}
        {threads.filter(t => !t.last_from_me).slice(0,5).map(t => (
          <li key={t.other_id} className="flex items-center justify-between py-2">
            <div className="min-w-0 pr-2">
              <div className="truncate text-sm font-medium text-neutral-900">{t.name}</div>
              <div className="truncate text-xs text-neutral-600">{t.last_body}</div>
            </div>
            <button onClick={() => openThread(t.other_id)} className="shrink-0 rounded-md border border-black/10 px-2 py-0.5 text-xs">Open</button>
          </li>
        ))}
        {incomingRequests.length === 0 && threads.filter(t => !t.last_from_me).length === 0 && (
          <li className="py-2 text-xs text-neutral-600">Nothing new</li>
        )}
      </ul>
    </div>
  )}
</div>
            <button
              onClick={openSettings}
              className="ml-2 rounded-md border border-black/10 bg-white px-3 py-1.5 text-sm hover:bg-black/[0.04]"
            >
              Settings
            </button>
            <Link
              to="/create"
              className="ml-2 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Create Groups
            </Link>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Groups Created" value={groupsCreated} to="/browse?created=1" />
        <StatCard label="Games Played" value={gamesTotal} onClick={() => setGamesModalOpen(true)} />
      </div>
            {incomingRequests.length > 0 && (
        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-base font-medium text-neutral-900">Friend Requests</h3>
            <span className="text-xs text-neutral-600">{incomingRequests.length}</span>
          </div>
          <ul className="divide-y">
            {incomingRequests.map((r) => {
              const other = r.user_id_a === uid ? r.user_id_b : r.user_id_a;
              return (
                <li key={r.id} className="flex items-center justify-between py-2">
                  <div className="text-sm text-neutral-800">{other}</div>
                  <div className="flex items-center gap-2">
                <button
                  onClick={() => acceptFriend(other)}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white"
                >
                  Accept
                </button>
                <button
                  onClick={() => removeFriend(other)}
                  className="rounded-md border border-black/10 bg-white px-3 py-1.5 text-sm"
                >
                  Decline
                </button>
              </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Groups + Friends side-by-side */}
      <section className="mt-8 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-neutral-600">Show:</span>
          <div className="inline-flex rounded-lg border border-black/10 bg-white p-0.5">
            <button
              onClick={() => setGroupFilter('created')}
              className={`px-3 py-1.5 text-sm rounded-md ${groupFilter === 'created' ? 'bg-neutral-900 text-white' : 'hover:bg-black/[0.04]'}`}
            >
              Created
            </button>
            <button
              onClick={() => setGroupFilter('joined')}
              className={`px-3 py-1.5 text-sm rounded-md ${groupFilter === 'joined' ? 'bg-neutral-900 text-white' : 'hover:bg-black/[0.04]'}`}
            >
              Joined
            </button>
            <button
              onClick={() => setGroupFilter('all')}
              className={`px-3 py-1.5 text-sm rounded-md ${groupFilter === 'all' ? 'bg-neutral-900 text-white' : 'hover:bg-black/[0.04]'}`}
            >
              All
            </button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card
            title={
              groupFilter === 'created' ? 'Created by me' : groupFilter === 'joined' ? 'Joined' : 'All my groups'
            }
            count={visibleCount}
            empty="No groups yet."
          >
            {visibleGroups.map((g) => {
              const gid = (g as any)?.id
                ?? (g as any)?.group_id
                ?? (g as any)?.group?.id
                ?? (g as any)?.groups?.id;
              if (!gid) return null;
              return (
                <Row
                  key={gid}
                  id={gid}
                  title={g.title}
                  meta={[g.category || '–', g.game || ''].filter(Boolean).join(' · ')}
                />
              );
            })}
          </Card>

          <Card title="Friends" count={sidebarItems.length} empty="No friends yet.">
            {sidebarItems.map((t) => (
              <FriendRow
                key={t.other_id}
                _otherId={t.other_id}
                name={t.name}
                avatarUrl={t.avatar_url}
                lastBody={t.last_body}
                lastAt={t.last_at}
                unread={t.unread}
                onOpen={() => openThread(t.other_id)}
                onView={() => openProfileView(t.other_id)}
              />
            ))}
          </Card>
        </div>
      </section>
        </div>
        {sidebarOpen && (
          <aside ref={sidebarRef} className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm h-max sticky top-4">
          {/* If no active chat: show search + conversations list */}
          {!dmTargetId && (
            <>
              <div className="mb-3 relative">
                <input
                  value={threadQuery}
                  onChange={(e) => { setThreadQuery(e.target.value); setShowSuggestions(true); }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 120)}
                  placeholder="Search friends…"
                  className="w-full rounded-md border border-black/10 px-3 py-2 text-sm"
                />
                {showSuggestions && threadQuery.trim().length > 0 && (
                  <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-black/10 bg-white shadow">
                    <ul>
                      {friendOptions
                        .filter(o => o.name.toLowerCase().includes(threadQuery.toLowerCase()))
                        .slice(0, 8)
                        .map(o => (
                          <li key={o.id} className="flex items-center justify-between gap-2 px-2 py-2 hover:bg-black/[0.03]">
                            <div className="flex items-center gap-3">
                              <div className="h-8 w-8 rounded-full bg-neutral-200 grid place-items-center text-[11px] font-medium overflow-hidden">
                                {o.avatar_url ? (
                                  <img src={o.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                                ) : (
                                  o.name.slice(0,2).toUpperCase()
                                )}
                              </div>
                              <div className="text-sm text-neutral-900">{o.name}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => { setThreadQuery(""); openThread(o.id); }}
                                className="rounded-md border border-black/10 bg-white px-2 py-1 text-xs hover:bg-black/[0.04]"
                              >
                                Chat
                              </button>
                              <button
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => { setThreadQuery(""); openProfileView(o.id); }}
                                className="rounded-md bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700"
                              >
                                View
                              </button>
                            </div>
                          </li>
                        ))}
                      {friendOptions.filter(o => o.name.toLowerCase().includes(threadQuery.toLowerCase())).length === 0 && (
                        <li className="px-2 py-2 text-xs text-neutral-600">No matches</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>

              <div className="max-h-[70vh] overflow-y-auto">
                <ul>
                  {sidebarItems
                    .filter(t => t.name.toLowerCase().includes(threadQuery.toLowerCase()))
                    .map((t) => (
                      <li key={t.other_id} className="flex items-center justify-between gap-2 px-1 py-2 hover:bg-black/[0.03] rounded cursor-pointer" onClick={() => openThread(t.other_id)}>
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-neutral-200 grid place-items-center text-sm font-medium overflow-hidden">
                            {t.avatar_url ? (<img src={t.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" />) : (t.name.slice(0,2).toUpperCase())}
                          </div>
                          <div>
                            <div className="text-sm font-medium text-neutral-900">{t.name}</div>
                            <div className="text-xs text-neutral-600 truncate max-w-[180px]">{t.last_from_me ? "You: " : ""}{t.last_body}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-neutral-500">{timeAgo(t.last_at)}</span>
                          {t.unread && <span className="h-2 w-2 rounded-full bg-emerald-600" />}
                        </div>
                      </li>
                    ))}
                  {sidebarItems.length === 0 && (
                    <li className="px-1 py-2 text-xs text-neutral-600">No conversations yet.</li>
                  )}
                </ul>
              </div>
            </>
          )}

          {/* If in a chat: WhatsApp-like view with header + messages + composer */}
          {dmTargetId && (
            <div className="flex h-[70vh] flex-col">
              {/* Chat header */}
              <div className="mb-2 flex items-center gap-3 border-b border-black/10 pb-2">
                <button onClick={() => setDmTargetId(null)} className="rounded-md border border-black/10 px-2 py-1 text-sm">Back</button>
                <div className="h-9 w-9 rounded-full bg-neutral-200 grid place-items-center text-xs font-medium overflow-hidden">
                  {dmDisplay.avatar ? (
                    <img src={dmDisplay.avatar} alt="" className="h-9 w-9 rounded-full object-cover" />
                  ) : (
                    dmDisplay.name.slice(0,2).toUpperCase()
                  )}
                </div>
                <div>
                  <div className="text-sm font-medium text-neutral-900">{dmDisplay.name}</div>
                  <div className="text-[11px] text-neutral-500">Direct message</div>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto rounded-md border border-black/10 p-3 text-sm">
                {dmLoading && <div className="text-neutral-600">Loading…</div>}
                {dmError && <div className="mb-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-red-700">{dmError}</div>}
                {!dmLoading && dmMsgs.length === 0 && (
                  <div className="text-neutral-600">Say hi 👋</div>
                )}
                {!dmLoading && dmMsgs.map((m) => (
                  <div key={m.id} className={`mb-2 flex ${m.from_id === uid ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-lg px-3 py-1.5 ${m.from_id === uid ? "bg-emerald-600 text-white" : "bg-neutral-100"}`}>
                      {m.body}
                    </div>
                  </div>
                ))}
                <div ref={dmEndRef} />
              </div>

              {/* Composer */}
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={dmInput}
                  onChange={(e) => setDmInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") sendDm(); }}
                  placeholder="Type a message…"
                  className="w-full rounded-md border border-black/10 px-3 py-2 text-sm"
                />
                <button onClick={sendDm} className="rounded-md bg-emerald-600 px-3 py-2 text-sm text-white">Send</button>
              </div>
            </div>
          )}
          </aside>
        )}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="fixed bottom-4 right-4 z-40 rounded-full border border-black/10 bg-white px-4 py-2 text-sm shadow hover:bg-black/[0.04]"
          >
            Open Chat
          </button>
        )}
      </div>
      {/* Games Played modal */}
{gamesModalOpen && (
  <div className="fixed inset-0 z-50 grid place-items-center bg-black/40">
    <div className="w-[560px] max-w-[92vw] rounded-2xl border border-black/10 bg-white p-5 shadow-xl">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-base font-semibold text-neutral-900">Games Played</div>
        <button
          type="button"
          onClick={() => setGamesModalOpen(false)}
          className="rounded-md border border-black/10 px-2 py-1 text-sm"
        >
          Close
        </button>
      </div>
      <div className="mb-2 text-sm text-neutral-700">
        Total sessions joined: <span className="font-medium text-neutral-900">{gamesTotal}</span>
      </div>
      <div className="max-h-[60vh] overflow-y-auto">
        {gameStats.length === 0 ? (
          <div className="text-sm text-neutral-600">No games yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-500">
                <th className="py-1 pr-2">Game</th>
                <th className="py-1 pr-2">Times</th>
                <th className="py-1 pr-2">Share</th>
              </tr>
            </thead>
            <tbody>
              {gameStats.map((g) => {
                const pct = gamesTotal > 0 ? Math.round((g.count / gamesTotal) * 100) : 0;
                return (
                  <tr key={g.game} className="border-t border-black/5">
                    <td className="py-1 pr-2 text-neutral-900">{g.game}</td>
                    <td className="py-1 pr-2">{g.count}</td>
                    <td className="py-1 pr-2 text-neutral-600">{pct}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  </div>
)}
    {/* Settings modal */}
    {settingsOpen && (
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/40">
        <form
          onSubmit={saveSettings}
          className="w-[560px] max-w-[92vw] rounded-2xl border border-black/10 bg-white p-5 shadow-xl"
        >
          <div className="mb-4 flex items-center justify-between">
            <div className="text-base font-semibold text-neutral-900">Edit Profile</div>
            <button
              type="button"
              onClick={() => setSettingsOpen(false)}
              className="rounded-md border border-black/10 px-2 py-1 text-sm"
            >
              Close
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-800">Name</label>
              <input
                value={sName}
                onChange={(e) => setSName(e.target.value)}
                className="w-full rounded-md border border-black/10 px-3 py-2 text-sm"
                placeholder="Your name"
                required
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-800">City</label>
              <input
                value={sCity}
                onChange={(e) => setSCity(e.target.value)}
                className="w-full rounded-md border border-black/10 px-3 py-2 text-sm"
                placeholder="City"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-800">Timezone</label>
              <input
                value={sTimezone}
                onChange={(e) => setSTimezone(e.target.value)}
                className="w-full rounded-md border border-black/10 px-3 py-2 text-sm"
                placeholder="e.g., Europe/Berlin"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-800">Interests</label>
              <input
                value={sInterests}
                onChange={(e) => setSInterests(e.target.value)}
                className="w-full rounded-md border border-black/10 px-3 py-2 text-sm"
                placeholder="comma, separated, tags"
              />
              <div className="mt-1 text-[11px] text-neutral-500">Saved as tags in your profile.</div>
            </div>
          </div>

          {settingsMsg && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {settingsMsg}
            </div>
          )}

          <div className="mt-4 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={logout}
              className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-sm text-red-700"
            >
              Log out
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded-md border border-black/10 bg-white px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={settingsSaving}
                className={`rounded-md px-3 py-1.5 text-sm text-white ${settingsSaving ? "bg-neutral-400" : "bg-emerald-600 hover:bg-emerald-700"}`}
              >
                {settingsSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </form>
      </div>
    )}
    {/* View Other Profile modal */}
    {viewOpen && (
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/40">
        <div className="w-[560px] max-w-[92vw] rounded-2xl border border-black/10 bg-white p-5 shadow-xl">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-neutral-200 grid place-items-center overflow-hidden">
                {viewAvatar ? (
                  <img src={viewAvatar} alt="" className="h-12 w-12 rounded-full object-cover" />
                ) : (
                  <span className="text-sm font-medium">{(viewName || '').slice(0,2).toUpperCase()}</span>
                )}
              </div>
              <div>
                <div className="text-base font-semibold text-neutral-900">{viewName}</div>
                <div className="text-xs text-neutral-600">{viewUserId}</div>
              </div>
            </div>
            <button onClick={() => setViewOpen(false)} className="rounded-md border border-black/10 px-2 py-1 text-sm">Close</button>
          </div>

          <div className="space-y-3">
            <div className="rounded-md border border-black/10 p-3 text-sm">
              <div className="mb-2 font-medium text-neutral-800">Friend status</div>
              {viewFriendStatus === 'accepted' && <div className="text-emerald-700">Friends</div>}
              {viewFriendStatus === 'pending_in' && (
                <div className="flex items-center gap-2">
                  <span className="text-neutral-700">Requested you</span>
                  <button
                    onClick={() => viewUserId && acceptFriend(viewUserId)}
                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white"
                  >Accept</button>
                </div>
              )}
              {viewFriendStatus === 'pending_out' && <div className="text-neutral-700">Request sent</div>}
              {viewFriendStatus === 'none' && viewUserId && (
                <button
                  onClick={() => sendFriendRequest(viewUserId)}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white"
                >Add Friend</button>
              )}
              {viewFriendStatus === 'accepted' && viewUserId && (
                <button
                  onClick={() => removeFriend(viewUserId)}
                  className="ml-2 rounded-md border border-black/10 px-3 py-1.5 text-sm"
                >Remove</button>
              )}
            </div>
          </div>
        </div>
      </div>
    )}
    </div>
  );
}

function StatCard({ label, value, to, onClick }: { label: string; value: number; to?: string; onClick?: () => void }) {
  const inner = (
    <>
      <div className="text-sm text-neutral-600">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-neutral-900">{value}</div>
    </>
  );
  if (to) {
    return (
      <Link to={to} className="rounded-xl border border-black/10 bg-white p-4 shadow-sm hover:shadow">
        {inner}
      </Link>
    );
  }
  return (
    <button onClick={onClick} className="w-full rounded-xl border border-black/10 bg-white p-4 text-left shadow-sm hover:shadow">
      {inner}
    </button>
  );
}

function Card({ title, count, empty, children }: { title: string; count: number; empty: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-base font-medium text-neutral-900">{title}</h3>
        <span className="text-xs text-neutral-600">{count}</span>
      </div>
      {React.Children.count(children) === 0 ? (
        <p className="text-sm text-neutral-600">{empty}</p>
      ) : (
        <ul className="divide-y">
          {children}
        </ul>
      )}
    </div>
  );
}

function Row({ id, title, meta }: { id: string; title: string; meta: string }) {
  return (
    <li className="flex items-center justify-between py-2">
      <div>
        <Link to={`/group/${id}`} className="font-medium text-neutral-900 hover:underline">{title}</Link>
        <div className="text-xs text-neutral-600">{meta}</div>
        <div className="text-[10px] text-neutral-400">id:{String(id).slice(0,8)}</div>
      </div>
      <Link to={`/group/${id}`} className="text-sm text-emerald-700 hover:underline">Open</Link>
    </li>
  );
}

function FriendRow({ _otherId, name, avatarUrl, lastBody, lastAt, unread, onOpen, onView }: {
  _otherId: string;
  name: string;
  avatarUrl: string | null;
  lastBody: string;
  lastAt: string;
  unread: boolean;
  onOpen: () => void;
  onView: () => void;
}) {
  return (
    <li className="flex items-center justify-between py-2">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-full bg-neutral-200 grid place-items-center text-xs font-medium overflow-hidden">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
          ) : (
            name.slice(0,2).toUpperCase()
          )}
        </div>
        <div>
          <div className="font-medium text-neutral-900">{name}</div>
          <div className="text-xs text-neutral-600 truncate max-w-[220px]">{lastBody}</div>
        </div>
      </div>
      <div className="flex items-center gap-3">
               <span className="text-[10px] text-neutral-500">{timeAgo(lastAt)}</span>
        {unread && <span className="h-2 w-2 rounded-full bg-emerald-600" />}
        <button onClick={onView} className="text-sm text-neutral-700 hover:underline">View</button>
        <button onClick={onOpen} className="text-sm text-emerald-700 hover:underline">Chat</button>
      </div>
    </li>
  );
}