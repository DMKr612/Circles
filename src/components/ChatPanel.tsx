import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Message } from "@/types";
import { useAuth } from "@/App";

type Profile = { user_id: string; id?: string; name: string | null; avatar_url?: string | null };
type Member = { user_id: string; name: string | null; avatar_url?: string | null };
type Reaction = { id: string; message_id: string; user_id: string; emoji: string };
type ReadRow = { message_id: string; user_id: string; read_at: string };

const relTime = (iso: string) => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24); return d === 1 ? "1d" : `${d}d`;
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
  const [myProfile, setMyProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());

  const [msgs, setMsgs] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<Map<string, Record<string, string[]>>>(new Map());
  const [reads, setReads] = useState<Map<string, string[]>>(new Map());

  const [input, setInput] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);

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

  // Auth hook for user info
  const { user: authUser } = useAuth();
  const me = authUser?.id || null;
  const myEmail = authUser?.email || null;


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

      const arr = (data ?? []).reverse() as Message[];
      setMsgs(arr);
      setHasMore((data ?? []).length === pageSize);
      setLoading(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 0);

      const userIds = Array.from(new Set(arr.map(m => m.user_id)));
      await fetchMissingProfiles(userIds);
      await preloadReactions(arr.map(m => m.id));
      await preloadReads(arr.map(m => m.id));
    })();

    return () => { aborted = true; };
  }, [groupId, pageSize]);

  // Load group members
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

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs.length]);

  // realtime
  useEffect(() => {
    const ch = supabase.channel(`gm:${groupId}`);
    ch.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "group_messages" },
      async (payload) => {
        const raw = payload.new as any;
        if (raw.group_id !== groupId) return;
        const m: Message = {
          id: raw.id,
          group_id: raw.group_id,
          user_id: raw.user_id ?? raw.author_id,
          content: raw.content,
          created_at: raw.created_at,
          parent_id: raw.parent_id ?? null,
          attachments: raw.attachments ?? []
        };
        setMsgs(prev => {
          const cutoff = Date.now() - 30_000;
          const cleaned = prev.filter(p => {
            if (!p.id.startsWith('phantom-')) return true;
            if (p.user_id !== m.user_id) return true;
            if (p.content !== m.content) return true;
            return +new Date(p.created_at) < cutoff;
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
    ).subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [groupId]);

  // presence
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
    const arr = (data ?? []).reverse() as Message[];
    if (arr.length < pageSize) setHasMore(false);
    setMsgs(prev => [...arr, ...prev]);
  };

  // Listen for profiles
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

  // Backfill profiles
  useEffect(() => {
    (async () => {
      if (!msgs.length) return;
      const unknown = Array.from(new Set(msgs.map(m => m.user_id))).filter(id => !profiles.has(id));
      if (!unknown.length) return;
      const { data: profs, error } = await supabase
        .from("profiles")
        .select("user_id,id,name,avatar_url")
        .in("user_id", unknown);
      if (error) return;
      if (profs?.length) {
        setProfiles(prev => {
          const next = new Map(prev);
          for (const p of profs) next.set(p.user_id, p as any);
          return next;
        });
      }
    })();
  }, [msgs, profiles]);


  // read receipt
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

    const nodes = el.querySelectorAll("[data-mid]");
    nodes.forEach(n => obs.observe(n));
    return () => obs.disconnect();
  }, [me, msgs]);


  const send = async () => {
    const text = input.trim();
    const parentId = replyTo?.id ?? null;
    const uid = me;
    if (!uid) return;
    if ((!text && files.length === 0) || sending || uploading) return;

    setSending(true);
    const phantomId = `phantom-${getUUID()}`;
    const phantom: Message = {
      id: phantomId,
      group_id: groupId,
      user_id: uid,
      content: text,
      created_at: new Date().toISOString(),
      parent_id: parentId,
      attachments: []
    };
    setMsgs(prev => [...prev, phantom]);
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    setInput("");
    setReplyTo(null);

    let attachments: any[] = [];
    if (files.length) {
      setUploading(true);
      try {
        const ups = await Promise.all(files.map(async (f) => {
          const path = `${groupId}/${randomName(f)}`;
          const { error: uploadError } = await supabase.storage.from("chat-uploads").upload(path, f);
          if (uploadError) throw uploadError;
          const { data: signed } = await supabase.storage.from("chat-uploads").createSignedUrl(path, 60 * 60 * 24 * 7);
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
        console.error(e);
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
      setMsgs(prev => prev.filter(m => m.id !== phantomId));
      alert(error.message);
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  };

  useEffect(() => {
    (async () => {
      if (!me || !groupId) return;
      try {
        await supabase
          .from('group_members')
          .insert({ group_id: groupId, user_id: me, role: 'member' });
      } catch (e: any) {}
    })();
  }, [groupId, me]);

  useEffect(() => {
    (async () => {
      if (!me || !groupId) return;
      try {
        await supabase.rpc('mark_group_read', { p_group_id: groupId });
        try {
          window.dispatchEvent(new CustomEvent('group-read', { detail: { groupId } }));
        } catch {}
        await supabase
          .from('notifications')
          .update({ is_read: true })
          .eq('user_id', me)
          .eq('payload->>group_id', groupId)
          .eq('is_read', false);
      } catch (e) {}
    })();
  }, [groupId, me]);

  useEffect(() => {
    if (!me || !groupId) return;
    const onFocus = async () => {
      try {
        await supabase.rpc('mark_group_read', { p_group_id: groupId });
        try {
          window.dispatchEvent(new CustomEvent('group-read', { detail: { groupId } }));
        } catch {}
      } catch (e) {}
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
    return (p?.name ?? "").trim() || members.find(m => m.user_id === uid)?.name || "Player";
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

  const onPaste = (ev: React.ClipboardEvent<HTMLInputElement | HTMLDivElement | HTMLTextAreaElement>) => {
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

  // --- Main render ---
  return (
    <div className="relative flex h-full w-full max-h-[85vh] min-h-[420px] flex-col overflow-hidden rounded-3xl border shadow-2xl ring-1 ring-black/10 bg-gradient-to-br from-orange-400 via-rose-500 to-fuchsia-600 p-3 sm:p-4">
      {/* Ambient background */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.25),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(255,255,255,0.2),transparent_32%)]" />
        <div className="absolute inset-0 bg-gradient-to-b from-white/10 via-transparent to-black/15 mix-blend-soft-light" />
      </div>

      {/* Header */}
      <div className="flex shrink-0 items-center justify-between rounded-2xl border border-white/20 bg-white/15 px-4 py-3 text-white backdrop-blur-md shadow-sm">
        <div className="flex flex-col">
          <div className="text-sm font-bold drop-shadow-md">Group Chat</div>
          <div className="text-[11px] opacity-90">{onlineCount > 0 ? `${onlineCount} online` : "Offline"}</div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={() => setShowMembers(v => !v)}
            className="rounded-full border border-white/30 bg-white/20 px-3 py-1 text-[11px] font-medium hover:bg-white/30 transition"
            title="Show members"
          >
            Members ({members.length})
          </button>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full border border-white/30 bg-white/20 hover:bg-white/30 transition"
            aria-label="Close chat"
          >
            ✕
          </button>
        </div>
      </div>

      {showMembers && (
        <div className="mt-2 rounded-2xl border border-white/40 bg-white/85 p-3 shadow-sm backdrop-blur-sm">
          <div className="mb-1 text-xs font-semibold text-neutral-600">Members</div>
          {members.length === 0 ? (
            <div className="text-xs text-neutral-600">No members yet.</div>
          ) : (
            <ul className="grid grid-cols-2 gap-2 text-sm">
              {members.map(m => (
                <li key={m.user_id} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-neutral-100">
                  {m.avatar_url ? (
                    <img src={m.avatar_url} alt="" className="h-6 w-6 rounded-full object-cover" />
                  ) : (
                    <div className="h-6 w-6 rounded-full border flex items-center justify-center text-[10px] text-neutral-600">
                      {(m.name || "").slice(0,2).toUpperCase() || "?"}
                    </div>
                  )}
                  <span className="truncate text-neutral-800">{(m.name && m.name.trim()) || "Player"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="mt-3 flex-1 overflow-hidden rounded-2xl border border-white/30 bg-white/85 shadow-xl backdrop-blur-sm">
        <div
          ref={listRef}
          className="h-full overflow-y-auto p-3 sm:p-4"
          onDrop={onDrop}
          onDragOver={(e)=>e.preventDefault()}
          onClick={()=>setMenuFor(null)}
        >
          {hasMore && (
            <div className="mb-3 flex justify-center">
              <button
                onClick={loadOlder}
                disabled={loading}
                className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs text-neutral-600 shadow-sm hover:bg-neutral-50 disabled:opacity-50"
              >
                Load older
              </button>
            </div>
          )}

          {loading && msgs.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-neutral-500">Loading…</div>
          ) : msgs.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-neutral-600">
              <div className="text-3xl">👋</div>
              <div className="space-y-1">
                <div className="text-base font-semibold text-neutral-800">No messages yet.</div>
                <div className="text-xs text-neutral-500">Be the first to say hi!</div>
              </div>
            </div>
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
                    <div className={`flex max-w-[90%] sm:max-w-[85%] flex-col ${isMine ? "items-end" : "items-start"}`}>
                      <div className="flex w-full items-baseline gap-2">
                        <span className="text-xs font-semibold text-neutral-800">{displayName(m.user_id)}</span>
                        <span className="text-[10px] text-neutral-500">{relTime(m.created_at)}</span>
                        {m.parent_id && <span className="text-[10px] text-neutral-500">(reply)</span>}
                        <button
                          onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === m.id ? null : m.id); }}
                          className="ml-auto h-6 w-6 rounded-full text-xs leading-6 text-center text-neutral-500 hover:bg-neutral-100"
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
                            className="w-full text-left px-2 py-1 rounded hover:bg-neutral-100"
                            onClick={()=>{ setReplyTo(m); setMenuFor(null); }}
                          >
                            Reply
                          </button>
                          <div className="my-1 border-t" />
                          <div className="px-2 py-1">
                            <div className="mb-1 text-[11px] text-neutral-500">Add reaction</div>
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
                          <div className="mb-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1 text-[12px] text-neutral-700">
                            Replying to <span className="font-medium">{displayName(p.user_id)}</span>: {p.content.slice(0, 120)}
                            {p.content.length > 120 ? "…" : ""}
                          </div>
                        );
                      })()}

                      <div
                        className={`whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm shadow-sm ${
                        isMine ? "bg-gradient-to-r from-blue-500 to-indigo-500 text-white" : "bg-neutral-100 text-neutral-900"
                      }`}
                      >
                        {m.content}
                      </div>
                      <div className={`mt-1 text-[10px] text-neutral-500 ${isMine ? "text-right" : "text-left"}`}>
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
                              className={`rounded-full border px-2 text-xs shadow-sm ${iReacted ? "bg-black text-white" : "bg-white"}`}
                              title={users.map(u => displayName(u)).join(", ")}
                            >
                              {emoji} {users.length}
                            </button>
                          );
                        })}
                        <div className="flex items-center gap-1 text-[12px] text-neutral-500">
                          {seenBy > 0 && <span className="text-[10px]">Seen by {seenBy}</span>}
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
      </div>

      {/* Typing Indicator */}
      {someoneTyping && (
        <div className="mt-1 text-xs text-white/85 italic">{someoneTyping} is typing…</div>
      )}

      {/* Input Area */}
      <div className="mt-3 space-y-2 rounded-2xl border border-white/30 bg-white/90 p-3 shadow-lg backdrop-blur-sm">
        {replyTo && (
          <div className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-700">
            <div className="truncate">
              Replying to <span className="font-medium">{displayName(replyTo.user_id)}</span> — {replyTo.content.slice(0, 80)}
            </div>
            <button onClick={() => setReplyTo(null)} className="ml-2 text-xs text-rose-500 underline">cancel</button>
          </div>
        )}
        
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs">
            {files.map((f, i) => (
              <div key={i} className="rounded-full border border-neutral-200 bg-white px-3 py-1 shadow-sm">{f.name} ({Math.round(f.size/1024)} KB)</div>
            ))}
          </div>
        )}
        
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            onPaste={onPaste}
            placeholder="Message..."
            className="flex-1 rounded-full border border-neutral-200 bg-white px-4 py-3 text-sm shadow-inner focus:outline-none focus:ring-2 focus:ring-rose-400/60"
            maxLength={4000}
          />
          <label className="grid h-11 w-11 place-items-center rounded-full border border-neutral-200 bg-white text-neutral-600 shadow-sm hover:bg-neutral-50 cursor-pointer">
            📎
            <input type="file" multiple className="hidden" onChange={(e) => setFiles(prev => [...prev, ...Array.from(e.target.files || [])])} />
          </label>
          <button 
            onClick={send} 
            disabled={sending || uploading || (input.trim().length === 0 && files.length === 0)}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-r from-rose-500 to-fuchsia-600 text-white shadow-lg transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-60 disabled:scale-100"
          >
            {uploading ? "…" : "➤"}
          </button>
        </div>
        <div className="text-[11px] text-neutral-500">Tip: drag & drop or paste images/files into the chat.</div>
      </div>
    </div>
  );
}
