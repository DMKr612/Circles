import React, { useEffect, useMemo, useState, useRef, useCallback, useDeferredValue, forwardRef } from "react";
// FIX: Use a relative path from `components/` to `src/lib/`
import { supabase } from "@/lib/supabase";
import { Link } from "react-router-dom";
import type { Thread, DMMessage } from "@/types";

// Types
type FriendShipRow = {
  id: string;
  user_id_a: string;
  user_id_b: string;
  status: 'pending' | 'accepted' | 'blocked';
  requested_by: string;
};
type ProfileStub = {
  name: string;
  avatar_url: string | null;
}

// Props
interface DMSidebarProps {
  uid: string;
  sidebarItems: Thread[]; // Receives the list from Profile.tsx
  friendProfiles: Map<string, ProfileStub>; // Receives profiles from Profile.tsx
  friends: FriendShipRow[]; // Receives friend rows from Profile.tsx
  onViewProfile: (userId: string) => void;
  onClose: () => void;
  onNewMessage: (thread: Thread) => void; // To update Profile.tsx state
  onMarkRead: (otherId: string) => void; // To update Profile.tsx state
}

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

const DMSidebar = forwardRef<HTMLDivElement, DMSidebarProps>(
  ({ uid, sidebarItems, friendProfiles, friends, onViewProfile, onClose, onNewMessage, onMarkRead }, ref) => {
  
  const [dmTargetId, setDmTargetId] = useState<string | null>(null);
  const [dmLoading, setDmLoading] = useState(false);
  const [dmError, setDmError] = useState<string | null>(null);
  const [dmMsgs, setDmMsgs] = useState<DMMessage[]>([]);
  const [dmInput, setDmInput] = useState("");
  const dmEndRef = useRef<HTMLDivElement | null>(null);
  
  const [threadQuery, setThreadQuery] = useState("");
  const threadQueryDeferred = useDeferredValue(threadQuery);
  const [showSuggestions, setShowSuggestions] = useState(false);

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

  // --- Functions ---
  
  const openThread = useCallback(async (otherId: string) => {
    setShowSuggestions(false);
    setDmError(null);
    setDmLoading(true);
    setDmMsgs([]);
    setDmTargetId(otherId);
    
    // Tell parent Profile.tsx to mark as read
    onMarkRead(otherId); 
    
    const { data: msgs } = await supabase
      .from("direct_messages")
      .select("id,from_id,to_id,body,created_at")
      .or(`and(from_id.eq.${uid},to_id.eq.${otherId}),and(from_id.eq.${otherId},to_id.eq.${uid})`)
      .order("created_at", { ascending: true })
      .limit(200);
    setDmMsgs(msgs ?? []);
    setDmLoading(false);
  }, [uid, onMarkRead]);

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
    // Also update the thread list in the parent
    const updatedThread: Thread = {
      other_id: dmTargetId,
      name: dmDisplay.name,
      avatar_url: dmDisplay.avatar,
      last_body: body,
      last_at: data ? data.created_at : new Date().toISOString(),
      last_from_me: true,
      unread: false,
    };
    onNewMessage(updatedThread);
  }

  // --- Effects ---

  // Scroll to bottom of DMs
  useEffect(() => {
    dmEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [dmMsgs.length]);

  // Listen for event from parent to open a specific thread
  useEffect(() => {
    const handleOpenThread = (e: Event) => {
      const otherId = (e as CustomEvent).detail;
      if (otherId) {
        openThread(otherId);
      }
    };
    window.addEventListener('open-dm-thread', handleOpenThread);
    return () => {
      window.removeEventListener('open-dm-thread', handleOpenThread);
    };
  }, [openThread]);
  

  return (
    <aside
      ref={ref}
      id="dm-sidebar" // ID for the realtime listener in parent
      data-chatting-with={dmTargetId || ''} // Pass state to parent for realtime logic
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
                          <Link
                            to={`/profile/${o.id}`}
                            className="rounded-md bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700"
                          >
                            View
                          </Link>
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
  );
});

export default DMSidebar;
