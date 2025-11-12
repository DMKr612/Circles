import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../src/lib/supabase";

type ChatMessage = {
  id: string;
  group_id: string;
  user_id: string;
  content: string;
  created_at: string;
  parent_id: string | null;
  attachments: any[];
};

type Profile = { user_id: string; id?: string; name: string | null; avatar_url?: string | null };
type Member = { user_id: string; name: string | null; avatar_url?: string | null };
type Reaction = { id: string; message_id: string; user_id: string; emoji: string };
type ReadRow = { message_id: string; user_id: string; read_at: string };

type Props = { groupId: string; pageSize?: number; user?: any };

const relTime = (iso: string) => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); return d === 1 ? "yesterday" : `${d}d ago`;
};

const getUUID = () => {
  const g: any = (typeof globalThis !== "undefined" && (globalThis as any).crypto)
    ? (globalThis as any).crypto
    : null;
  return g && typeof g.randomUUID === "function"
    ? g.randomUUID()
    : Math.random().toString(36).slice(2);
};

const randomName = (file: File) => {
  const id = getUUID();
  return `${id}_${file.name}`;
};

type ChatPanelProps = {
  groupId: string;
  pageSize?: number;
  user?: any;
  onClose: () => void;
  full: boolean;
  setFull: (v: boolean) => void;
};

export default function ChatPanel({ groupId, pageSize = 30, user, onClose, full, setFull }: ChatPanelProps) {
  // base state
  const [me, setMe] = useState<string | null>(null);
  const [myProfile, setMyProfile] = useState<Profile | null>(null);
  const [myEmail, setMyEmail] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());

  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<Map<string, Record<string, string[]>>>(new Map()); // messageId -> {emoji: [user_ids]}
  const [reads, setReads] = useState<Map<string, string[]>>(new Map()); // messageId -> [user_ids]

  const [input, setInput] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);

  // presence/typing minimal
  const [onlineCount, setOnlineCount] = useState(0);
  const [someoneTyping, setSomeoneTyping] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const [members, setMembers] = useState<Member[]>([]);
  const [showMembers, setShowMembers] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const earliestTs = useMemo(() => (msgs.length ? msgs[0].created_at : null), [msgs]);

  // boot user + profile
  // seed me from prop if provided
  useEffect(() => {
    if (user?.id) setMe(user.id as string);
  }, [user]);

// Keep me/myProfile in sync with auth changes (login/logout)
useEffect(() => {
  const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, session) => {
    const uid = session?.user?.id ?? null;
    const email = session?.user?.email ?? null;

    setMe(uid);
    setMyEmail(email ?? null);
    if (!uid) return;

    // fetch or create profile
    const { data: p } = await supabase
      .from("profiles")
      .select("user_id,id,name,avatar_url")
      .eq("user_id", uid)
      .maybeSingle();

    if (p) {
      setMyProfile(p as any);
      setProfiles(prev => new Map(prev).set(p.user_id, p as any));
    } else {
      const fallbackName = (email ?? "").split("@")[0] || "Player";
      const { data: up } = await supabase
        .from("profiles")
        .upsert(
          { user_id: uid, name: fallbackName, city: "Unknown", timezone: "UTC" },
          { onConflict: "user_id" }
        )
        .select("user_id,id,name,avatar_url")
        .maybeSingle();

      if (up) {
        setMyProfile(up as any);
        setProfiles(prev => new Map(prev).set(up.user_id, up as any));
      }
    }
  });

  return () => { sub.subscription.unsubscribe(); };
}, []);

  // load messages + profiles + reactions + reads
  useEffect(() => {
  let aborted = false;

  async function fetchMissingProfiles(ids: string[]) {
    const missing = ids.filter(id => !profiles.has(id));
    if (!missing.length) return;
    const { data: profs } = await supabase
      .from("profiles")
      .select("user_id,id,name,avatar_url")
      .in("user_id", missing);
    if (profs) {
      setProfiles(prev => {
        const next = new Map(prev);
        for (const p of profs) next.set(p.user_id, p as Profile);
        return next;
      });
    }
  }

  async function preloadReactions(messageIds: string[]) {
    if (!messageIds.length) return;
    const { data: rows } = await supabase
      .from("group_message_reactions")
      .select("message_id,user_id,emoji")
      .in("message_id", messageIds);
    if (!rows) return;
    const map = new Map<string, Record<string, string[]>>();
    for (const r of rows) {
      const obj = map.get(r.message_id) ?? {};
      const arr = obj[r.emoji] ?? [];
      if (!arr.includes(r.user_id)) arr.push(r.user_id);
      obj[r.emoji] = arr;
      map.set(r.message_id, obj);
    }
    setReactions(map);
  }

  async function preloadReads(messageIds: string[]) {
    if (!messageIds.length) return;
    const { data: rows } = await supabase
      .from("group_message_reads")
      .select("message_id,user_id,read_at")
      .in("message_id", messageIds);
    if (!rows) return;
    const map = new Map<string, string[]>();
    for (const r of rows as ReadRow[]) {
      const arr = map.get(r.message_id) ?? [];
      if (!arr.includes(r.user_id)) arr.push(r.user_id);
      map.set(r.message_id, arr);
    }
    setReads(map);
  }

  (async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("group_messages")
      .select("id,group_id,user_id:author_id,content,created_at,parent_id,attachments")
      .eq("group_id", groupId)
      .order("created_at", { ascending: false })
      .limit(pageSize);
    if (aborted) return;
    if (error) { console.error(error); setLoading(false); return; }

    const arr = (data ?? []).reverse() as ChatMessage[];
    setMsgs(arr);
    console.log("[preload] loaded messages:", arr.length);
    setHasMore((data ?? []).length === pageSize);
    setLoading(false);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 0);

    const userIds = Array.from(new Set(arr.map(m => m.user_id)));
    await fetchMissingProfiles(userIds);
    await preloadReactions(arr.map(m => m.id));
    await preloadReads(arr.map(m => m.id));
  })();

  return () => { aborted = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [groupId, pageSize]);

  // Load group members + keep in sync via realtime
  useEffect(() => {
    let cancelled = false;
    const loadMembers = async () => {
      const { data, error } = await supabase
        .from("group_members")
        .select("user_id, profiles(name,avatar_url)")
        .eq("group_id", groupId);
      if (error) { console.warn("[members] load error", error); return; }
      if (cancelled) return;
      const list: Member[] = (data || []).map((r: any) => ({
        user_id: r.user_id,
        name: r.profiles?.name ?? null,
        avatar_url: r.profiles?.avatar_url ?? null,
      }));
      setMembers(list);
      // also seed profiles map so names show up
      setProfiles(prev => {
        const next = new Map(prev);
        for (const m of list) {
          next.set(m.user_id, { user_id: m.user_id, name: m.name, avatar_url: m.avatar_url } as Profile);
        }
        return next;
      });
    };
    loadMembers();

    const ch = supabase
      .channel(`gm:${groupId}:members`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "group_members", filter: `group_id=eq.${groupId}` },
        () => { loadMembers(); }
      )
      .subscribe();

    return () => { cancelled = false; supabase.removeChannel(ch); };
  }, [groupId]);

  // Auto-scroll any time messages grow
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs.length]);

  // realtime new messages + reactions + reads
  useEffect(() => {
    const ch = supabase.channel(`gm:${groupId}`);
    ch.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "group_messages" },
      async (payload) => {
        const raw = payload.new as any;
        if (raw.group_id !== groupId) return;
        const m: ChatMessage = {
          id: raw.id,
          group_id: raw.group_id,
          user_id: raw.user_id ?? raw.author_id,
          content: raw.content,
          created_at: raw.created_at,
          parent_id: raw.parent_id ?? null,
          attachments: raw.attachments ?? []
        };
        console.log('[realtime] INSERT group_messages:', m);
        setMsgs(prev => {
          // remove matching phantom (same author+content created recently)
          const cutoff = Date.now() - 30_000;
          const cleaned = prev.filter(p => {
            if (!p.id.startsWith('phantom-')) return true;
            if (p.user_id !== m.user_id) return true;
            if (p.content !== m.content) return true;
            return +new Date(p.created_at) < cutoff; // keep very old phantoms
          });
          if (cleaned.find(x => x.id === m.id)) return cleaned;
          const next = [...cleaned, m].sort((a,b) => +new Date(a.created_at) - +new Date(b.created_at));
          return next;
        });
        if (!profiles.get(m.user_id)) {
          const { data: p } = await supabase
            .from("profiles")
            .select("user_id,id,name,avatar_url")
            .eq("user_id", m.user_id)
           .maybeSingle();
          if (p) setProfiles(prev => new Map(prev).set(p.user_id, p));
        }
        const nearBottom = (() => {
          const el = listRef.current; if (!el) return true;
          return el.scrollHeight - el.scrollTop - el.clientHeight < 200;
        })();
        if (nearBottom) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      }
    ).on("postgres_changes",
      { event: "INSERT", schema: "public", table: "group_message_reactions" },
      (payload) => {
        const r = payload.new as Reaction;
        setReactions(prev => {
          const map = new Map(prev);
          const obj = map.get(r.message_id) ?? {};
          const arr = obj[r.emoji] ?? [];
          if (!arr.includes(r.user_id)) arr.push(r.user_id);
          obj[r.emoji] = arr; map.set(r.message_id, obj);
          return map;
        });
      }
    ).on("postgres_changes",
      { event: "DELETE", schema: "public", table: "group_message_reactions" },
      (payload) => {
        const r = payload.old as Reaction;
        setReactions(prev => {
          const map = new Map(prev);
          const obj = map.get(r.message_id) ?? {};
          const arr = (obj[r.emoji] ?? []).filter(u => u !== r.user_id);
          if (arr.length) obj[r.emoji] = arr; else delete obj[r.emoji];
          map.set(r.message_id, obj);
          return map;
        });
      }
    ).on("postgres_changes",
      { event: "INSERT", schema: "public", table: "group_message_reads" },
      (payload) => {
        const row = payload.new as ReadRow;
        setReads(prev => {
          const map = new Map(prev);
          const arr = map.get(row.message_id) ?? [];
          if (!arr.includes(row.user_id)) arr.push(row.user_id);
          map.set(row.message_id, arr);
          return map;
        });
      }
    );

    ch.subscribe((status: string) => {
      console.log("[realtime] channel status:", status, "for", "gm:" + groupId);
    });
    return () => { supabase.removeChannel(ch); };
  }, [groupId]);

  // presence/typing (minimal)
  useEffect(() => {
    const presence: any = supabase.channel(`gm:${groupId}:presence`, {
  config: { presence: { key: me || Math.random().toString(36).slice(2) } },
});
presence.on("presence", { event: "sync" }, () => {
  const state = presence.presenceState();
      const keys = Object.keys(state);
      setOnlineCount(keys.length);
      let anyTyping: string | null = null;
      for (const k of keys) {
        const metas = state[k] as any[]; const last = metas[metas.length - 1];
        if (last?.typing && last?.uid !== me) {
          anyTyping = last.name || "Someone"; break;
        }
      }
      setSomeoneTyping(anyTyping);
    });
    presence.subscribe((status: string) => {
      if (status === "SUBSCRIBED") {
        presence.track({ uid: me, name: myProfile?.name || (myEmail ? myEmail.split("@")[0] : undefined), typing: false });
      }
    });
    return () => { supabase.removeChannel(presence); };
  }, [groupId, me, myProfile?.name]);

  // pagination
  const loadOlder = async () => {
    if (!earliestTs || !hasMore) return;
    const { data, error } = await supabase
      .from("group_messages")
      .select("id,group_id,user_id:author_id,content,created_at,parent_id,attachments")
      .eq("group_id", groupId)
      .lt("created_at", earliestTs as string)
      .order("created_at", { ascending: false })
      .limit(pageSize);
    if (error) { console.error(error); return; }
    const arr = (data ?? []).reverse() as ChatMessage[];
    if (arr.length < pageSize) setHasMore(false);
    setMsgs(prev => [...arr, ...prev]);
  };

  // Listen for new/updated profiles so names appear immediately

useEffect(() => {
  const ch = supabase
    .channel('profiles-realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'profiles' },
      (payload) => {
        const p = payload.new as { user_id: string; name: string | null; avatar_url?: string | null };
        if (!p?.user_id) return;
        setProfiles((prev) => {
          const next = new Map(prev);
          next.set(p.user_id, { user_id: p.user_id, id: p.user_id, name: p.name, avatar_url: (p as any).avatar_url ?? null });
          return next;
        });
      }
    )
    .subscribe();

  return () => { supabase.removeChannel(ch); };
}, []);

// Backfill any missing profiles whenever messages change
useEffect(() => {
  (async () => {
    if (!msgs.length) return;
    const unknown = Array.from(new Set(msgs.map(m => m.user_id))).filter(id => !profiles.has(id));
    if (!unknown.length) return;
    const { data: profs, error } = await supabase
      .from("profiles")
      .select("user_id,id,name,avatar_url")
      .in("user_id", unknown);
    if (error) {
      console.warn("[profiles backfill]", error);
      return;
    }
    if (profs?.length) {
      setProfiles(prev => {
        const next = new Map(prev);
        for (const p of profs) next.set(p.user_id, p as any);
        return next;
      });
    }
  })();
}, [msgs, profiles]);
useEffect(() => {
  if (user?.email) setMyEmail(user.email as string);
}, [user]);


  // read receipt: mark visible messages as read
  useEffect(() => {
    if (!me || !msgs.length) return;
    const el = listRef.current; if (!el) return;

    const obs = new IntersectionObserver(async (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          const id = (e.target as HTMLElement).dataset.mid;
          if (!id) continue;
          await supabase
            .from("group_message_reads")
            .upsert(
              { message_id: id, user_id: me },
              { onConflict: "message_id,user_id", ignoreDuplicates: true }
            );
        }
      }
    }, { root: el, threshold: 0.6 });

    // attach to message bubbles
    const nodes = el.querySelectorAll("[data-mid]");
    nodes.forEach(n => obs.observe(n));
    return () => obs.disconnect();
  }, [me, msgs]);

  // Ensure we have a user id (prefer state, then prop, then auth.getUser)
  const ensureUid = async (): Promise<string | null> => {
    if (me) return me;
    if (user?.id) { setMe(user.id as string); return user.id as string; }
    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id ?? null;
    if (uid) setMe(uid);
    return uid;
  };

  const send = async () => {
    const text = input.trim();
    // Capture reply parent id before clearing
    const parentId = replyTo?.id ?? null;
    console.log("[send] start", { me, text, sending, uploading, files: files.length });
    // make sure we have a uid before proceeding
    const uid = await ensureUid();
    if (!uid) {
      console.warn("[send] aborted: no uid");
      return;
    }
    if ((!text && files.length === 0) || sending || uploading) return;

    // ---- Optimistic add FIRST (so the bubble appears instantly) ----
    setSending(true);
    const phantomId = `phantom-${getUUID()}`;
    const phantom: ChatMessage = {
      id: phantomId,
      group_id: groupId,
      user_id: uid,
      content: text,
      created_at: new Date().toISOString(),
      parent_id: parentId,
      attachments: [] // fill after upload when we replace with real row
    };
    setMsgs(prev => [...prev, phantom]);
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    setInput("");
    setReplyTo(null);
    // ---- End optimistic add ----

    // upload files first (if any)
    let attachments: any[] = [];
    if (files.length) {
      setUploading(true);
      try {
        const ups = await Promise.all(files.map(async (f) => {
          const path = `${groupId}/${randomName(f)}`;
          const { error: uploadError } = await supabase.storage.from("chat-uploads").upload(path, f);
          if (uploadError) throw uploadError;
          const { data: signed } = await supabase.storage.from("chat-uploads").createSignedUrl(path, 60 * 60 * 24 * 7); // 7 days
          return {
            bucket: "chat-uploads",
            path,
            url: signed?.signedUrl ?? null,
            name: f.name,
            size: f.size,
            type: f.type,
          };
        }));
        attachments = ups;
      } catch (e) {
        console.error("[send] upload failed", e);
        setUploading(false);
        return;
      }
      setUploading(false);
      setFiles([]);
    }

    const { error } = await supabase.rpc('send_group_message', {
      p_group_id: groupId,
      p_content: text,
    });
    setSending(false);
    if (error) {
      console.error('[send] rpc error', error);
      setMsgs(prev => prev.filter(m => m.id !== phantomId));
      alert(error.message);
      return;
    }
    // Success: realtime handler will append the actual row; phantom will be removed there
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  };
// Ensure current user is a member when this chat opens
useEffect(() => {
  (async () => {
    if (!me || !groupId) return;
    try {
      await supabase
        .from('group_members')
        .insert({ group_id: groupId, user_id: me, role: 'member' });
    } catch (e: any) {
      // ignore unique_violation or RLS duplicate
    }
  })();
}, [groupId, me]);

// Mark this group's messages as read using server time (prevents clock skew)
useEffect(() => {
  (async () => {
    if (!me || !groupId) return;
    try {
      await supabase.rpc('mark_group_read', { p_group_id: groupId });
      // local broadcast so other components zero their badges immediately
      try {
        window.dispatchEvent(new CustomEvent('group-read', { detail: { groupId } }));
        const ping = JSON.stringify({ gid: groupId, ts: Date.now() });
        localStorage.setItem('group_read_ping', ping);
        localStorage.removeItem('group_read_ping');
      } catch {}
      // also clear any toast/list notifications tied to this group
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', me)
        .eq('payload->>group_id', groupId)
        .eq('is_read', false);
    } catch (e) {
      console.warn('[chat] mark-group-read rpc failed', e);
    }
  })();
}, [groupId, me]);
// Also refresh read cursor on window focus (keeps badges correct after tab switches)
useEffect(() => {
  if (!me || !groupId) return;
  const onFocus = async () => {
    try {
      await supabase.rpc('mark_group_read', { p_group_id: groupId });
      try {
        window.dispatchEvent(new CustomEvent('group-read', { detail: { groupId } }));
        const ping = JSON.stringify({ gid: groupId, ts: Date.now() });
        localStorage.setItem('group_read_ping', ping);
        localStorage.removeItem('group_read_ping');
      } catch {}
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[mark_group_read focus]', e);
    }
  };
  window.addEventListener('focus', onFocus);
  return () => window.removeEventListener('focus', onFocus);
}, [groupId, me]);

  const toggleReaction = async (messageId: string, emoji: string) => {
    if (!me) return;
    const current = reactions.get(messageId)?.[emoji] ?? [];
    const has = current.includes(me);
    if (!has) {
      await supabase.from("group_message_reactions").insert({ message_id: messageId, emoji });
    } else {
      // delete where (message_id, user_id, emoji)
      await supabase
        .from("group_message_reactions")
        .delete()
        .eq("message_id", messageId)
        .eq("user_id", me)
        .eq("emoji", emoji);
    }
  };

  const displayName = (uid: string) => {
    if (uid === me) {
      const selfName = (myProfile?.name ?? "").trim();
      if (selfName) return selfName;
      if (myEmail) return myEmail.split("@")[0];
      return "You";
    }
    const p = profiles.get(uid);
    const otherName = (p?.name ?? "").trim();
    if (otherName) return otherName;
    const mem = members.find(m => m.user_id === uid);
    if (mem && mem.name && mem.name.trim()) return mem.name;
    return "Player";
  };

  const avatar = (uid: string) => {
    const p = profiles.get(uid);
    if (p?.avatar_url) return <img src={p.avatar_url} alt="" className="h-6 w-6 rounded-full object-cover" />;
    const label = (p?.name || uid.slice(0, 2)).slice(0, 2).toUpperCase();
    return <div className="h-6 w-6 rounded-full border flex items-center justify-center text-[10px]">{label}</div>;
  };

  const onDrop = (ev: React.DragEvent<HTMLDivElement>) => {
  ev.preventDefault();
  const fl = Array.from(ev.dataTransfer?.files || []);
  if (fl.length) setFiles(prev => [...prev, ...fl]);
};

  const onPaste = (ev: React.ClipboardEvent<HTMLInputElement | HTMLDivElement>) => {
  const fl: File[] = [];
  const items = Array.from(ev.clipboardData?.items || []);
  for (const item of items) {
    if (item.kind === "file") {
      const f = item.getAsFile();
      if (f) fl.push(f);
    }
  }
  if (fl.length) setFiles(prev => [...prev, ...fl]);
 };

  const renderAttachments = (atts: any[]) => {
    if (!atts?.length) return null;
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        {atts.map((a, idx) => {
          if (a?.type?.startsWith("image/") && a.url) {
            return <img key={idx} src={a.url} alt={a.name || ""} className="max-h-40 rounded-lg border" />;
          }
          return (
            <a key={idx} href={a.url || "#"} target="_blank" rel="noreferrer" className="text-xs underline">
              {a.name || a.path}
            </a>
          );
        })}
      </div>
    );
  };

  return (
    <div className="relative overflow-hidden flex h-full max-h-[75vh] min-h-[460px] w-full flex-col rounded-2xl border shadow-2xl ring-1 ring-black/10 p-3 bg-gradient-to-br from-amber-400 via-rose-500 to-fuchsia-600">
      {/* Ambient gradient background + soft glass overlay */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        {/* Gradient blobs */}
        <div className="absolute -top-24 -left-16 h-72 w-72 rounded-full bg-amber-300/80 blur-3xl"></div>
        <div className="absolute bottom-0 -right-10 h-80 w-80 rounded-full bg-fuchsia-500/70 blur-3xl"></div>
      </div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">Group Chat</div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowMembers(v => !v)}
            className="rounded-md border px-2 py-1 text-xs hover:bg-black/5"
            title="Show members"
          >
            Members ({members.length})
          </button>
          <div className="text-xs opacity-70">{onlineCount > 0 ? `${onlineCount} online` : "offline"}</div>
        </div>
      </div>

      {showMembers && (
        <div className="mb-2 max-h-28 overflow-y-auto rounded-lg border bg-white/80 backdrop-blur p-2">
          {members.length === 0 ? (
            <div className="text-xs opacity-60">No members yet.</div>
          ) : (
            <ul className="grid grid-cols-2 gap-2 text-sm">
              {members.map(m => (
                <li key={m.user_id} className="flex items-center gap-2">
                  {m.avatar_url ? (
                    <img src={m.avatar_url} alt="" className="h-5 w-5 rounded-full object-cover" />
                  ) : (
                    <div className="h-5 w-5 rounded-full border flex items-center justify-center text-[9px]">
                      {(m.name || "").slice(0,2).toUpperCase() || "?"}
                    </div>
                  )}
                  <span className="truncate">{(m.name && m.name.trim()) || "Player"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {someoneTyping && <div className="mb-1 text-xs italic opacity-70">{someoneTyping} is typing…</div>}

      <div className="mb-2">
        {hasMore && (
          <button onClick={loadOlder} className="text-xs underline disabled:opacity-50" disabled={loading}>
            Load older
          </button>
        )}
      </div>

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto rounded-xl border bg-white p-3"
        onDrop={onDrop}
        onDragOver={(e)=>e.preventDefault()}
        onClick={()=>setMenuFor(null)}
      >
        {loading && msgs.length === 0 ? (
          <div className="text-center text-sm opacity-70">Loading…</div>
        ) : msgs.length === 0 ? (
          <div className="text-center text-sm opacity-70">No messages yet. Say hi 👋</div>
        ) : (
          <ul className="space-y-3">
            {msgs.map((m) => {
              const isMine = !!me && m.user_id === me;
              const reacts: Record<string, string[]> = reactions.get(m.id) ?? ({} as Record<string, string[]>);
              const seenBy = (reads.get(m.id) ?? []).filter(u => u !== m.user_id).length;
              return (
                <li
                  key={m.id}
                  className={`relative flex gap-2 ${isMine ? "justify-end" : ""}`}
                  data-mid={m.id}
                >
                  {!isMine && avatar(m.user_id)}
                  <div className={`flex max-w-[85%] flex-col ${isMine ? "items-end" : "items-start"}`}>
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-semibold">{displayName(m.user_id)}</span>
                      <span className="text-[10px] opacity-60">{relTime(m.created_at)}</span>
                      {m.parent_id && <span className="text-[10px] opacity-60">(reply)</span>}
                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === m.id ? null : m.id); }}
                        className="ml-auto h-6 w-6 rounded hover:bg-black/5 text-xs leading-6 text-center"
                        aria-label="More"
                        title="More"
                      >
                        ⋯
                      </button>
                    </div>

                    {menuFor === m.id && (
                      <div
                        onClick={(e)=>e.stopPropagation()}
                        className="absolute right-2 top-6 z-20 w-36 rounded-md border bg-white shadow-md p-2 text-sm"
                      >
                        <button
                          className="w-full text-left px-2 py-1 rounded hover:bg-black/5"
                          onClick={()=>{ setReplyTo(m); setMenuFor(null); }}
                        >
                          Reply
                        </button>
                        <div className="my-1 border-t" />
                        <div className="px-2 py-1">
                          <div className="mb-1 text-[11px] opacity-60">Add reaction</div>
                          <div className="flex gap-2">
                            <button className="text-base" onClick={()=>{ toggleReaction(m.id,"👍"); setMenuFor(null); }}>👍</button>
                            <button className="text-base" onClick={()=>{ toggleReaction(m.id,"❤️"); setMenuFor(null); }}>❤️</button>
                            <button className="text-base" onClick={()=>{ toggleReaction(m.id,"😂"); setMenuFor(null); }}>😂</button>
                          </div>
                        </div>
                      </div>
                    )}

                    {m.parent_id && (() => {
                      const p = msgs.find(x => x.id === m.parent_id);
                      if (!p) return null;
                      return (
                        <div className="mb-1 rounded-md border bg-white px-2 py-1 text-[12px]">
                          Replying to <span className="font-medium">{displayName(p.user_id)}</span>: {p.content.slice(0, 120)}
                          {p.content.length > 120 ? "…" : ""}
                        </div>
                      );
                    })()}

                    <div
                        className={`whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm shadow-sm ${
                        isMine ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-900"
                      }`}
                    >
                      {m.content}
                    </div>
                    <div className={`mt-1 text-[10px] opacity-60 ${isMine ? "text-right" : "text-left"}`}>
                          {relTime(m.created_at)}
                    </div>
                    {renderAttachments(m.attachments)}

                    {/* reactions */}
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {Object.entries(reacts).map(([emoji, users]) => {
                        const iReacted = me ? users.includes(me) : false;
                        return (
                          <button
                            key={emoji}
                            onClick={() => toggleReaction(m.id, emoji)}
                            className={`rounded-full border px-2 text-xs ${iReacted ? "bg-black text-white" : ""}`}
                            title={users.map(u => displayName(u)).join(", ")}
                          >
                            {emoji} {users.length}
                          </button>
                        );
                      })}
                      <div className="flex items-center gap-1 text-[12px]">
                        {seenBy > 0 && <span className="text-[10px] opacity-60">Seen by {seenBy}</span>}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
            <div ref={bottomRef} />
          </ul>
        )}
      </div>

      {/* compose */}
      {replyTo && (
        <div className="mt-2 rounded-md border bg-white p-2 text-xs flex items-center justify-between">
          Replying to <span className="font-medium ml-1">{displayName(replyTo.user_id)}</span> — {replyTo.content.slice(0, 80)}
          <button onClick={() => setReplyTo(null)} className="text-xs underline opacity-70">cancel</button>
        </div>
      )}

      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {files.map((f, i) => (
            <div key={i} className="rounded border px-2 py-1">{f.name} ({Math.round(f.size/1024)} KB)</div>
          ))}
        </div>
      )}

      <div className="mt-2 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          onPaste={onPaste}
          placeholder="Write a message…"
          className="flex-1 rounded-xl border px-3 py-2 text-sm"
          maxLength={4000}
        />
        <label className="rounded-xl border px-3 py-2 text-sm cursor-pointer">
          Attach
          <input
            type="file"
            multiple
            className="hidden"
            onChange={(e) => setFiles(prev => [...prev, ...Array.from(e.target.files || [])])}
          />
        </label>
        <button
          onClick={send}
          disabled={sending || uploading || (input.trim().length === 0 && files.length === 0)}
          className="rounded-xl border px-3 py-2 text-sm disabled:opacity-50"
          title={uploading ? "Uploading…" : "Send"}
        >
          {uploading ? "Uploading…" : "Send"}
        </button>
      </div>
      <div className="mt-1 text-[10px] opacity-60">Tip: drag & drop or paste images/files into the chat.</div>
    </div>
  );
}