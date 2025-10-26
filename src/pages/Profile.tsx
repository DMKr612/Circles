import React, { useEffect, useLayoutEffect, useMemo, useState, useRef, useCallback, useDeferredValue } from "react";
// @ts-ignore: package ships without TS types in this setup
import { City } from 'country-state-city';
import { supabase } from "@/lib/supabase";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useLocation } from "react-router-dom";

// Demo stubs for toast calls (prevents red lines if Toaster is removed)
const success = (m?: string) => console.log("[ok]", m || "");
const error   = (m?: string) => console.error("[err]", m || "");

// Small sessionStorage helpers
function ssGet<T = any>(k: string, fallback: T): T {
  try { const v = sessionStorage.getItem(k); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; }
}
function ssSet(k: string, v: any) {
  try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {}
}



// Types
type PreviewGroup = { id: string; title: string; game: string | null; category: string | null; code?: string | null };
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

const __agoCache = new Map<string, string>();
function timeAgo(iso: string) {
  const prev = __agoCache.get(iso);
  const now = Date.now();
  if (prev) return prev;
  const d = new Date(iso);
  const diff = Math.floor((now - d.getTime()) / 1000);
  const res =
    diff < 60 ? `${diff}s` :
    diff < 3600 ? `${Math.floor(diff / 60)}m` :
    diff < 86400 ? `${Math.floor(diff / 3600)}h` :
    `${Math.floor(diff / 86400)}d`;
  __agoCache.set(iso, res);
  return res;
}
function normalizeCity(s: string): string {
  try {
    return s.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
  } catch {
    return (s || '').toLowerCase().trim();
  }
}

const propsShallowEqual = (a: any, b: any) => {
  const ka = Object.keys(a); const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (let k of ka) { if (a[k] !== b[k]) return false; }
  return true;
};

function renderGroupCode(id: string, serverCode?: string | null): string {
  const sc = (serverCode ?? '').toString().trim();
  if (sc) return sc.toUpperCase();
  // Fallback: legacy local code (kept only to avoid blank UI if DB code is missing)
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  const u = (h >>> 0).toString(16).toUpperCase();
  return u.padStart(8, '0').slice(-8);
}
type GroupInvite = {
  group_id: string;
  group_title: string | null;
  role: string | null;
  status: string;
  invited_at: string;
};
type GroupMsgNotif = {
  group_id: string;
  group_title: string | null;
  preview: string;
  created_at: string;
};

export default function Profile() {
  // UI containers used by effects below must be declared before usage
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { userId: routeUserId } = useParams<{ userId?: string }>();
  useLayoutEffect(() => {
    if (location.hash === "#chat") {
      setSidebarOpen(true);
    }
  }, [location.key, location.hash]);
  useEffect(() => {
    const handler = () => setSidebarOpen(true);
    window.addEventListener('open-chat' as any, handler);
    return () => window.removeEventListener('open-chat' as any, handler);
  }, []);
  // Auth + profile
  const [uid, setUid] = useState<string | null>(null);
  const viewingOther = !!routeUserId && routeUserId !== uid;
  const [email, setEmail] = useState<string | null>(null);
  const [name, setName] = useState<string>("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [sTheme, setSTheme] = useState<'system'|'light'|'dark'>('system');
  const [emailNotifs, setEmailNotifs] = useState<boolean>(false);
  const [pushNotifs, setPushNotifs] = useState<boolean>(false);
  const [allowRatings, setAllowRatings] = useState<boolean>(true);
  const [ratingAvg, setRatingAvg] = useState<number>(0);
  const [ratingCount, setRatingCount] = useState<number>(0);
  
  // Settings modal state
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sName, setSName] = useState<string>("");
  const [sCity, setSCity] = useState<string>("");
  const [sTimezone, setSTimezone] = useState<string>("UTC");
  const [sInterests, setSInterests] = useState<string>("");
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);

  // All German cities from country-state-city, deduped + sorted
  const deCities = useMemo<string[]>(() => {
    try {
      const all = (City.getCitiesOfCountry('DE') || []) as Array<{ name: string }>;
      const names = all.map(c => (c?.name || '').trim()).filter(Boolean);
      return Array.from(new Set(names)).sort((a,b)=>a.localeCompare(b));
    } catch {
      return [];
    }
  }, []);

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
// Group invitations + group message notifications
const [groupInvites, setGroupInvites] = useState<GroupInvite[]>([]);
const [groupNotifs, setGroupNotifs] = useState<GroupMsgNotif[]>([]);
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
  const threadQueryDeferred = useDeferredValue(threadQuery);
  const [showSuggestions, setShowSuggestions] = useState(false);


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

  // Derived: unread threads and total notification count
  const unreadThreads = useMemo(() => threads.filter(t => !t.last_from_me), [threads]);
  const notifCount = useMemo(
    () => incomingRequests.length + groupInvites.length + groupNotifs.length,
    [incomingRequests, groupInvites, groupNotifs]
  );
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
  const [viewAllowRatings, setViewAllowRatings] = useState<boolean>(true);
  const [viewRatingAvg, setViewRatingAvg] = useState<number>(0);
  const [viewRatingCount, setViewRatingCount] = useState<number>(0);
  const [myRating, setMyRating] = useState<number>(0);
  const [rateBusy, setRateBusy] = useState(false);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [myLastRatedAt, setMyLastRatedAt] = useState<string | null>(null);
  const [pairNextAllowedAt, setPairNextAllowedAt] = useState<string | null>(null);
  const [pairEditUsed, setPairEditUsed] = useState<boolean>(false);
  const [viewFriendStatus, setViewFriendStatus] =
    useState<'none'|'pending_in'|'pending_out'|'accepted'|'blocked'>('none');
const headerName        = viewingOther ? (viewName || (routeUserId ? routeUserId.slice(0,6) : '')) : (name || email || '');
const headerAvatar      = viewingOther ? viewAvatar : avatarUrl;
const headerRatingAvg   = viewingOther ? viewRatingAvg : ratingAvg;
const headerRatingCount = viewingOther ? viewRatingCount : ratingCount;


function fmtCooldown(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const cooldownSecs = useMemo(() => {
  if (!pairNextAllowedAt) return 0;
  const t = new Date(pairNextAllowedAt).getTime();
  return Math.max(0, Math.floor((t - Date.now()) / 1000));
}, [pairNextAllowedAt]);

const canEditOnce = useMemo(() => {
  if (!pairNextAllowedAt) return false;
  const t = new Date(pairNextAllowedAt).getTime();
  return t > Date.now() && !pairEditUsed;
}, [pairNextAllowedAt, pairEditUsed]);

const canRate = useMemo(
  () => viewAllowRatings && !rateBusy && (cooldownSecs === 0 || canEditOnce),
  [viewAllowRatings, rateBusy, cooldownSecs, canEditOnce]
);
// Loader for pair status from rating_pairs
type PairStatus = {
  stars: number | null;
  updated_at: string | null;
  next_allowed_at: string | null;
  edit_used: boolean;
};

async function loadPairStatus(otherId: string) {
  if (!uid || !otherId) return;
  const { data, error } = await supabase
    .from('rating_pairs')
    .select('stars,updated_at,next_allowed_at,edit_used')
    .eq('rater_id', uid)
    .eq('ratee_id', otherId)
    .maybeSingle();
  if (error) return;
  setMyRating(Number(data?.stars ?? 0));
  setMyLastRatedAt((data as any)?.updated_at ?? null);
  setPairNextAllowedAt((data as any)?.next_allowed_at ?? null);
  setPairEditUsed(Boolean((data as any)?.edit_used ?? false));
}
const headerInitials = (
  viewingOther
    ? (viewName || routeUserId || '?')
    : (name || email || '?')
)?.slice(0, 2).toUpperCase() ?? '?';

useEffect(() => {
  if (routeUserId && uid && routeUserId !== uid) {
    loadOtherProfile(routeUserId); // hydrate inline without modal
  }
}, [routeUserId, uid]);
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

  const openThread = useCallback(async (otherId: string) => {
    if (!uid) return;
    setShowSuggestions(false);
    setDmError(null);
    setDmLoading(true);
    setDmMsgs([]);
    setDmTargetId(otherId);
    // mark thread as read locally
    setThreads(prev => prev.map(t => t.other_id === otherId ? { ...t, unread: false, last_from_me: true } : t));
    const { data: msgs } = await supabase
      .from("direct_messages")
      .select("id,from_id,to_id,body,created_at")
      .or(`and(from_id.eq.${uid},to_id.eq.${otherId}),and(from_id.eq.${otherId},to_id.eq.${uid})`)
      .order("created_at", { ascending: true })
      .limit(200);
    setDmMsgs(msgs ?? []);
    setDmLoading(false);
  }, [uid]);

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

  async function refreshGroupSignals(userId: string) {
  // Invitations: status pending/invited for this user
  const { data: inv } = await supabase
    .from("group_members")
    .select("group_id, role, status, created_at, groups(title)")
    .eq("user_id", userId)
    .in("status", ["pending", "invited"])
    .order("created_at", { ascending: false })
    .limit(50);

  const invites: GroupInvite[] = (inv ?? []).map((r: any) => ({
    group_id: r.group_id,
    group_title: r.groups?.title ?? null,
    role: r.role ?? null,
    status: r.status ?? "pending",
    invited_at: r.created_at,
  }));
  setGroupInvites(invites);

  // Get all group IDs where the user is an active member
  const { data: gm } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", userId)
    .eq("status", "active");
  const gIds = (gm ?? []).map((r: any) => r.group_id);

  // Group message notifications: latest posts in my groups, not from me
  let notifs: GroupMsgNotif[] = [];
  if (gIds.length) {
    const { data: msgs } = await supabase
      .from("group_messages")
      .select("group_id, content:body, created_at, groups(title), user_id")
      .in("group_id", gIds)
      .neq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);

    notifs = (msgs ?? []).map((m: any) => ({
      group_id: m.group_id,
      group_title: m.groups?.title ?? null,
      preview: String(m.content || "").slice(0, 120),
      created_at: m.created_at,
    }));
  }
  setGroupNotifs(notifs);
}

  async function openProfileView(otherId: string) {
    if (!uid) return;
    setViewUserId(otherId);

    const { data: prof } = await supabase
      .from("profiles")
      .select("user_id,name,avatar_url,allow_ratings,rating_avg,rating_count")
      .eq("user_id", otherId)
      .maybeSingle();
    setViewName((prof as any)?.name ?? otherId.slice(0,6));
    setViewAvatar((prof as any)?.avatar_url ?? null);
    setViewAllowRatings(Boolean((prof as any)?.allow_ratings ?? true));
    setViewRatingAvg(Number((prof as any)?.rating_avg ?? 0));
    setViewRatingCount(Number((prof as any)?.rating_count ?? 0));

    // Prefill my existing rating + window status from the new model
    await loadPairStatus(otherId);

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
    try {
      const { error: rpcErr } = await supabase.rpc("request_friend", { target_id: targetId });
      if (rpcErr) throw rpcErr;
      if (uid) await refreshFriendData(uid);
      setViewFriendStatus('pending_out');
      success('Friend request sent');
    } catch (e: any) {
      const msg = e?.message || 'Could not send friend request';
      error(msg);
    }
  }

  async function acceptFriend(fromId: string) {
    try {
      const { error: rpcErr } = await supabase.rpc("accept_friend", { from_id: fromId });
      if (rpcErr) throw rpcErr;
      if (uid) await refreshFriendData(uid);
      if (viewUserId === fromId) setViewFriendStatus('accepted');
      success('Friend request accepted');
    } catch (e: any) {
      const msg = e?.message || 'Could not accept friend request';
      error(msg);
    }
  }

  async function removeFriend(otherId: string) {
    try {
      const { error: rpcErr } = await supabase.rpc("remove_friend", { other_id: otherId });
      if (rpcErr) throw rpcErr;
      if (uid) await refreshFriendData(uid);
      if (viewUserId === otherId) setViewFriendStatus('none');
      success('Removed');
    } catch (e: any) {
      const msg = e?.message || 'Could not remove friend';
      error(msg);
    }
  }

// Rate another user (1–6 stars) with a 14‑day window and one allowed edit inside the window
async function rateUser(n: number) {
  if (!uid || !viewUserId || rateBusy) return;
  // Only allow if we are outside the window OR have the one-time edit available
  if (!(cooldownSecs === 0 || canEditOnce)) return;

  const v = Math.max(1, Math.min(6, Math.round(n))); // clamp to 1..6 (no 'clear' in the new model)
  setRateBusy(true);

  const prev = myRating;
  setMyRating(v);
  try {
    const { error: rpcErr } = await supabase.rpc('submit_rating', { p_ratee: viewUserId, p_stars: v });
    if (rpcErr) throw rpcErr;

    // Reload pair status and aggregates
    await loadPairStatus(viewUserId);
    const { data: agg } = await supabase
      .from('profiles')
      .select('rating_avg,rating_count')
      .eq('user_id', viewUserId)
      .maybeSingle();
    if (agg) {
      setViewRatingAvg(Number((agg as any).rating_avg ?? 0));
      setViewRatingCount(Number((agg as any).rating_count ?? 0));
    }
  } catch (e: any) {
    setMyRating(prev);
    const msg = String(e?.message || '');
    if (/rate_cooldown_active/i.test(msg)) {
      setErr('You already used your one edit for this 14‑day window.');
    } else if (/invalid_stars/i.test(msg)) {
      setErr('Rating must be between 1 and 6.');
    } else if (/not_authenticated/i.test(msg)) {
      setErr('Please sign in to rate.');
    } else {
      setErr('Rating failed.');
    }
  } finally {
    setRateBusy(false);
  }
}
  const acceptGroupInvite = useCallback(async (gid: string) => {
    if (!uid) return;
    // Prefer simple update; if RLS blocks, fallback to delete+insert
    const { error } = await supabase
      .from("group_members")
      .update({ status: "active" })
      .eq("group_id", gid)
      .eq("user_id", uid);
    if (error) {
      try {
        await supabase.from("group_members").delete().eq("group_id", gid).eq("user_id", uid);
        await supabase.from("group_members").insert({ group_id: gid, user_id: uid, status: "active", role: "member" });
      } catch {}
    }
    await refreshGroupSignals(uid);
  }, [uid]);

// Hydrate another user's profile WITHOUT opening the modal
async function loadOtherProfile(otherId: string) {
  if (!uid) return;
  setViewUserId(otherId);

  const { data: prof } = await supabase
    .from("profiles")
    .select("user_id,name,avatar_url,allow_ratings,rating_avg,rating_count")
    .eq("user_id", otherId)
    .maybeSingle();
  setViewName((prof as any)?.name ?? otherId.slice(0, 6));
  setViewAvatar((prof as any)?.avatar_url ?? null);
  setViewAllowRatings(Boolean((prof as any)?.allow_ratings ?? true));
  setViewRatingAvg(Number((prof as any)?.rating_avg ?? 0));
  setViewRatingCount(Number((prof as any)?.rating_count ?? 0));

  // Prefill my existing rating + window status from the new model
  await loadPairStatus(otherId);

  // Friend relation (for inline status/buttons)
  const { data: rel } = await supabase
    .from("friendships")
    .select("id,user_id_a,user_id_b,status,requested_by")
    .or(`and(user_id_a.eq.${uid},user_id_b.eq.${otherId}),and(user_id_a.eq.${otherId},user_id_b.eq.${uid})`)
    .limit(1)
    .maybeSingle();

  let st: "none" | "pending_in" | "pending_out" | "accepted" | "blocked" = "none";
  if (rel) {
    if (rel.status === "accepted") st = "accepted";
    else if (rel.status === "blocked") st = "blocked";
    else if (rel.status === "pending") {
      st = rel.requested_by === uid ? "pending_out" : "pending_in";
    }
  }
  setViewFriendStatus(st);

  // Make sure the popup never appears
  setViewOpen(false);
}
const declineGroupInvite = useCallback(async (gid: string) => {
  if (!uid) return;
  await supabase.from("group_members").delete().eq("group_id", gid).eq("user_id", uid);
  await refreshGroupSignals(uid);
}, [uid]);

const openGroup = useCallback((gid: string) => {
  setGroupNotifs(prev => prev.filter(n => n.group_id !== gid));
  setNotifOpen(false);
  navigate(`/group/${gid}`);
}, [navigate]);

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
      .select("name, city, timezone, interests, avatar_url, allow_ratings, rating_avg, rating_count")
      .eq("user_id", uid)
      .maybeSingle();
    if (error) { setSettingsMsg(error.message); setSettingsOpen(true); return; }
    setSName((p as any)?.name ?? "");
    setSCity((p as any)?.city ?? "");
    setSTimezone((p as any)?.timezone ?? "UTC");
    const ints = Array.isArray((p as any)?.interests) ? ((p as any).interests as string[]) : [];
    setSInterests(ints.join(", "));
    setAvatarUrl((p as any)?.avatar_url ?? null);
    setAllowRatings((p as any)?.allow_ratings ?? true);
    setRatingAvg(Number((p as any)?.rating_avg ?? 0));
    setRatingCount(Number((p as any)?.rating_count ?? 0));
    setSettingsOpen(true);
  }

// Helper to get device/browser timezone
function deviceTZ(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
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
      if (!city) { setSettingsMsg("Please choose a city."); setSettingsSaving(false); return; }
      const timezone = sTimezone.trim() || "UTC";
      const interests = sInterests.split(",").map(s => s.trim()).filter(Boolean);

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ name, city, timezone, interests })
        .eq("user_id", uid);

      if (updateError) throw updateError;
      setName(name);
      try {
         localStorage.setItem('myCity', city);
         localStorage.setItem('myCityNorm', normalizeCity(city));
         window.dispatchEvent(new CustomEvent('my-city-changed', { detail: { city } }));
      } catch {}
      setSettingsMsg("Saved.");
      success('Profile saved');
      localStorage.setItem('theme', sTheme);
      localStorage.setItem('emailNotifs', emailNotifs ? '1' : '0');
      localStorage.setItem('pushNotifs', pushNotifs ? '1' : '0');
      applyTheme(sTheme);
      setSettingsOpen(false);
    } catch (err: any) {
      const msg = err?.message || "Failed to save";
      setSettingsMsg(msg);
      error(msg);
    } finally {
      setSettingsSaving(false);
    }
  }

  function applyTheme(theme: 'system'|'light'|'dark') {
  const root = document.documentElement;
  root.classList.remove('light','dark');
  if (theme === 'light') root.classList.add('light');
  else if (theme === 'dark') root.classList.add('dark');
}

async function saveAllowRatings(next: boolean) {
  setAllowRatings(next);
  if (!uid) return;
  try {
    await supabase.from('profiles').update({ allow_ratings: next }).eq('user_id', uid);
  } catch {}
}

async function onAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0];
  if (!uid || !file) return;
  try {
    setAvatarUploading(true);
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${uid}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
    if (upErr) throw upErr;
    const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
    const url = pub?.publicUrl || null;
    if (url) {
      await supabase.from('profiles').update({ avatar_url: url }).eq('user_id', uid);
      setAvatarUrl(url);
    }
  } catch (e) {
    console.error(e);
    setSettingsMsg('Avatar upload failed');
  } finally {
    setAvatarUploading(false);
  }
}

// Logout function
async function logout() {
  try {
    await supabase.auth.signOut();
  } catch {}

  // Clear local app flags
  try {
    localStorage.removeItem('onboardingSeen');
    sessionStorage.clear();
  } catch {}

  // iOS/Android PWAs sometimes ignore SPA navigate after async tasks.
  // Always do a hard redirect to the app base so it works on mobile.
  const base = `${window.location.origin}${import.meta.env.BASE_URL}`;

  // Best-effort: unregister service workers to avoid stale caches keeping old UI
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
  } catch {}

  window.location.replace(base);
}
  // Load friend profiles via RPC (uses auth.uid() on the server)
useEffect(() => {
  (async () => {
    if (!uid) { setFriendProfiles(new Map()); return; }
    const { data: fr } = await supabase
  .from("friendships")
  .select("user_id_a,user_id_b,status")
  .or(`user_id_a.eq.${uid},user_id_b.eq.${uid}`)
  .eq("status","accepted");
const ids = new Set<string>();
(fr ?? []).forEach(r => ids.add(r.user_id_a === uid ? r.user_id_b : r.user_id_a));
let m = new Map<string, { name: string; avatar_url: string | null }>();
if (ids.size) {
  const { data: profs } = await supabase.from("profiles").select("user_id,name,avatar_url").in("user_id", [...ids]);
  (profs ?? []).forEach((p:any) => m.set(p.user_id, { name: p.name ?? "", avatar_url: p.avatar_url ?? null }));
}
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
      const LS_THEME = localStorage.getItem('theme') as 'system'|'light'|'dark' | null;
      if (LS_THEME) setSTheme(LS_THEME);
      const LS_EMAIL = localStorage.getItem('emailNotifs');
      if (LS_EMAIL) setEmailNotifs(LS_EMAIL === '1');
      const LS_PUSH = localStorage.getItem('pushNotifs');
      if (LS_PUSH) setPushNotifs(LS_PUSH === '1');
      if (!_uid) { setLoading(false); setErr("Please sign in."); return; }
      if (off) return;
      setUid(_uid); setEmail(_email);

      // Pre-hydrate UI from session cache (instant paint)
      const CK_CREATED = `profile:${_uid}:createdPreview`;
      const CK_JOINED  = `profile:${_uid}:joinedPreview`;
      const CK_THREADS = `profile:${_uid}:threads`;
      const cachedCreated = ssGet<PreviewGroup[]>(CK_CREATED, []);
      const cachedJoined  = ssGet<PreviewGroup[]>(CK_JOINED,  []);
      const cachedThreads = ssGet<Thread[]>(CK_THREADS, []);
      if (cachedCreated.length) setCreatedPreview(cachedCreated);
      if (cachedJoined.length)  setJoinedPreview(cachedJoined);
      if (cachedThreads.length) setThreads(cachedThreads);

      // ESSENTIAL: profile + counts in parallel
      const [profResp, createdCountResp, joinedCountResp] = await Promise.all([
        supabase
          .from("profiles")
          .select("name, city, timezone, interests, avatar_url, allow_ratings, rating_avg, rating_count")
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
        const city0 = (prof?.city ?? "").trim();
        setSCity(city0);
        if (city0) {
         try {
            localStorage.setItem('myCity', city0);
            localStorage.setItem('myCityNorm', normalizeCity(city0));
             window.dispatchEvent(new CustomEvent('my-city-changed', { detail: { city: city0 } }));
         } catch {}
        }

        setSTimezone(prof?.timezone ?? "UTC");
        if (!prof?.timezone) setSTimezone(deviceTZ());
        const ints0 = Array.isArray(prof?.interests) ? (prof.interests as string[]) : [];
        setSInterests(ints0.join(", "));
        setAvatarUrl(prof?.avatar_url ?? null);
        setAllowRatings(prof?.allow_ratings ?? true);
        setRatingAvg(Number(prof?.rating_avg ?? 0));
        setRatingCount(Number(prof?.rating_count ?? 0));

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
          const { data: cg, error: cgErr } = await supabase
            .from("groups")
            .select("id,title,game,category,created_at, code")
            .in("id", createdIds)
            .order("created_at", { ascending: false })
            .limit(20);

          if (cgErr) {
            // Fallback: some DBs may not have pgcrypto or allow expressions in SELECT
            const { data: cg2 } = await supabase
              .from("groups")
              .select("id,title,game,category,created_at")
              .in("id", createdIds)
              .order("created_at", { ascending: false })
              .limit(20);
            createdGroups = cg2 ?? [];
          } else {
            createdGroups = cg ?? [];
          }
        }
        if (!off) {
          const seenC = new Set<string>();
          const uniqueC = createdGroups.filter((g: any) => g?.id && !seenC.has(g.id) && seenC.add(g.id)).slice(0, 5);
          setCreatedPreview(uniqueC as PreviewGroup[]);
          ssSet(CK_CREATED, uniqueC);
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
          const { data: jg, error: jgErr } = await supabase
            .from("groups")
            .select("id,title,game,category,created_at, code")
            .in("id", joinedIds)
            .order("created_at", { ascending: false })
            .limit(20);

          if (jgErr) {
            // Fallback without SQL expression
            const { data: jg2 } = await supabase
              .from("groups")
              .select("id,title,game,category,created_at")
              .in("id", joinedIds)
              .order("created_at", { ascending: false })
              .limit(20);
            joinedGroups = jg2 ?? [];
          } else {
            joinedGroups = jg ?? [];
          }
        }
        if (!off) {
          const seenJ = new Set<string>();
          const uniqueJ = joinedGroups.filter((g: any) => g?.id && !seenJ.has(g.id) && seenJ.add(g.id)).slice(0, 5);
          setJoinedPreview(uniqueJ as PreviewGroup[]);
          ssSet(CK_JOINED, uniqueJ);
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
          .select("from_id,to_id,body,created_at")
          .or(`from_id.eq.${_uid},to_id.eq.${_uid}`)
          .order("created_at", { ascending: false })
          .limit(40);
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
        if (!off) ssSet(CK_THREADS, threadList);

        if (!off) await refreshFriendData(_uid);
        if (!off) await refreshGroupSignals(_uid);
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
    <div className="mx-auto max-w-6xl px-4 pt-16 md:pt-20 pb-0">
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
      {/* Header */}
      <div className="mb-6 flex items-center gap-4">
        <div className="grid h-16 w-16 place-content-center rounded-full bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300/60 overflow-hidden">
          {headerAvatar ? (
            <img src={headerAvatar} alt="" className="h-16 w-16 object-cover" />
          ) : (
            <span className="text-2xl font-semibold tracking-wide">{headerInitials}</span>
          )}
        </div>
        <div className="flex-1">
          <div className="text-lg font-semibold text-neutral-900">{headerName}</div>
          {!viewingOther && <div className="text-sm text-neutral-600">{email}</div>}
          <div className="mt-1 flex items-center gap-3 text-sm text-neutral-700">
  {/* Average stars (0–6) + total count */}
  <span
    title={`${headerRatingAvg.toFixed(1)} / 6 from ${headerRatingCount} ratings`}
    className="inline-flex items-center gap-1"
  >
    {Array.from({ length: 6 }).map((_, i) => (
      <span key={i}>
        {i < Math.round(headerRatingAvg || 0) ? '★' : '☆'}
      </span>
    ))}
    <span className="ml-1 text-xs text-neutral-500">
      ({headerRatingCount || 0})
    </span>
  </span>

  {/* Interactive rater for viewing other profiles */}
  {viewingOther && (
    <div className="ml-2 inline-flex items-center gap-2">
      <span className="text-xs text-neutral-500">Rate:</span>
      {Array.from({ length: 6 }).map((_, idx) => {
        const n = idx + 1; // 1..6
        const active = (hoverRating ?? myRating) >= n;
        return (
          <button
            key={n}
            type="button"
            disabled={!viewAllowRatings || rateBusy}
            onMouseEnter={() => setHoverRating(n)}
            onMouseLeave={() => setHoverRating(null)}
            onClick={() => rateUser(n)}
            className={`text-lg leading-none ${
              (!viewAllowRatings || rateBusy)
                ? 'opacity-40 cursor-not-allowed'
                : 'hover:scale-110 transition-transform'
            } ${active ? 'text-emerald-600' : 'text-neutral-400'}`}
            aria-label={`Give ${n} star${n > 1 ? 's' : ''}`}
            title={viewAllowRatings ? `${n} / 6` : 'Ratings disabled'}
          >
            {active ? '★' : '☆'}
          </button>
        );
      })}
      {(!canRate && !canEditOnce) && (
        <span className="ml-1 text-[11px] text-neutral-500">
          Next in {fmtCooldown(cooldownSecs)}
        </span>
      )}
      {(canEditOnce) && (
        <span className="ml-1 text-[11px] text-emerald-600">
          One edit available in this window
        </span>
      )}
    </div>
  )}
</div>

          {!viewingOther && (
            <div className="mt-2 flex items-center gap-2">
              <div ref={notifRef} className="relative">
                <button
                  onClick={() => setNotifOpen(v => !v)}
                  className="ml-2 inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1.5 text-sm hover:bg-black/[0.04]"
                  title="Notifications"
                  aria-label="Notifications"
                >
                  <span className="text-base">🔔</span>
                  {notifCount > 0 && (
                    <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-white text-xs leading-none">{notifCount}</span>
                  )}
                </button>
                {notifOpen && (
                  <div className="absolute right-0 z-50 mt-1 w-96 max-w-[92vw] overflow-hidden rounded-xl border border-black/10 bg-white shadow-xl">
                    <div className="flex items-center justify-between border-b border-black/10 bg-neutral-50 px-3 py-2">
                      <div className="text-sm font-medium text-neutral-800">Notifications</div>
                      <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] text-neutral-800">{notifCount}</span>
                    </div>
                    <div className="max-h-80 overflow-y-auto p-2">
                      {/* Friend requests */}
                      <div className="mb-2">
                        <div className="mb-1 text-xs font-semibold text-neutral-700">Friend requests</div>
                        {incomingRequests.length === 0 ? (
                          <div className="rounded-md border border-black/5 bg-neutral-50 px-2 py-2 text-xs text-neutral-600">No new requests</div>
                        ) : (
                          <ul className="space-y-1">
                            {incomingRequests.slice(0, 5).map(r => {
                              const other = r.user_id_a === uid ? r.user_id_b : r.user_id_a;
                              const nm = friendProfiles.get(other)?.name || other.slice(0,6);
                              return (
                                <li key={r.id} className="flex items-center justify-between rounded-md border border-black/10 px-2 py-1.5">
                                  <span className="truncate text-sm text-neutral-800">{nm}</span>
                                  <div className="flex items-center gap-2">
                                    <button onClick={() => acceptFriend(other)} className="rounded-md bg-emerald-600 px-2 py-0.5 text-xs text-white">Accept</button>
                                    <button onClick={() => removeFriend(other)} className="rounded-md border border-black/10 px-2 py-0.5 text-xs">Decline</button>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                      {/* Group invitations */}
                      <div className="mb-2">
                        <div className="mb-1 text-xs font-semibold text-neutral-700">Group invitations</div>
                        {groupInvites.length === 0 ? (
                          <div className="rounded-md border border-black/5 bg-neutral-50 px-2 py-2 text-xs text-neutral-600">No new invitations</div>
                        ) : (
                          <ul className="space-y-1">
                            {groupInvites.slice(0, 5).map((gi) => (
                              <li key={gi.group_id} className="flex items-center justify-between rounded-md border border-black/10 px-2 py-1.5">
                                <div className="min-w-0 pr-2">
                                  <div className="truncate text-sm text-neutral-800">{gi.group_title || gi.group_id.slice(0,6)}</div>
                                  <div className="text-[11px] text-neutral-500">Status: {gi.status}</div>
                                </div>
                                <div className="shrink-0 flex items-center gap-2">
                                  <button onClick={() => acceptGroupInvite(gi.group_id)} className="rounded-md bg-emerald-600 px-2 py-0.5 text-xs text-white">Accept</button>
                                  <button onClick={() => declineGroupInvite(gi.group_id)} className="rounded-md border border-black/10 px-2 py-0.5 text-xs">Decline</button>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      {/* Group messages */}
                      <div className="mb-2">
                        <div className="mb-1 text-xs font-semibold text-neutral-700">Group messages</div>
                        {groupNotifs.length === 0 ? (
                          <div className="rounded-md border border-black/5 bg-neutral-50 px-2 py-2 text-xs text-neutral-600">No new messages</div>
                        ) : (
                          <ul className="divide-y">
                            {groupNotifs.slice(0, 5).map(gn => (
                              <li key={`${gn.group_id}-${gn.created_at}`} className="flex items-center justify-between py-2">
                                <div className="min-w-0 pr-2">
                                  <div className="truncate text-sm font-medium text-neutral-900">{gn.group_title || gn.group_id.slice(0,6)}</div>
                                  <div className="truncate text-xs text-neutral-600">{gn.preview}</div>
                                </div>
                                <button onClick={() => openGroup(gn.group_id)} className="shrink-0 rounded-md border border-black/10 px-2 py-0.5 text-xs">Open</button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <button
                onClick={openSettings}
                className="ml-2 rounded-md border border-black/10 bg-white px-3 py-1.5 text-sm hover:bg-black/[0.04]"
              >
                Settings
              </button>
            </div>
          )}
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
                  code={(g as any)?.code ?? null}
                />
              );
            })}
          </Card>

          <Card title="Friends" count={sidebarItems.length} empty="No friends yet.">
            {sidebarItems.map((t) => {
              const handleOpen = () => openThread(t.other_id);
              return (
                <FriendRow
                  key={t.other_id}
                  _otherId={t.other_id}
                  name={t.name}
                  avatarUrl={t.avatar_url}
                  lastBody={t.last_body}
                  lastAt={t.last_at}
                  unread={t.unread}
                  onOpen={handleOpen}
                />
              );
            })}
          </Card>
        </div>
        </section>
        {/* Group Invitations section */}
        {groupInvites.length > 0 && (
          <section className="mt-6">
            <Card title="Group Invitations" count={groupInvites.length} empty="No invitations">
              {groupInvites.map((gi) => (
                <li key={gi.group_id} className="flex items-center justify-between py-2">
                  <div>
                    <div className="font-medium text-neutral-900">{gi.group_title || gi.group_id.slice(0,6)}</div>
                    <div className="text-xs text-neutral-600">Role: {gi.role || "member"} · Status: {gi.status}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => acceptGroupInvite(gi.group_id)} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs text-white">Accept</button>
                    <button onClick={() => declineGroupInvite(gi.group_id)} className="rounded-md border border-black/10 bg-white px-3 py-1.5 text-xs">Decline</button>
                  </div>
                </li>
              ))}
            </Card>
          </section>
        )}
        </div>
        {!viewingOther && sidebarOpen && (
          <aside
            ref={sidebarRef}
            className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm h-max sticky top-4 transition-all duration-300"
          >
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
                        .filter(o => o.name.toLowerCase().includes(threadQueryDeferred.toLowerCase()))
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
                                onClick={() => { setThreadQuery(""); navigate(`/profile/${o.id}`); }}
                                className="rounded-md bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700"
                              >
                                View
                              </button>
                            </div>
                          </li>
                        ))}
                      {friendOptions.filter(o => o.name.toLowerCase().includes(threadQueryDeferred.toLowerCase())).length === 0 && (
                        <li className="px-2 py-2 text-xs text-neutral-600">No matches</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>

              <div className="max-h-[70vh] overflow-y-auto">
                <ul>
                  {sidebarItems
                    .filter(t => t.name.toLowerCase().includes(threadQueryDeferred.toLowerCase()))
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
        {!viewingOther && !sidebarOpen && (
          <button
            onClick={() => {
              setSidebarOpen(true);
            }}
            className="fixed bottom-4 right-4 z-40 h-12 w-12 rounded-full bg-emerald-600 text-white shadow-lg flex items-center justify-center hover:bg-emerald-700 transition relative"
            title="Open chat"
            aria-label="Open chat"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
              <path d="M3.25 6.75A2.75 2.75 0 0 1 6 4h12a2.75 2.75 0 0 1 2.75 2.75v6.5A2.75 2.75 0 0 1 18 16H9.414a1.75 1.75 0 0 0-1.238.512l-2.476 2.476A.75.75 0 0 1 4 18.75V6.75z" />
            </svg>
            {unreadThreads.length > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-400 text-[10px] font-medium text-white animate-pulse">
                {unreadThreads.length}
              </span>
            )}
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
              <label className="mb-1 block text-sm font-medium text-neutral-800">Avatar</label>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-neutral-200 grid place-items-center overflow-hidden">
                  {avatarUrl ? <img src={avatarUrl} alt="" className="h-10 w-10 object-cover" /> : <span className="text-xs">{initials}</span>}
                </div>
                <input type="file" accept="image/*" onChange={onAvatarChange} className="text-sm" />
                {avatarUploading && <span className="text-xs text-neutral-600">Uploading…</span>}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-800">City</label>
              <input
                value={sCity}
                onChange={(e) => setSCity(e.target.value)}
                onBlur={() => { if (!sTimezone || sTimezone === "UTC") setSTimezone(deviceTZ()); }}
                className="w-full rounded-md border border-black/10 px-3 py-2 text-sm"
                placeholder="Start typing… e.g., Berlin"
                list="cities-de"
                required
              />
              <datalist id="cities-de">
                {deCities.slice(0, 8000).map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              <div className="mt-1 text-[11px] text-neutral-500">
                Choose your city. This powers “My city” filters in Browse.
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-800">Timezone</label>
              <input
                value={sTimezone}
                onChange={(e) => setSTimezone(e.target.value)}
                className="w-full rounded-md border border-black/10 px-3 py-2 text-sm"
                placeholder="e.g., Europe/Berlin"
              />
              <div className="mt-1 text-[11px] text-neutral-500">
                Auto-fills from your device when you set City. You can still override manually.
              </div>
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

          <div>
  <label className="mb-1 block text-sm font-medium text-neutral-800">Theme</label>
  <select
    value={sTheme}
    onChange={(e) => setSTheme(e.target.value as 'system'|'light'|'dark')}
    className="w-full rounded-md border border-black/10 px-3 py-2 text-sm"
  >
    <option value="system">System</option>
    <option value="light">Light</option>
    <option value="dark">Dark</option>
  </select>
  <div className="mt-1 text-[11px] text-neutral-500">Light/Dark applies after save.</div>
</div>

<div className="flex items-center gap-2">
  <input
    id="emailNotifs"
    type="checkbox"
    checked={emailNotifs}
    onChange={(e) => setEmailNotifs(e.target.checked)}
    className="h-4 w-4 rounded border-black/20"
  />
  <label htmlFor="emailNotifs" className="text-sm text-neutral-800">Email notifications</label>
</div>
<div className="flex items-center gap-2">
  <input
    id="pushNotifs"
    type="checkbox"
    checked={pushNotifs}
    onChange={(e) => setPushNotifs(e.target.checked)}
    className="h-4 w-4 rounded border-black/20"
  />
  <label htmlFor="pushNotifs" className="text-sm text-neutral-800">Push notifications</label>
</div>
<div className="flex items-center justify-between gap-2">
  <div>
    <div className="text-sm font-medium text-neutral-800">Allow profile ratings</div>
    <div className="text-[11px] text-neutral-500">Others can rate you when enabled.</div>
  </div>
  <button
    type="button"
    onClick={() => saveAllowRatings(!allowRatings)}
    className={`h-7 w-12 rounded-full ${allowRatings ? 'bg-emerald-600' : 'bg-neutral-300'} relative`}
    aria-pressed={allowRatings}
  >
    <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition ${allowRatings ? 'right-0.5' : 'left-0.5'}`} />
  </button>
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
                <div className="flex items-center gap-2">
                  <div className="text-base font-semibold text-neutral-900">{viewName}</div>
                  <div className="flex items-center text-neutral-800">
                    <div className="flex items-center gap-2">
                      <button
  type="button"
  disabled={!viewAllowRatings || rateBusy}
  onClick={() => rateUser(5)}
  className={`text-lg ${(!viewAllowRatings || rateBusy) ? 'opacity-50 cursor-not-allowed' : 'hover:scale-110 transition-transform'} ${myRating === 5 ? 'text-green-600' : 'text-neutral-400'}`}
  title={viewAllowRatings ? 'Thumbs up' : 'Ratings disabled'}
>
  👍
</button>
<button
  type="button"
  disabled={!viewAllowRatings || rateBusy}
  onClick={() => rateUser(1)}
  className={`text-lg ${(!viewAllowRatings || rateBusy) ? 'opacity-50 cursor-not-allowed' : 'hover:scale-110 transition-transform'} ${myRating === 1 ? 'text-red-600' : 'text-neutral-400'}`}
  title={viewAllowRatings ? 'Thumbs down' : 'Ratings disabled'}
>
  👎
</button>
                      <span className="ml-1 text-[11px] text-neutral-500">({viewRatingCount})</span>
                    </div>
                  </div>
                </div>
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

const StatCard = React.memo(function StatCard({ label, value, to, onClick }: { label: string; value: number; to?: string; onClick?: () => void }) {
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
}, propsShallowEqual);

const Card = React.memo(function Card({ title, count, empty, children }: { title: string; count: number; empty: string; children: React.ReactNode }) {
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
}, propsShallowEqual);

const Row = React.memo(function Row({ id, title, meta, code }: { id: string; title: string; meta: string; code?: string | null }) {
  const shortHash = renderGroupCode(String(id), code);
  return (
    <li className="flex items-center justify-between py-2">
      <div>
        <Link to={`/group/${id}`} className="font-medium text-neutral-900 hover:underline">{title}</Link>
        <div className="text-xs text-neutral-600">{meta}</div>
        <div className="text-[11px] text-neutral-500 tracking-wider">Code: {shortHash}</div>
      </div>
      <Link to={`/group/${id}`} className="text-sm text-emerald-700 hover:underline">Open</Link>
    </li>
  );
}, propsShallowEqual);

const FriendRow = React.memo(function FriendRow({ _otherId, name, avatarUrl, lastBody, lastAt, unread, onOpen }: {
  _otherId: string;
  name: string;
  avatarUrl: string | null;
  lastBody: string;
  lastAt: string;
  unread: boolean;
  onOpen: () => void;
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
        <Link to={`/profile/${_otherId}`} className="text-sm text-neutral-700 hover:underline">View</Link>
        <button onClick={onOpen} className="text-sm text-emerald-700 hover:underline">Chat</button>
      </div>
    </li>
  );
}, propsShallowEqual);