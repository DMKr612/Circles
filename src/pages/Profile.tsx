import React, { useEffect, useLayoutEffect, useMemo, useState, useRef, useCallback, useDeferredValue } from "react";
// @ts-ignore: package ships without TS types in this setup
// import { City } from 'country-state-city'; // This import is unused and conflicts with window-based loading
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

function timeAgo(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const now = Date.now();
  const diff = Math.floor((now - d.getTime()) / 1000);
  if (diff < 5) return "now";
  return diff < 60 ? `${diff}s` :
    diff < 3600 ? `${Math.floor(diff / 60)}m` :
    diff < 86400 ? `${Math.floor(diff / 3600)}h` :
    `${Math.floor(diff / 86400)}d`;
}

function fmtCooldown(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function propsShallowEqual(prev: any, next: any): boolean {
  const keys = Object.keys(prev);
  if (keys.length !== Object.keys(next).length) return false;
  for (const k of keys) {
    if (prev[k] !== next[k]) return false;
  }
  return true;
}

function normalizeCity(s: string): string {
  try {
    return s.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
  } catch {
    return (s || '').toLowerCase().trim();
  }
}

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


// All German cities from country-state-city, deduped + sorted
const DE_CITIES: string[] = (() => {
  // @ts-ignore: package ships without TS types in this setup
  const { State, City } = (window as any).countryStateCity || { State: null, City: null };
  if (!State || !City) return [];
  try {
    const states = (State.getStatesOfCountry('DE') || []) as Array<{ isoCode: string; name: string }>;
    const names: string[] = [];
    for (const s of states) {
      const cities = (City.getCitiesOfState('DE', s.isoCode) || []) as Array<{ name: string }>;
      for (const c of cities) {
        if (c && typeof c.name === 'string' && c.name.trim()) {
          names.push(c.name.trim());
        }
      }
    }
    return Array.from(new Set(names)).sort((a,b)=>a.localeCompare(b,'de'));
  } catch (e) {
    console.warn("Could not load cities list", e);
    return [];
  }
})();
// Helper to get device/browser timezone
function deviceTZ(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

type FriendShipRow = {
  id: string;
  user_id_a: string;
  user_id_b: string;
  status: 'pending' | 'accepted' | 'blocked';
  requested_by: string;
};
type DMMessage = { id: string; from_id: string; to_id: string; body: string; created_at: string };

type ProfileStub = {
  name: string;
  avatar_url: string | null;
}

type PairStatus = {
  stars: number | null;
  updated_at: string | null;
  next_allowed_at: string | null;
  edit_used: boolean;
};

// --- Main component ---

export default function Profile() {
  const navigate = useNavigate();
  const location = useLocation();
  const { userId: routeUserId } = useParams<{ userId?: string }>();

  // --- UI State ---
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [gamesModalOpen, setGamesModalOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
 
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const notifRef = useRef<HTMLDivElement | null>(null);

  // --- Auth & Profile Data ---
  const [uid, setUid] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [name, setName] = useState<string>("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [ratingAvg, setRatingAvg] = useState<number>(0);
  const [ratingCount, setRatingCount] = useState<number>(0);
  const [city, setCity] = useState<string>(""); // for city-based matching
  const [onboarded, setOnboarded] = useState<boolean>(true); // assume true
 
  const viewingOther = !!routeUserId && routeUserId !== uid;

  // --- Settings modal state ---
  const [sName, setSName] = useState<string>("");
  const [sCity, setSCity] = useState<string>("");
  const [sTimezone, setSTimezone] = useState<string>("UTC");
  const [sInterests, setSInterests] = useState<string>("");
  const [sTheme, setSTheme] = useState<'system'|'light'|'dark'>('system');
  const [emailNotifs, setEmailNotifs] = useState<boolean>(false);
  const [pushNotifs, setPushNotifs] = useState<boolean>(false);
  const [allowRatings, setAllowRatings] = useState<boolean>(true);
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);

  // --- [FIX] REMOVED redundant useMemo block. `DE_CITIES` (top-level) is used instead.

  // --- DM / Chat state ---
  const [dmTargetId, setDmTargetId] = useState<string | null>(null);
  const [dmLoading, setDmLoading] = useState(false);
  const [dmError, setDmError] = useState<string | null>(null);
  const [dmMsgs, setDmMsgs] = useState<DMMessage[]>([]);
  const [dmInput, setDmInput] = useState("");
  const dmEndRef = useRef<HTMLDivElement | null>(null);
 
  const [threads, setThreads] = useState<Thread[]>(ssGet<Thread[]>(`profile:${uid}:threads`, []));
  const [threadQuery, setThreadQuery] = useState("");
  const threadQueryDeferred = useDeferredValue(threadQuery);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // --- Stats ---
  const [groupsCreated, setGroupsCreated] = useState<number>(0);
  const [groupsJoined, setGroupsJoined] = useState<number>(0);
  const [gamesTotal, setGamesTotal] = useState<number>(0);
  const [gameStats, setGameStats] = useState<GameStat[]>([]);
 
  // --- Group & Friend Previews ---
  const [createdPreview, setCreatedPreview] = useState<PreviewGroup[]>([]);
  const [joinedPreview, setJoinedPreview] = useState<PreviewGroup[]>([]);
  const [groupFilter, setGroupFilter] = useState<'created' | 'joined' | 'all'>('created');
  const [friends, setFriends] = useState<FriendShipRow[]>([]);
  const [friendProfiles, setFriendProfiles] =
    useState<Map<string, { name: string; avatar_url: string | null }>>(new Map());

  // --- Notifications ---
  const [incomingRequests, setIncomingRequests] = useState<any[]>([]); // Using 'any' to match original
  const [groupInvites, setGroupInvites] = useState<GroupInvite[]>([]);
  const [groupNotifs, setGroupNotifs] = useState<GroupMsgNotif[]>([]);

  // --- Other User's Data ---
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
  const [viewFriendStatus, setViewFriendStatus] = useState<'none' | 'pending_in' | 'pending_out' | 'accepted' | 'blocked'>('none');
 
  // --- ADDED THIS STATE ---
  const [otherUserGamesTotal, setOtherUserGamesTotal] = useState<number>(0);
  const [theirFriendCount, setTheirFriendCount] = useState<number>(0);

  // --- UI ---
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [viewBusy, setViewBusy] = useState(false);

  // --- Derived State ---
  const headerName = viewingOther ? (viewName || (routeUserId ? routeUserId.slice(0,6) : '')) : (name || email || '');
  const headerAvatar = viewingOther ? viewAvatar : avatarUrl;
  const headerRatingAvg = viewingOther ? viewRatingAvg : ratingAvg;
  const headerRatingCount = viewingOther ? viewRatingCount : ratingCount;
  const headerInitials = (headerName || '?').slice(0, 2).toUpperCase() ?? '?';

  const notifCount = useMemo(
    () => incomingRequests.length + groupInvites.length + groupNotifs.length,
    [incomingRequests, groupInvites, groupNotifs]
  );
 
  // Merge DM threads with accepted friends for sidebar
  const sidebarItems = useMemo<Thread[]>(() => {
    const tMap = new Map<string, Thread>();
    threads.forEach(t => tMap.set(t.other_id, t));

    const out: Thread[] = [...threads];
    const friendIds = friends.map(f => (f.user_id_a === uid ? f.user_id_b : f.user_id_a));

    friendIds.forEach(fid => {
      if (tMap.has(fid)) return; // already in thread list
      if (!uid) return; // guard
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

  // Build friend options (accepted friends) for autocomplete
  const friendOptions = useMemo(() => {
    const ids = friends.map(f => (f.user_id_a === uid ? f.user_id_b : f.user_id_a));
    return ids.map(id => ({
      id,
      name: friendProfiles.get(id)?.name || id.slice(0, 6),
      avatar_url: friendProfiles.get(id)?.avatar_url ?? null,
    }));
  }, [friends, friendProfiles, uid]);

  // Resolve display for current DM target
  const dmDisplay = useMemo(() => {
    if (!dmTargetId) return { name: "", avatar: null as string | null };
    const t = sidebarItems.find(x => x.other_id === dmTargetId);
    if (t) return { name: t.name, avatar: t.avatar_url };
    const p = friendProfiles.get(dmTargetId);
    return { name: p?.name || dmTargetId.slice(0,6), avatar: p?.avatar_url ?? null };
  }, [dmTargetId, sidebarItems, friendProfiles]);
 
  const unreadThreads = useMemo(() => threads.filter(t => t.unread), [threads]);

  // --- Rating logic ---
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
 
  // --- Data Loading Effects ---

  // Main data loader
  useEffect(() => {
    let off = false;
   
    // Fetches core data for the logged-in user
    async function loadMyProfile(myUid: string, myEmail: string) {
      setLoading(true);
      setErr(null);

      // Pre-hydrate UI from session cache
      const CK_CREATED = `profile:${myUid}:createdPreview`;
      const CK_JOINED  = `profile:${myUid}:joinedPreview`;
      const CK_THREADS = `profile:${myUid}:threads`;
      setCreatedPreview(ssGet<PreviewGroup[]>(CK_CREATED, []));
      setJoinedPreview(ssGet<PreviewGroup[]>(CK_JOINED,  []));
      setThreads(ssGet<Thread[]>(CK_THREADS, []));
      
      const [profResp, createdCountResp, joinedCountResp] = await Promise.all([
        supabase
          .from("profiles")
          .select("name, avatar_url, city, onboarded, rating_avg, rating_count")
          .eq("user_id", myUid)
          .maybeSingle(),
        supabase
          .from("group_members")
          .select("*", { count: "exact", head: true })
          .eq("user_id", myUid)
          .eq("status", "active")
          .in("role", ["owner", "host"]),
        supabase
          .from("group_members")
          .select("*", { count: "exact", head: true })
          .eq("user_id", myUid)
          .eq("status", "active"),
      ]);

      if (off) return;

      const prof: any = profResp.data || {};
      setName(prof?.name ?? "");
      setAvatarUrl(prof?.avatar_url ?? null);
      setCity(prof?.city ?? "");
      setOnboarded(Boolean(prof?.onboarded ?? false));
      setRatingAvg(Number(prof?.rating_avg ?? 0));
      setRatingCount(Number(prof?.rating_count ?? 0));
      setGroupsCreated((createdCountResp.count as number | null) ?? 0);
      setGroupsJoined((joinedCountResp.count as number | null) ?? 0);
      setLoading(false);

      // Start non-blocking background fetches
      fetchBackgroundData(myUid);
    }

    // Fetches core data for another user
    async function loadOtherProfile(otherId: string) {
      setLoading(true);
      setErr(null);
      
      const { data: prof } = await supabase
        .from("profiles")
        .select("user_id, name, avatar_url, allow_ratings, rating_avg, rating_count")
        .eq("user_id", otherId)
        .maybeSingle();
      
      if (off) return;
      if (!prof) {
        setErr("User not found.");
        setLoading(false);
        return;
      }
      
      setViewName((prof as any)?.name ?? otherId.slice(0, 6));
      setViewAvatar((prof as any)?.avatar_url ?? null);
      setViewAllowRatings(Boolean((prof as any)?.allow_ratings ?? true));
      setViewRatingAvg(Number((prof as any)?.rating_avg ?? 0));
      setViewRatingCount(Number((prof as any)?.rating_count ?? 0));

      // --- ADDED THIS BLOCK ---
      // Fetch game count for the other user
      const { data: gmRows, count } = await supabase
       .from("group_members")
       .select("group_id", { count: "exact" }) // Just get the count
       .eq("user_id", otherId); // <-- Use otherId (routeUserId)
      
      if (off) return;
      setOtherUserGamesTotal(count ?? 0); // Use count directly
      // --- END OF ADDED BLOCK ---
      
      setLoading(false);
      
      // Fetch other user's background data
      fetchBackgroundData(otherId, true);
    }
   
    // Fetches heavy data that isn't needed for the initial paint
    async function fetchBackgroundData(targetUid: string, isViewingOther: boolean = false) {
        // --- Created Groups Preview ---
        const { data: createdMemberships } = await supabase
          .from("group_members")
          .select("group_id, created_at")
          .eq("user_id", targetUid)
          .eq("status", "active")
          .in("role", ["owner", "host"])
          .order("created_at", { ascending: false })
          .limit(20);
        const createdIds = Array.from(new Set((createdMemberships ?? []).map((r: any) => r.group_id))).filter(Boolean);
        let createdGroups: any[] = [];
        if (createdIds.length) {
          const { data: cg } = await supabase
            .from("groups")
            .select("id,title,game,category,created_at, code")
            .in("id", createdIds)
            .order("created_at", { ascending: false })
            .limit(20);
          createdGroups = cg ?? [];
        }
        if (off) return;
        const seenC = new Set<string>();
        const uniqueC = createdGroups.filter((g: any) => g?.id && !seenC.has(g.id) && seenC.add(g.id)).slice(0, 5);
        if (isViewingOther) {
          // TODO: need to store this in otherUserData state
          // [Correction]: Set `createdPreview` regardless, as it's used by `visibleGroups`
          setCreatedPreview(uniqueC as PreviewGroup[]);
        } else {
          setCreatedPreview(uniqueC as PreviewGroup[]);
          ssSet(`profile:${targetUid}:createdPreview`, uniqueC);
        }

        // --- Joined Groups Preview (ONLY for me) ---
        if (!isViewingOther) {
          const { data: joinedMemberships } = await supabase
            .from("group_members")
            .select("group_id, created_at")
            .eq("user_id", targetUid)
            .eq("status", "active")
            .order("created_at", { ascending: false })
            .limit(20);
          const joinedIds = Array.from(new Set((joinedMemberships ?? []).map((r: any) => r.group_id))).filter(Boolean);
          let joinedGroups: any[] = [];
          if (joinedIds.length) {
            const { data: jg } = await supabase
              .from("groups")
              .select("id,title,game,category,created_at, code")
              .in("id", joinedIds)
              .order("created_at", { ascending: false })
              .limit(20);
            joinedGroups = jg ?? [];
          }
          if (off) return;
          const seenJ = new Set<string>();
          const uniqueJ = joinedGroups.filter((g: any) => g?.id && !seenJ.has(g.id) && seenJ.add(g.id)).slice(0, 5);
          setJoinedPreview(uniqueJ as PreviewGroup[]);
          ssSet(`profile:${targetUid}:joinedPreview`, uniqueJ);
        }

        // --- Game Stats (for modal) ---
        const { data: gmRows } = await supabase
         .from("group_members")
         .select("group_id, groups(game)")
         .eq("user_id", targetUid);
        if (off) return;
        const counts = new Map<string, number>();
        (gmRows ?? []).forEach((r: any) => {
          const gname = (r?.groups?.game || "Unknown") as string;
          counts.set(gname, (counts.get(gname) || 0) + 1);
        });
        const arr: GameStat[] = Array.from(counts.entries()).map(([game, count]) => ({ game, count }));
        arr.sort((a, b) => b.count - a.count || a.game.localeCompare(b.game));
        setGameStats(arr);
        if (!isViewingOther) {
            setGamesTotal((gmRows ?? []).length); // Only set my total
        }
       
        // --- Friend & DM Data (ONLY for me) ---
        if (!isViewingOther) {
          loadThreadsAndFriends(targetUid);
          refreshFriendRequests(targetUid);
          refreshGroupSignals(targetUid);
        }
    }
   
    // --- Friend/DM Loader ---
    async function loadThreadsAndFriends(myUid: string) {
      // threads: latest 100 to reduce payload, then hydrate names
      const { data: recent } = await supabase
        .from("direct_messages")
        .select("from_id,to_id,body,created_at")
        .or(`from_id.eq.${myUid},to_id.eq.${myUid}`)
        .order("created_at", { ascending: false })
        .limit(40);
      if (off) return;
      
      const map = new Map<string, { last_body: string; last_at: string; last_from_me: boolean }>();
      (recent ?? []).forEach((m: any) => {
        const other = m.from_id === myUid ? m.to_id : m.from_id;
        if (!map.has(other)) {
          map.set(other, { last_body: m.body, last_at: m.created_at, last_from_me: m.from_id === myUid });
        }
      });
      const otherIds = Array.from(map.keys());
      let profMap = new Map<string, ProfileStub>();
      if (otherIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id,name,avatar_url")
          .in("user_id", otherIds);
        if (off) return;
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
      if (!off) {
        setThreads(threadList);
        ssSet(`profile:${myUid}:threads`, threadList);
      }

      // Load accepted friends
      const { data: fr } = await supabase
        .from("friendships")
        .select("id,user_id_a,user_id_b,status,requested_by")
        .or(`user_id_a.eq.${myUid},user_id_b.eq.${myUid}`)
        .eq("status", "accepted");
      if (off) return;
      setFriends((fr ?? []) as any);

      // Load friend profiles
      const friendIds = new Set<string>();
      (fr ?? []).forEach(r => friendIds.add(r.user_id_a === myUid ? r.user_id_b : r.user_id_a));
      if (friendIds.size) {
        const { data: profs } = await supabase.from("profiles").select("user_id,name,avatar_url").in("user_id", [...friendIds]);
        if (off) return;
        const m = new Map<string, ProfileStub>();
        (profs ?? []).forEach((p:any) => m.set(p.user_id, { name: p.name ?? "", avatar_url: p.avatar_url ?? null }));
        setFriendProfiles(m);
      }
    }
   
    async function refreshFriendRequests(myUid: string) {
       const { data: incoming } = await supabase
         .from("friendships")
         .select("id,user_id_a,user_id_b,status,requested_by, profiles!friendships_user_id_a_fkey(name, avatar_url)") // Get requestor profile
         .eq("user_id_b", myUid) // Requests TO me
         .eq("status", "pending");
       if (off) return;
       setIncomingRequests((incoming ?? []) as any);
    }
   
    async function refreshGroupSignals(myUid: string) {
      const { data: inv } = await supabase
        .from("group_members")
        .select("group_id, role, status, created_at, groups(title)")
        .eq("user_id", myUid)
        .in("status", ["pending", "invited"])
        .order("created_at", { ascending: false })
        .limit(50);
      if (off) return;
      setGroupInvites((inv ?? []).map((r: any) => ({
        group_id: r.group_id,
        group_title: r.groups?.title ?? null,
        role: r.role ?? null,
        status: r.status ?? "pending",
        invited_at: r.created_at,
      })));

      const { data: gm } = await supabase
        .from("group_members")
        .select("group_id")
        .eq("user_id", myUid)
        .eq("status", "active");
      const gIds = (gm ?? []).map((r: any) => r.group_id);
      
      let notifs: GroupMsgNotif[] = [];
      if (gIds.length) {
        const { data: msgs } = await supabase
          .from("group_messages")
          .select("group_id, content:body, created_at, groups(title), user_id")
          .in("group_id", gIds)
          .neq("user_id", myUid)
          .order("created_at", { ascending: false })
          .limit(20);
        if (off) return;
        notifs = (msgs ?? []).map((m: any) => ({
          group_id: m.group_id,
          group_title: m.groups?.title ?? null,
          preview: String(m.content || "").slice(0, 120),
          created_at: m.created_at,
        }));
      }
      if (!off) setGroupNotifs(notifs);
    }
   
    // --- Auth check and main loader initiation ---
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const myUid = auth?.user?.id || null;
      const myEmail = auth?.user?.email || null;
      if (off) return;

      if (!myUid) {
        setLoading(false);
        setErr("Please sign in.");
        navigate("/onboarding");
        return;
      }
      
      setUid(myUid);
      setEmail(myEmail);
      
      const theme = localStorage.getItem('theme') as 'system'|'light'|'dark' | null;
      if (theme) applyTheme(theme);

      if (routeUserId && routeUserId !== myUid) {
        // We are viewing someone else's profile
        loadOtherProfile(routeUserId);
      } else {
        // We are viewing our own profile
        loadMyProfile(myUid, myEmail!);
      }
    })();

    return () => { off = true; };
  }, [routeUserId, navigate]); // Re-run if the URL param changes

  // Realtime listener for DMs
  useEffect(() => {
    if (!uid) return;
    const channel = supabase
      .channel(`dm:${uid}`)
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'direct_messages',
        filter: `to_id=eq.${uid}` // Only listen for messages TO me
      }, (payload) => {
        const m = payload.new as DMMessage;
        // If we are in this thread, add the message
        if (m.from_id === dmTargetId) {
          setDmMsgs(prev => [...prev, m]);
        }
        // Update the thread list
        setThreads(prev => {
          const other = prev.find(t => t.other_id === m.from_id);
          const rest = prev.filter(t => t.other_id !== m.from_id);
          const name = other?.name || friendProfiles.get(m.from_id)?.name || m.from_id.slice(0,6);
          const avatar = other?.avatar_url || friendProfiles.get(m.from_id)?.avatar_url || null;
          
          const updated = {
              other_id: m.from_id,
              name: name,
              avatar_url: avatar,
              last_body: m.body,
              last_at: m.created_at,
              last_from_me: false,
              unread: m.from_id !== dmTargetId, // Mark as read if thread is open
          };
          return [updated, ...rest];
        });
      })
      .subscribe();
      
    return () => { supabase.removeChannel(channel); };
  }, [uid, dmTargetId, friendProfiles]);

  // --- Other Effects ---

  // Open/close sidebar based on hash
  useLayoutEffect(() => {
    if (location.hash === "#chat") {
      setSidebarOpen(true);
    }
  }, [location.key, location.hash]);

  // Open/close sidebar based on global event
  useEffect(() => {
    const handler = () => setSidebarOpen(true);
    window.addEventListener('open-chat' as any, handler);
    return () => window.removeEventListener('open-chat' as any, handler);
  }, []);

  // Close popovers on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (notifOpen && notifRef.current && !notifRef.current.contains(t)) {
        setNotifOpen(false);
      }
      if (sidebarOpen && sidebarRef.current && !sidebarRef.current.contains(t)) {
        setSidebarOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [notifOpen, sidebarOpen]);
 
  // --- DM functions ---
 
  const openThread = useCallback(async (otherId: string) => {
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
    if (data) {
      setDmMsgs((prev) => [...prev, data!]);
    }
    // Also update the thread list
    setThreads(prev => {
        const other = prev.find(t => t.other_id === dmTargetId);
        const rest = prev.filter(t => t.other_id !== dmTargetId);
        const updated = {
            ...(other || { other_id: dmTargetId, name: dmDisplay.name, avatar_url: dmDisplay.avatar, unread: false }),
            last_body: body,
            last_at: data ? data.created_at : new Date().toISOString(),
            last_from_me: true,
        };
        return [updated, ...rest];
    });
  }
 
  // --- View Other Profile Modal Functions ---
 
  async function openProfileView(otherId: string) {
    if (viewOpen && viewUserId === otherId) return; // already open
    setViewBusy(true);
    setViewOpen(true);
    setViewUserId(otherId);
    setErr(null);
    setRateBusy(false);
    setHoverRating(null);

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

    // Prefill my existing rating + window status
    await loadPairStatus(otherId);

    // Load friend status
    const { data: rel } = await supabase
      .from("friendships")
      .select("id,user_id_a,user_id_b,status,requested_by")
      // [FIX] Use `otherId` (argument) not `viewUserId` (state)
      .or(`and(user_id_a.eq.${uid},user_id_b.eq.${otherId}),and(user_id_a.eq.${otherId},user_id_b.eq.${uid})`)
      .limit(1)
      .maybeSingle();

    // [NEW] Get their friend count
    const { data: fr } = await supabase
      .from('friendships')
      .select('id')
      .or(`user_id_a.eq.${otherId},user_id_b.eq.${otherId}`)
      .eq('status', 'accepted');
    setTheirFriendCount(fr?.length || 0);

    // [FIX] Define FriendState type
    type FriendState = 'none' | 'pending_in' | 'pending_out' | 'accepted' | 'blocked';
    let st: FriendState = 'none';
    if (rel) {
      if (rel.status === 'accepted') st = 'accepted';
      else if (rel.status === 'blocked') st = 'blocked';
      else if (rel.status === 'pending') {
        st = rel.requested_by === uid ? 'pending_out' : 'pending_in';
      }
    }
    setViewFriendStatus(st);
    setViewBusy(false);
  }
 
  // --- Notification Handlers ---
 
  const acceptFriend = async (fromId: string) => {
    try {
      const { error: rpcErr } = await supabase.rpc("accept_friend", { from_id: fromId });
      if (rpcErr) throw rpcErr;
      if (uid) setIncomingRequests(prev => prev.filter(r => r.user_id_a !== fromId));
      success('Friend request accepted');
    } catch (e: any) {
      error(e?.message || 'Could not accept friend request');
    }
  };

  const removeFriend = async (otherId: string) => {
    try {
      const { error: rpcErr } = await supabase.rpc("remove_friend", { other_id: otherId });
      if (rpcErr) throw rpcErr;
      if (uid) setIncomingRequests(prev => prev.filter(r => r.user_id_a !== otherId));
      success('Removed');
    } catch (e: any) {
      error(e?.message || 'Could not remove friend');
    }
  };
 
  const sendFriendRequest = async (targetId: string) => {
    try {
      const { error: rpcErr } = await supabase.rpc("request_friend", { target_id: targetId });
      if (rpcErr) throw rpcErr;
      setViewFriendStatus('pending_out');
      success('Friend request sent');
    } catch (e: any) {
      error(e?.message || 'Could not send friend request');
    }
  };

  const acceptGroupInvite = async (gid: string) => {
    if (!uid) return;
    const { error } = await supabase
      .from("group_members")
      .update({ status: "active" })
      .eq("group_id", gid)
      .eq("user_id", uid);
    if (error) {
      // try recovery
      try {
        await supabase.from("group_members").delete().eq("group_id", gid).eq("user_id", uid);
        await supabase.from("group_members").insert({ group_id: gid, user_id: uid, status: "active", role: "member" });
      } catch {}
    }
    setGroupInvites(prev => prev.filter(inv => inv.group_id !== gid));
  };

  const declineGroupInvite = async (gid: string) => {
    if (!uid) return;
    await supabase.from("group_members").delete().eq("group_id", gid).eq("user_id", uid);
    setGroupInvites(prev => prev.filter(inv => inv.group_id !== gid));
  };

  const openGroup = (gid: string) => {
    setGroupNotifs(prev => prev.filter(n => n.group_id !== gid));
    setNotifOpen(false);
    navigate(`/group/${gid}`);
  };
 
  // --- Settings Modal Functions ---
 
  // Load settings modal data only when opened
  useEffect(() => {
    if (!settingsOpen || !uid) return;
    // Load LS settings
    const LS_THEME = localStorage.getItem('theme') as 'system'|'light'|'dark' | null;
    if (LS_THEME) setSTheme(LS_THEME);
    const LS_EMAIL = localStorage.getItem('emailNotifs');
    if (LS_EMAIL) setEmailNotifs(LS_EMAIL === '1');
    const LS_PUSH = localStorage.getItem('pushNotifs');
    if (LS_PUSH) setPushNotifs(LS_PUSH === '1');
    // Load profile data
    (async () => {
      const { data: p, error } = await supabase
        .from("profiles")
        .select("name, city, timezone, interests, avatar_url, allow_ratings")
        .eq("user_id", uid)
        .maybeSingle();
      if (error) { setSettingsMsg(error.message); return; }
      const name = (p as any)?.name ?? "";
      setSName(name);
      setSCity((p as any)?.city ?? "");
      setSTimezone((p as any)?.timezone ?? deviceTZ());
      const ints = Array.isArray((p as any)?.interests) ? ((p as any).interests as string[]) : [];
      setSInterests(ints.join(", "));
      setAvatarUrl((p as any)?.avatar_url ?? null);
      setAllowRatings((p as any)?.allow_ratings ?? true);
    })();
  }, [settingsOpen, uid]);

  async function saveSettings() {
    if (!uid) return;
    setSettingsMsg(null);
    setSettingsSaving(true);
    try {
      // sanitize
      const name = sName.trim();
      if (!name) { setSettingsMsg("Name cannot be empty."); setSettingsSaving(false); return; }
      const city = sCity.trim();
      if (!city) { setSettingsMsg("Please choose a city."); setSettingsSaving(false); return; }
      const timezone = sTimezone.trim() || "UTC";
      const interests = sInterests.split(",").map(s => s.trim()).filter(Boolean);

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ name, city, timezone, interests, allow_ratings: allowRatings, onboarded: true })
        .eq("user_id", uid);

      if (updateError) throw updateError;
      
      // Save theme/notifs to localStorage
      localStorage.setItem('theme', sTheme);
      localStorage.setItem('emailNotifs', emailNotifs ? '1' : '0');
      localStorage.setItem('pushNotifs', pushNotifs ? '1' : '0');
      applyTheme(sTheme);

      // Update local page state (optimistic)
      setName(name);
      setCity(city);
      setOnboarded(true);

      setSettingsMsg("Saved.");
      success('Profile saved');
      setSettingsDirty(false);
      
      // Auto-close after 1 sec
      setTimeout(() => {
        setSettingsOpen(false);
        setSettingsMsg(null);
      }, 1000);
      
    } catch (err: any) {
      const msg = err?.message || "Failed to save";
      setSettingsMsg(msg);
      error(msg);
    } finally {
      setSettingsSaving(false);
    }
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
        setAvatarUrl(url); // update page and modal
      }
    } catch (e) {
      console.error(e);
      setSettingsMsg('Avatar upload failed');
    } finally {
      setAvatarUploading(false);
    }
  }
 
  function applyTheme(theme: 'system'|'light'|'dark') {
    const root = document.documentElement;
    root.classList.remove('light','dark');
    if (theme === 'light') root.classList.add('light');
    else if (theme === 'dark') root.classList.add('dark');
  }
 
  async function rateUser(n: number) {
    if (!uid || !viewUserId || rateBusy) return;
    if (!(cooldownSecs === 0 || canEditOnce)) return;

    const v = Math.max(1, Math.min(6, Math.round(n)));
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

  async function logout() {
    try {
      await supabase.auth.signOut();
    } catch {}
    try {
      localStorage.removeItem('onboardingSeen');
      sessionStorage.clear();
    } catch {}
    const base = `${window.location.origin}${import.meta.env.BASE_URL}`;
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
    } catch {}
    window.location.replace(base);
  }
 
  // --- Render ---

  if (loading) return (
    <div className="mx-auto max-w-4xl px-4 py-8 text-sm text-neutral-600">Loading profile…</div>
  );
  if (err) return (
    <div className="mx-auto max-w-4xl px-4 py-8 text-sm text-red-600">{err}</div>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 pt-16 md:pt-20 pb-0">
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* --- Main Content --- */}
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
              <div
                className="mt-1 flex items-center gap-3 text-sm text-neutral-700"
                title={`${headerRatingAvg.toFixed(1)} / 6 from ${headerRatingCount} ratings`}
              >
                <span className="inline-flex items-center gap-1">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <span key={i}>
                      {i < Math.round(headerRatingAvg || 0) ? '★' : '☆'}
                    </span>
                  ))}
                  <span className="ml-1 text-xs text-neutral-500">
                    ({headerRatingCount || 0})
                  </span>
                </span>
                {viewingOther && (
                  <button onClick={() => openProfileView(routeUserId!)} className="text-xs text-emerald-700 hover:underline">Rate</button>
                )}
              </div>
              {!viewingOther && (
                <div className="mt-2 flex items-center gap-2">
                  <div ref={notifRef} className="relative">
                    <button
                      onClick={() => navigate("/notifications")}
                      className="ml-2 inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1.5 text-sm hover:bg-black/[0.04]"
                      title="Notifications"
                      aria-label="Notifications"
                    >
                      <span className="text-base">🔔</span>
                      {notifCount > 0 && (
                        <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-white text-xs leading-none">{notifCount}</span>
                      )}
                    </button>
                  </div>
                  <button
                    onClick={() => setSettingsOpen(true)}
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
            <StatCard label="Groups Created" value={groupsCreated} onClick={!viewingOther ? () => setGroupFilter('created') : undefined} />
            {/* --- [FIX] Use `otherUserGamesTotal` when viewing other profiles --- */}
            <StatCard 
              label="Games Played" 
              value={viewingOther ? otherUserGamesTotal : gamesTotal} 
              onClick={() => setGamesModalOpen(true)} 
            />
          </div>

          {/* Groups + Friends side-by-side */}
          <section className="mt-8 space-y-3">
            {!viewingOther && (
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
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <Card
                title={
                  viewingOther 
                    ? "Groups" 
                    : groupFilter === 'created' ? 'Created by me' : groupFilter === 'joined' ? 'Joined' : 'All my groups'
                }
                count={visibleCount}
                empty="No groups yet."
              >
                {visibleGroups.map((g) => {
                  const gid = (g as any)?.id ?? (g as any)?.group_id ?? (g as any)?.group?.id ?? (g as any)?.groups?.id;
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
                  const handleOpen = () => { setSidebarOpen(true); openThread(t.other_id); };
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
  onView={() => openProfileView(t.other_id)}
/>
                  );
                })}
              </Card>
            </div>
          </section>
        </div>

        {/* --- DM Sidebar --- */}
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
                                  onClick={() => openProfileView(o.id)}
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
       
        {/* DM Floating Button */}
        {!viewingOther && !sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="fixed bottom-4 right-4 z-40 h-12 w-12 rounded-full bg-emerald-600 text-white shadow-lg flex items-center justify-center hover:bg-emerald-700 transition relative"
            title="Open chat"
            aria-label="Open chat"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
              <path d="M3.25 6.75A2.75 2.75 0 0 1 6 4h12a2.75 2.75 0 0 1 2.75 2.75v6.5A2.75 2.75 0 0 1 18 16H9.414a1.75 1.75 0 0 0-1.238.512l-2.476 2.476A.75.75 0 0 1 4 18.75V6.75z" />
            </svg>
            {unreadThreads.length > 0 && (
              <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white ring-2 ring-white">
                {unreadThreads.length}
              </span>
            )}
          </button>
        )}
      </div>

      {/* --- Games Played Modal --- */}
      {gamesModalOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40">
          <div className="w-[95vw] sm:w-[480px] md:w-[560px] rounded-2xl border border-black/10 bg-white p-5 shadow-xl relative">
            <button
              onClick={() => setGamesModalOpen(false)}
              className="absolute top-3 right-3 text-neutral-500 hover:text-neutral-800 text-xl"
            >
              ×
            </button>
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
              {/* --- [FIX] Use correct total for modal --- */}
              Total sessions joined: <span className="font-medium text-neutral-900">{viewingOther ? otherUserGamesTotal : gamesTotal}</span>
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
                      // [FIX] Use correct total for percentage calculation
                      const total = viewingOther ? otherUserGamesTotal : gamesTotal;
                      const pct = total > 0 ? Math.round((g.count / total) * 100) : 0;
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

      {/* --- Settings Modal --- */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40">
          <form
            onSubmit={(e) => { e.preventDefault(); saveSettings(); }}
            className="w-[560px] max-w-[92vw] rounded-2xl border border-black/10 bg-white shadow-xl max-h-[90vh] overflow-hidden flex flex-col"
          >
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

              <div className="mb-2 flex items-center justify-between">
                <div className="text-base font-semibold text-neutral-900">Edit Profile</div>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  className="rounded-md border border-black/10 px-2 py-1 text-sm"
                >
                  Close
                </button>
              </div>

              <div className="rounded-xl border border-black/5 bg-neutral-50/80 p-4 shadow-inner space-y-4">
                <div className="text-sm font-semibold text-neutral-700">Profile</div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-neutral-800">Name</label>
                  <input
                    value={sName}
                    onChange={(e) => { setSName(e.target.value); setSettingsDirty(true); }}
                    className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm focus:border-emerald-600"
                    placeholder="Your name"
                    required
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-neutral-800">Avatar</label>
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-neutral-200 grid place-items-center overflow-hidden">
                      {avatarUrl ? (
                        <img src={avatarUrl} alt="" className="h-10 w-10 object-cover" />
                      ) : (
                        <span className="text-xs">{headerInitials}</span>
                      )}
                    </div>
                    <input type="file" accept="image/*" onChange={onAvatarChange} className="text-sm" />
                    {avatarUploading && <span className="text-xs text-neutral-600">Uploading…</span>}
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-neutral-800">City</label>
                    <input
                      value={sCity}
                      onChange={(e) => { setSCity(e.target.value); setSettingsDirty(true); }}
                      onBlur={() => { if (!sTimezone || sTimezone === "UTC") setSTimezone(deviceTZ()); }}
                      className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm focus:border-emerald-600"
                      placeholder="Start typing… e.g., Berlin"
                      list="cities-de"
                      required
                    />
                    <datalist id="cities-de">
                      {DE_CITIES.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-neutral-800">Timezone</label>
                    <input
                      value={sTimezone}
                      onChange={(e) => { setSTimezone(e.target.value); setSettingsDirty(true); }}
                      className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm focus:border-emerald-600"
                      placeholder="e.g., Europe/Berlin"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-neutral-800">Interests</label>
                  <input
                    value={sInterests}
                    onChange={(e) => { setSInterests(e.target.value); setSettingsDirty(true); }}
                    className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm focus:border-emerald-600"
                    placeholder="comma, separated, tags"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-black/5 bg-neutral-50/80 p-4 shadow-inner space-y-3">
                <div className="text-sm font-semibold text-neutral-700">Appearance & Privacy</div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-neutral-800">Theme</label>
                  <select
                    value={sTheme}
                    onChange={(e) => setSTheme(e.target.value as 'system'|'light'|'dark')}
                    className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm focus:border-emerald-600"
                  >
                    <option value="system">System</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </div>

                <div className="flex items-center justify-between gap-2 rounded-lg border border-black/5 bg-white px-3 py-2">
                  <div>
                    <div className="text-sm font-medium text-neutral-800">Allow profile ratings</div>
                    <div className="text-[11px] text-neutral-500">Others can rate you when enabled.</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => saveAllowRatings(!allowRatings)}
                    className={`h-7 w-12 rounded-full ${allowRatings ? 'bg-emerald-600' : 'bg-neutral-300'} relative`}
                  >
                    <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition ${allowRatings ? 'right-0.5' : 'left-0.5'}`} />
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-black/5 bg-neutral-50/80 p-4 shadow-inner space-y-3">
                <div className="text-sm font-semibold text-neutral-700">Notifications</div>

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
              </div>

              {settingsMsg && (
                <div className={`rounded-md border px-3 py-2 text-sm ${settingsMsg === 'Saved.' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
                  {settingsMsg}
                </div>
              )}

            </div>

            <div className="shrink-0 px-5 py-3 border-t border-black/10 space-y-3">
              <div className="flex justify-end gap-2">
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

              <button
                type="button"
                onClick={logout}
                className="w-full rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 hover:bg-red-100"
              >
                Sign Out
              </button>
            </div>

          </form>
        </div>
      )}

      {/* --- View Other Profile Modal --- */}
      {viewOpen && viewUserId && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40">
          <div className="w-[95vw] sm:w-[480px] md:w-[560px] rounded-2xl border border-black/10 bg-white p-5 shadow-xl relative">
            <button
              onClick={() => setViewOpen(false)}
              className="absolute top-3 right-3 text-neutral-500 hover:text-neutral-800 text-xl"
            >
              ×
            </button>
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
                        <span className="ml-1 text-[11px] text-neutral-500">({viewRatingCount})</span>
                      </div>
                    </div>
                  </div>
                  {/* <div className="text-xs text-neutral-600">{viewUserId}</div> */}
                </div>
              </div>
              <button onClick={() => setViewOpen(false)} className="rounded-md border border-black/10 px-2 py-1 text-sm">Close</button>
            </div>
           
            {err && <div className="mb-2 text-xs text-red-600">{err}</div>}

            <div className="space-y-3">
              <div className="rounded-md border border-black/10 p-3 text-sm">
                <div className="mb-2 font-medium text-neutral-800">Friend status</div>
                {viewFriendStatus === 'accepted' && (
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-700">You are friends.</span>
                    <button
                      onClick={() => removeFriend(viewUserId)}
                      className="ml-2 rounded-md border border-black/10 px-3 py-1.5 text-sm"
                    >
                      Remove
                    </button>
                  </div>
                )}
                {viewFriendStatus === 'pending_in' && (
                  <div className="flex items-center gap-2">
                    <span className="text-neutral-700">This user sent you a request.</span>
                    <button
                      onClick={() => acceptFriend(viewUserId)}
                      className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white"
                    >Accept</button>
                  </div>
                )}
                {viewFriendStatus === 'pending_out' && <div className="text-neutral-700">You sent a friend request.</div>}
                {viewFriendStatus === 'none' && (
                  <button
                    onClick={() => sendFriendRequest(viewUserId)}
                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white"
                  >Add Friend</button>
                )}
              </div>
              {/* --- Extra Info: Groups & Shared Groups --- */}
              <div className="mt-4 rounded-md border border-black/10 p-3 text-sm space-y-2">
                <div className="font-medium text-neutral-800">Group Activity</div>

                <div className="text-neutral-700">
                  <b>Total groups joined:</b> {otherUserGamesTotal}
                </div>

                <div className="text-neutral-700">
                  <b>Rating:</b> {viewRatingAvg.toFixed(1)} / 6  
                  <span className="text-neutral-500"> ({viewRatingCount} ratings)</span>
                </div>
                <div className="text-neutral-700">
                  <b>Total friends:</b> {theirFriendCount}
                </div>

                {/* Shared groups */}
                <div className="mt-3">
                  <div className="font-medium text-neutral-800">Groups you both joined:</div>
                  {!uid || !viewUserId ? (
                    <div className="text-neutral-600 text-sm">Loading…</div>
                  ) : (
                    <SharedGroups me={uid} other={viewUserId} />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



// --- SharedGroups component for View Other Profile Modal ---
function SharedGroups({ me, other }: { me: string; other: string }) {
  const [groups, setGroups] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    (async () => {
      const { data: myGroups } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', me)
        .eq('status', 'active');

      const { data: theirGroups } = await supabase
        .from('group_members')
        .select('group_id, groups(title)')
        .eq('user_id', other)
        .eq('status', 'active');

      const mineSet = new Set(myGroups?.map(g => g.group_id));
      const shared = (theirGroups ?? []).filter(g => mineSet.has(g.group_id));

      setGroups(shared);
      setLoading(false);
    })();
  }, [me, other]);

  if (loading) return <div className="text-neutral-600 text-sm">Loading…</div>;
  if (groups.length === 0) return <div className="text-neutral-600 text-sm">No shared groups.</div>;

  return (
    <div className="flex flex-wrap gap-2 mt-1">
      {groups.map(g => (
        <div
          key={g.group_id}
          className="px-2 py-1 bg-neutral-100 text-neutral-800 text-xs rounded-md flex items-center gap-2"
        >
          {g.groups?.title || g.group_id.slice(0,6)}
          <Link to={`/group/${g.group_id}`} className="text-emerald-700 hover:underline text-[11px]">Open</Link>
        </div>
      ))}
    </div>
  );
}

// --- Re-usable Sub-Components ---

const StatCard = React.memo(function StatCard({ label, value, onClick }: { label: string; value: number; onClick?: () => void }) {
  const content = (
    <>
      <div className="text-sm text-neutral-600">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-neutral-900">{value}</div>
    </>
  );
 
  if (onClick) {
    return (
      <button onClick={onClick} className="w-full rounded-xl border border-black/10 bg-white p-4 text-left shadow-sm hover:shadow disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-sm" disabled={!onClick}>
        {content}
      </button>
    );
  }
 
  return (
    <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
      {content}
    </div>
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

const FriendRow = React.memo(function FriendRow({ _otherId, name, avatarUrl, lastBody, lastAt, unread, onOpen, onView }: {
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
          {/* --- This link allows clicking a friend's name to see their profile --- */}
          <button
  onClick={onView}
  className="font-medium text-neutral-900 hover:underline text-left"
>
  {name}
</button>
          <div className="text-xs text-neutral-600 truncate max-w-[220px]">{lastBody}</div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[10px] text-neutral-500">{timeAgo(lastAt)}</span>
        {unread && <span className="h-2 w-2 rounded-full bg-emerald-600" />}
        <button onClick={onOpen} className="text-sm text-emerald-700 hover:underline">Chat</button>
      </div>
    </li>
  );
}, propsShallowEqual);

const NotificationPopover = React.memo(function NotificationPopover(
  { incomingRequests, groupInvites, groupNotifs, uid, onAcceptFriend, onRemoveFriend, onAcceptGroup, onDeclineGroup, onOpenGroup }:
  { 
    incomingRequests: any[];
    groupInvites: GroupInvite[];
    groupNotifs: GroupMsgNotif[];
    uid: string;
    onAcceptFriend: (id: string) => void;
    onRemoveFriend: (id: string) => void;
    onAcceptGroup: (id: string) => void;
    onDeclineGroup: (id: string) => void;
    onOpenGroup: (id: string) => void;
  }
) {
  const notifCount = incomingRequests.length + groupInvites.length + groupNotifs.length;
 
  return (
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
                const profile = r.profiles; // Profile is now joined
                const nm = profile?.name || other.slice(0,6);
                return (
                  <li key={r.id} className="flex items-center justify-between rounded-md border border-black/10 px-2 py-1.5">
                    <span className="truncate text-sm text-neutral-800">{nm}</span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => onAcceptFriend(other)} className="rounded-md bg-emerald-600 px-2 py-0.5 text-xs text-white">Accept</button>
                      <button onClick={() => onRemoveFriend(other)} className="rounded-md border border-black/10 px-2 py-0.5 text-xs">Decline</button>
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
                    <button onClick={() => onAcceptGroup(gi.group_id)} className="rounded-md bg-emerald-600 px-2 py-0.5 text-xs text-white">Accept</button>
                    <button onClick={() => onDeclineGroup(gi.group_id)} className="rounded-md border border-black/10 px-2 py-0.5 text-xs">Decline</button>
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
                  <button onClick={() => onOpenGroup(gn.group_id)} className="shrink-0 rounded-md border border-black/10 px-2 py-0.5 text-xs">Open</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}, propsShallowEqual);
