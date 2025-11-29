import { useEffect, useState, useMemo, lazy, Suspense } from "react";
import { useParams, useNavigate, Link, useLocation } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import type { Group, Poll, PollOption, GroupMember } from "@/types";
import { 
  MapPin, Users, Calendar, Clock, Share2, MessageCircle, 
  LogOut, Trash2, Edit2, Check, X, Plus, ChevronLeft 
} from "lucide-react";

const ChatPanel = lazy(() => import("../components/ChatPanel"));

// FIX: Extend the type locally to include avatar_url and prevent red lines
interface MemberDisplay extends GroupMember {
  name: string | null;
  avatar_url: string | null;
}

export default function GroupDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const nav = useNavigate();
  const location = useLocation();

  const [group, setGroup] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Host check
  const isHost = !!(me && group && (me === group.host_id || (group?.creator_id ?? null) === me));

  // UI State
  const [chatOpen, setChatOpen] = useState(false);
  const [chatFull, setChatFull] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false); 
  
  // Edit Description State
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [editDescValue, setEditDescValue] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  // Voting State
  const [poll, setPoll] = useState<Poll | null>(null);
  const [options, setOptions] = useState<PollOption[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [memberCount, setMemberCount] = useState<number>(0);
  const [votedCount, setVotedCount] = useState<number>(0);
  const [votingBusy, setVotingBusy] = useState<string | null>(null);
  
  // FIX: Use the extended type here
  const [members, setMembers] = useState<MemberDisplay[]>([]);
  const [isMember, setIsMember] = useState(false);

  // New Poll Form
  const [newTitle, setNewTitle] = useState("Schedule");
  const [newOptions, setNewOptions] = useState(""); 
  const [pollDuration, setPollDuration] = useState("24h");
  const [customEndDate, setCustomEndDate] = useState("");

  // --- Helpers ---
  const isPollExpired = useMemo(() => {
    if (!poll?.closes_at) return false;
    return new Date(poll.closes_at) < new Date();
  }, [poll]);

  function getPollStatusLabel(status: string, closesAt: string | null) {
    if (status === 'closed') return "Voting Closed";
    if (!closesAt) return "Open";
    const diff = new Date(closesAt).getTime() - Date.now();
    if (diff <= 0) return "Time Expired";
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (days > 0) return `${days}d ${hours}h left`;
    if (hours > 0) return `${hours}h ${minutes}m left`;
    return `${minutes}m left`;
  }

  // --- Effects ---

  useEffect(() => {
    if (location.hash === '#chat') setChatOpen(true);
  }, [location.hash]);

  useEffect(() => {
    let ignore = false;
    (async () => {
      setLoading(true);
      const { data: auth } = await supabase.auth.getUser();
      if (!ignore) setMe(auth.user?.id ?? null);

      const q = await supabase.from('groups').select('*').eq('id', id).maybeSingle();
      if (!ignore) setGroup((q.data as Group) ?? null);
      
      if (q.data) setEditDescValue(q.data.purpose || "");

      if (q.data?.id) {
        const { count } = await supabase
          .from('group_members')
          .select('*', { count: 'exact', head: true })
          .eq('group_id', q.data.id)
          .eq('status', 'active');
        if (!ignore) setMemberCount(count ?? 0);
      }
      setLoading(false);
    })();
    return () => { ignore = true; };
  }, [id]);

  useEffect(() => {
    let off = false;
    (async () => {
      if (!group?.id) { setMembers([]); return; }
      const { data } = await supabase
        .from('group_members')
        .select('user_id, role, created_at, status, group_id, profiles(name, avatar_url)')
        .eq('group_id', group.id)
        .eq('status', 'active')
        .order('created_at', { ascending: true });

      // FIX: Map the profile data correctly to the extended type
      const arr: MemberDisplay[] = (data ?? []).map((r: any) => ({
        user_id: r.user_id,
        role: r.role,
        created_at: r.created_at,
        group_id: group.id,
        status: 'active',
        name: r.profiles?.name ?? "User",
        avatar_url: r.profiles?.avatar_url ?? null
      }));

      if (off) return;
      setMembers(arr);
      
      const meId = (await supabase.auth.getUser()).data.user?.id || null;
      if (meId) setIsMember(arr.some((a) => a.user_id === meId));
    })();
    return () => { off = true; };
  }, [group?.id]);

  // Load Polls
  useEffect(() => {
    let gone = false;
    (async () => {
      if (!group?.id) return;
      
      const { data: polls } = await supabase
        .from("group_polls").select("*")
        .eq("group_id", group.id)
        .order("created_at", { ascending: false })
        .limit(1);
        
      if (gone) return;
      const cur = (polls && polls[0]) as Poll | undefined;
      setPoll(cur || null);
      if (!cur) { setOptions([]); setCounts({}); setVotedCount(0); return; }

      const { data: opts } = await supabase.from("group_poll_options").select("*").eq("poll_id", cur.id).order("created_at");
      if (gone) return;
      setOptions((opts as PollOption[]) || []);

      const { data: votesRows } = await supabase.from("group_votes").select("option_id,user_id").eq("poll_id", cur.id);
      if (gone) return;
      const map: Record<string, number> = {};
      const voterSet = new Set<string>();
      (votesRows as any[])?.forEach((r) => {
        map[r.option_id] = (map[r.option_id] || 0) + 1;
        voterSet.add(r.user_id);
      });
      setCounts(map);
      setVotedCount(voterSet.size);
    })();
    return () => { gone = true; };
  }, [group?.id]);

  // --- Actions ---

  async function joinGroup() {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setMsg("Please sign in."); return; }
    await supabase.from("group_members").insert({ group_id: id, user_id: auth.user.id });
    setIsMember(true);
    setMemberCount(prev => prev + 1);
  }

  async function leaveGroup() {
    if (!group || !me) return;
    if (me === group.host_id) { setMsg("Host cannot leave their own group."); return; }
    await supabase.from("group_members").delete().match({ group_id: group.id, user_id: me });
    setIsMember(false);
    setMemberCount(prev => Math.max(0, prev - 1));
  }

  async function copyGroupCode() {
    if (!group?.code) return;
    navigator.clipboard.writeText(group.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function createInvite() {
    if (!group?.id) return;
    setShareBusy(true);
    try {
      const { data: code, error } = await supabase.rpc('make_group_invite', {
        p_group_id: group.id,
        p_hours: 168,
        p_max_uses: null
      });
      if (error) throw error;
      const url = `${window.location.origin}/invite/${code}`;
      await navigator.clipboard.writeText(url); 
      setShareCopied(true); 
      setTimeout(()=>setShareCopied(false), 1500);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setShareBusy(false);
    }
  }

  async function handleDelete() {
    if (!group || !me) return;
    if (!window.confirm("Delete this group?")) return;
    await supabase.from("groups").delete().match({ id: group.id, host_id: me });
    nav("/browse");
  }

  async function saveDescription() {
    if (!group || !isHost) return;
    setEditBusy(true);
    try {
      const { error } = await supabase.from("groups").update({ purpose: editDescValue }).eq("id", group.id);
      if (error) throw error;
      setGroup(prev => prev ? { ...prev, purpose: editDescValue } : null);
      setIsEditingDesc(false);
    } catch (e: any) {
      setMsg(e.message || "Failed to save description");
    } finally {
      setEditBusy(false);
    }
  }

  // --- Voting Logic ---

  async function confirmCreateVoting() {
    if (!group || !isHost) return;
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return;

    let closesAt: string | null = null;
    if (pollDuration === 'custom') {
        if (customEndDate) closesAt = new Date(customEndDate).toISOString();
    } else {
        const now = new Date();
        const hours = parseInt(pollDuration);
        now.setTime(now.getTime() + hours * 60 * 60 * 1000);
        closesAt = now.toISOString();
    }

    const labels = (newOptions || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(0, 20);
    if (!labels.some(l => l.toLowerCase() === 'not coming')) labels.push("Not Coming");

    const { data: created, error: pErr } = await supabase
      .from("group_polls")
      .insert({ 
          group_id: group.id, 
          title: (newTitle || "Schedule").trim(), 
          created_by: auth.user.id,
          closes_at: closesAt
      })
      .select("id")
      .single();
      
    if (pErr || !created?.id) { 
        console.error(pErr);
        setMsg("Failed to create poll. Check permissions."); 
        return; 
    }

    if (labels.length) {
      const rows = labels.map(label => ({ poll_id: created.id, label }));
      await supabase.from("group_poll_options").insert(rows);
    }

    setCreateOpen(false);
    setMsg("Voting created");
    setPoll({ 
        id: created.id, group_id: group.id, 
        title: newTitle, status: "open", 
        closes_at: closesAt, created_by: auth.user.id 
    });
    setOptions(labels.map((l, i) => ({ id: `temp-${i}`, poll_id: created.id, label: l, starts_at: null, place: null })));
    setCounts({});
  }

  async function finalizePoll() {
    if (!poll || !isHost) return;
    if (!window.confirm("End voting? Everyone who hasn't voted will be marked as 'Not Coming'.")) return;
    setVotingBusy("closing");
    try {
      await supabase.rpc('resolve_poll', { p_poll_id: poll.id });
      setPoll(prev => prev ? { ...prev, status: 'closed' } : prev);
      setMsg("Poll finalized.");
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setVotingBusy(null);
    }
  }

  async function deleteVoting() {
    if (!poll) return;
    if (!window.confirm("Delete this voting?")) return;
    // FIX: Add error handling for delete
    const { error } = await supabase.from("group_polls").delete().eq("id", poll.id);
    if (error) {
        setMsg("Could not delete. Check database permissions.");
        console.error(error);
    } else {
        setPoll(null);
        setMsg("Poll deleted.");
    }
  }

  async function castVote(optionId: string) {
    if (!poll || isPollExpired || poll.status === "closed") return;
    setVotingBusy(optionId);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) { nav("/login"); return; }

    await supabase.from("group_votes").upsert(
        { poll_id: poll.id, option_id: optionId, user_id: auth.user.id },
        { onConflict: "poll_id,user_id" }
    );

    const { data: votesRows } = await supabase.from("group_votes").select("option_id,user_id").eq("poll_id", poll.id);
    const map: Record<string, number> = {};
    const voterSet = new Set<string>();
    (votesRows as any[])?.forEach((r) => {
        map[r.option_id] = (map[r.option_id] || 0) + 1;
        voterSet.add(r.user_id);
    });
    setCounts(map);
    setVotedCount(voterSet.size);
    setVotingBusy(null);
  }

  if (loading) return <div className="p-20 flex justify-center"><div className="animate-spin h-8 w-8 border-2 border-neutral-300 border-t-black rounded-full"/></div>;
  if (!group) return <div className="p-10 text-center">Group not found.</div>;

  return (
    <>
      <div className={"transition-all duration-300 min-h-screen bg-[#FDFBF7] pb-24 " + (chatOpen && !chatFull ? "lg:mr-[min(92vw,520px)]" : "")}>
        
        {/* HERO HEADER */}
        <div className="bg-white border-b border-neutral-200 pt-8 pb-6 px-4 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-emerald-50 to-blue-50 rounded-full blur-3xl -z-10 opacity-60" />
            
            <div className="mx-auto max-w-5xl">
                <div className="flex items-center gap-2 mb-4 text-sm text-neutral-500">
                    <Link to="/browse" className="flex items-center gap-1 hover:text-black transition-colors">
                        <ChevronLeft className="h-4 w-4" /> Browse
                    </Link> 
                    <span>/</span>
                    <span className="font-medium text-neutral-800">Group Detail</span>
                </div>

                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
                    <div className="flex-1 min-w-0">
                        <h1 className="text-3xl md:text-4xl font-extrabold text-neutral-900 tracking-tight leading-tight mb-3">
                            {group.title}
                        </h1>
                        
                        <div className="flex flex-wrap gap-2 items-center">
                            <div className="inline-flex items-center gap-1.5 bg-neutral-100 text-neutral-700 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide">
                                {group.category || "General"}
                            </div>
                            {group.game && (
                                <div className="inline-flex items-center gap-1.5 bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full text-xs font-bold">
                                    {group.game}
                                </div>
                            )}
                            {group.city && (
                                <div className="inline-flex items-center gap-1.5 border border-neutral-200 text-neutral-600 px-3 py-1 rounded-full text-xs font-medium">
                                    <MapPin className="h-3 w-3" /> {group.city}
                                </div>
                            )}
                             <div className="inline-flex items-center gap-1.5 border border-neutral-200 text-neutral-600 px-3 py-1 rounded-full text-xs font-medium">
                                    <Users className="h-3 w-3" /> {memberCount} / {group.capacity}
                            </div>
                        </div>
                    </div>

                    {/* Main Actions */}
                    <div className="flex flex-wrap items-center gap-3">
                        {!isMember ? (
                            <button onClick={joinGroup} className="h-10 px-6 rounded-full bg-emerald-600 text-white text-sm font-bold shadow-md hover:bg-emerald-700 hover:shadow-lg active:scale-95 transition-all">
                                Join Group
                            </button>
                        ) : (
                            <>
                                <button onClick={() => setChatOpen(true)} className="h-10 px-5 rounded-full bg-white border border-neutral-200 text-neutral-800 text-sm font-bold shadow-sm hover:bg-neutral-50 hover:border-neutral-300 flex items-center gap-2 transition-all">
                                    <MessageCircle className="h-4 w-4" /> Chat
                                </button>
                                {isHost && (
                                    <button onClick={createInvite} className="h-10 px-5 rounded-full bg-white border border-neutral-200 text-neutral-800 text-sm font-bold shadow-sm hover:bg-neutral-50 hover:border-neutral-300 flex items-center gap-2 transition-all">
                                        <Share2 className="h-4 w-4" /> {shareBusy ? "..." : shareCopied ? "Copied" : "Invite"}
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>

        {/* MAIN CONTENT GRID */}
        <div className="mx-auto max-w-5xl px-4 py-8 grid gap-8 lg:grid-cols-[2fr_1fr]">
            
            {/* Left Column: About & Info */}
            <div className="space-y-8">
                
                {/* About Section */}
                <section className="bg-white rounded-2xl p-6 shadow-sm border border-neutral-200/60 relative">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-lg font-bold text-neutral-900 flex items-center gap-2">
                            About this Circle
                        </h2>
                        {isHost && !isEditingDesc && (
                            <button onClick={() => setIsEditingDesc(true)} className="p-1.5 rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900 transition-colors">
                                <Edit2 className="h-4 w-4" />
                            </button>
                        )}
                    </div>

                    {isEditingDesc ? (
                        <div className="animate-in fade-in duration-200">
                            <textarea
                                value={editDescValue}
                                onChange={(e) => setEditDescValue(e.target.value)}
                                className="w-full min-h-[120px] p-3 rounded-xl border border-neutral-300 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none resize-y mb-3"
                                placeholder="What's the plan?"
                            />
                            <div className="flex gap-2 justify-end">
                                <button onClick={() => setIsEditingDesc(false)} className="px-3 py-1.5 rounded-lg border border-neutral-200 text-xs font-bold hover:bg-neutral-50 text-neutral-600">Cancel</button>
                                <button onClick={saveDescription} disabled={editBusy} className="px-3 py-1.5 rounded-lg bg-black text-white text-xs font-bold hover:bg-neutral-800 disabled:opacity-50">
                                    {editBusy ? "Saving..." : "Save Changes"}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <p className="text-sm text-neutral-600 leading-relaxed whitespace-pre-wrap">
                            {group.purpose || <span className="italic text-neutral-400">No description provided.</span>}
                        </p>
                    )}

                    {group.code && (
                        <div className="mt-6 pt-4 border-t border-neutral-100 flex items-center gap-3">
                            <span className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Invite Code</span>
                            <code className="text-sm font-mono bg-neutral-100 px-2 py-1 rounded text-neutral-700 border border-neutral-200">
                                {String(group.code).toUpperCase()}
                            </code>
                            <button onClick={copyGroupCode} className="text-xs font-medium text-emerald-600 hover:underline">
                                {copied ? "Copied" : "Copy"}
                            </button>
                        </div>
                    )}
                </section>

                {/* Details Card */}
                <section className="grid sm:grid-cols-2 gap-4">
                   <div className="bg-white p-4 rounded-2xl border border-neutral-200/60 shadow-sm">
                      <div className="flex items-center gap-2 text-neutral-400 text-xs font-bold uppercase mb-1">
                         <Calendar className="h-3 w-3" /> Created
                      </div>
                      <div className="text-sm font-semibold text-neutral-900">{new Date(group.created_at).toLocaleDateString()}</div>
                   </div>
                   <div className="bg-white p-4 rounded-2xl border border-neutral-200/60 shadow-sm">
                      <div className="flex items-center gap-2 text-neutral-400 text-xs font-bold uppercase mb-1">
                         <Clock className="h-3 w-3" /> Format
                      </div>
                      <div className="text-sm font-semibold text-neutral-900">
                         {group.is_online ? (group.online_link ? "Online (Link set)" : "Online") : "In Person"}
                      </div>
                   </div>
                </section>

                {isMember && isHost && (
                     <button onClick={handleDelete} className="flex items-center gap-2 text-red-600 text-sm font-medium hover:text-red-700 transition-colors px-2">
                         <Trash2 className="h-4 w-4" /> Delete this group
                     </button>
                )}
                {isMember && !isHost && (
                     <button onClick={leaveGroup} className="flex items-center gap-2 text-neutral-500 text-sm font-medium hover:text-neutral-800 transition-colors px-2">
                         <LogOut className="h-4 w-4" /> Leave group
                     </button>
                )}

            </div>

            {/* Right Column: Voting & Members */}
            <div className="space-y-6">
                
                {/* --- VOTING SECTION --- */}
                <div className="bg-white border border-neutral-200 rounded-2xl p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-base font-bold text-neutral-900 flex items-center gap-2">
                           Polls & Events
                        </h2>
                        {isHost && (
                            <button onClick={() => setCreateOpen(true)} className="p-1.5 bg-neutral-50 rounded-full text-neutral-600 shadow-sm hover:scale-105 active:scale-95 transition-all border border-neutral-200 hover:bg-white hover:border-neutral-300">
                                <Plus className="h-4 w-4" />
                            </button>
                        )}
                    </div>

                    {!poll ? (
                        <div className="text-center py-8 px-4 bg-neutral-50 rounded-xl border border-dashed border-neutral-200">
                            <p className="text-sm text-neutral-400 mb-2 font-medium">No active polls</p>
                            {isHost && <button onClick={() => setCreateOpen(true)} className="text-xs text-black font-bold hover:underline">Create one</button>}
                        </div>
                    ) : (
                        <div className="animate-in slide-in-from-bottom-2 duration-500">
                            <div className="flex justify-between items-start mb-3">
                                <h3 className="font-bold text-neutral-900">{poll.title}</h3>
                                <div className={`text-[10px] font-bold px-2 py-1 rounded-full border ${poll.status === 'closed' ? 'bg-neutral-200 text-neutral-600 border-neutral-300' : isPollExpired ? 'bg-red-50 text-red-600 border-red-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'}`}>
                                    {getPollStatusLabel(poll.status, poll.closes_at)}
                                </div>
                            </div>

                            <div className="space-y-2 mb-4">
                                {options.map(o => {
                                    const count = counts[o.id] ?? 0;
                                    const isNC = o.label === 'Not Coming';
                                    const total = isNC ? count + (memberCount - votedCount) : count;
                                    const pct = memberCount > 0 ? Math.round((total / memberCount) * 100) : 0;
                                    
                                    return (
                                        <div key={o.id} className="relative">
                                            <div 
                                              className="absolute inset-0 bg-neutral-100 rounded-lg transition-all duration-500" 
                                              style={{ width: `${pct}%` }} 
                                            />
                                            <div className="relative flex items-center justify-between p-2.5 rounded-lg border border-neutral-100 hover:border-neutral-200 transition-colors">
                                                <span className="text-sm font-medium text-neutral-800 z-10">{o.label}</span>
                                                <div className="flex items-center gap-3 z-10">
                                                    <span className="text-xs font-bold text-neutral-600">{total}</span>
                                                    {poll.status === 'open' && !isPollExpired && (
                                                        <button 
                                                            onClick={() => castVote(o.id)}
                                                            className={`h-6 w-6 rounded-full flex items-center justify-center border transition-all hover:scale-110 active:scale-95 ${votingBusy === o.id ? 'bg-black border-black text-white' : 'bg-white border-neutral-200 text-neutral-600'}`}
                                                        >
                                                            {votingBusy === o.id ? <div className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full" /> : <Check className="h-3 w-3" />}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>

                            {isHost && (
                                <div className="flex flex-col gap-2 pt-3 border-t border-neutral-100">
                                    {poll.status === 'open' && (
                                        <button 
                                            onClick={finalizePoll} 
                                            className="w-full bg-black text-white text-xs font-bold py-3 rounded-xl hover:bg-neutral-800 shadow-sm flex items-center justify-center gap-2"
                                        >
                                            <Check className="h-4 w-4" /> End & Count Games
                                        </button>
                                    )}
                                    {poll.status === 'closed' && (
                                        <button 
                                            onClick={() => setCreateOpen(true)} 
                                            className="w-full bg-neutral-100 text-neutral-700 text-xs font-bold py-3 rounded-xl hover:bg-neutral-200 flex items-center justify-center gap-2"
                                        >
                                            <Plus className="h-4 w-4" /> Create New Vote
                                        </button>
                                    )}
                                    <button 
                                        onClick={deleteVoting} 
                                        className="w-full text-red-600 text-xs font-bold py-2 hover:bg-red-50 rounded-xl"
                                    >
                                        Delete Poll
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* --- MEMBERS PREVIEW --- */}
                <div className="bg-white border border-neutral-200 rounded-2xl p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-sm font-bold text-neutral-900">Members ({memberCount})</h2>
                        <button onClick={() => setMembersOpen(true)} className="text-xs font-medium text-emerald-600 hover:underline">
                            View All
                        </button>
                    </div>
                    <div className="flex -space-x-2 overflow-hidden cursor-pointer" onClick={() => setMembersOpen(true)}>
                         {members.slice(0, 5).map(m => (
                            <div key={m.user_id} className="h-8 w-8 rounded-full ring-2 ring-white bg-neutral-100 flex items-center justify-center text-[10px] font-bold text-neutral-500" title={m.name || "User"}>
                                {m.avatar_url ? (
                                    <img src={m.avatar_url} alt="" className="h-full w-full object-cover rounded-full" />
                                ) : (
                                    (m.name || "?").slice(0,1)
                                )}
                            </div>
                         ))}
                         {memberCount > 5 && <div className="h-8 w-8 rounded-full ring-2 ring-white bg-neutral-50 flex items-center justify-center text-[10px] font-bold text-neutral-400">+{memberCount - 5}</div>}
                    </div>
                </div>
            </div>
        </div>
      </div>

      {/* Create Vote Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white rounded-2xl p-6 shadow-2xl ring-1 ring-black/5">
            <div className="flex justify-between items-center mb-5">
                <h3 className="text-xl font-bold text-neutral-900">New Vote</h3>
                <button onClick={() => setCreateOpen(false)} className="p-1 rounded-full hover:bg-neutral-100 text-neutral-500"><X className="h-5 w-5" /></button>
            </div>
            
            <div className="space-y-4">
                <div>
                    <label className="block text-xs font-bold text-neutral-400 uppercase mb-1.5">Topic</label>
                    <input value={newTitle} onChange={e => setNewTitle(e.target.value)} className="w-full border border-neutral-200 rounded-xl px-4 py-3 text-sm font-medium focus:ring-2 focus:ring-black outline-none transition-all" placeholder="e.g. When to play?" />
                </div>
                
                <div>
                    <label className="block text-xs font-bold text-neutral-400 uppercase mb-1.5">Duration</label>
                    <div className="flex gap-3">
                        <select value={pollDuration} onChange={e => setPollDuration(e.target.value)} className="border border-neutral-200 bg-neutral-50 rounded-xl px-4 py-3 text-sm font-medium flex-1 outline-none focus:ring-2 focus:ring-black">
                            <option value="1">1 Hour</option>
                            <option value="24">24 Hours</option>
                            <option value="48">2 Days</option>
                            <option value="custom">Custom...</option>
                        </select>
                        {pollDuration === 'custom' && (
                            <input type="datetime-local" value={customEndDate} onChange={e => setCustomEndDate(e.target.value)} className="border border-neutral-200 bg-neutral-50 rounded-xl px-3 py-3 text-sm font-medium flex-[1.5] outline-none focus:ring-2 focus:ring-black" />
                        )}
                    </div>
                </div>

                <div>
                    <label className="block text-xs font-bold text-neutral-400 uppercase mb-1.5">Options (one per line)</label>
                    <textarea value={newOptions} onChange={e => setNewOptions(e.target.value)} className="w-full border border-neutral-200 rounded-xl px-4 py-3 text-sm font-medium focus:ring-2 focus:ring-black outline-none min-h-[100px]" placeholder={"Saturday 20:00\nSunday 14:00"} />
                    <p className="text-[10px] text-neutral-400 mt-1 italic text-right">"Not Coming" added automatically.</p>
                </div>
                
                <div className="flex justify-end gap-3 pt-2">
                    <button onClick={() => setCreateOpen(false)} className="px-5 py-2.5 text-sm font-bold text-neutral-500 hover:bg-neutral-50 rounded-xl transition-colors">Cancel</button>
                    <button onClick={confirmCreateVoting} className="px-6 py-2.5 text-sm font-bold bg-black text-white rounded-xl shadow-lg hover:bg-neutral-800 active:scale-95 transition-all">Create Vote</button>
                </div>
            </div>
          </div>
        </div>
      )}

      {/* Members Modal */}
      {membersOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
            <div className="flex justify-between items-center mb-4 shrink-0">
                <h3 className="text-xl font-bold text-neutral-900">Members ({members.length})</h3>
                <button onClick={() => setMembersOpen(false)} className="p-1 rounded-full hover:bg-neutral-100 text-neutral-500"><X className="h-5 w-5" /></button>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-2 space-y-2">
               {members.map((m) => (
                 <div key={m.user_id} className="flex items-center justify-between p-2 rounded-xl hover:bg-neutral-50 transition-colors">
                    <div className="flex items-center gap-3">
                       <div className="h-10 w-10 rounded-full bg-neutral-200 flex items-center justify-center overflow-hidden">
                          {m.avatar_url ? (
                             <img src={m.avatar_url} className="w-full h-full object-cover" />
                          ) : (
                             <span className="text-sm font-bold text-neutral-500">{(m.name || "?").slice(0,1)}</span>
                          )}
                       </div>
                       <div>
                          <div className="text-sm font-bold text-neutral-900">{m.name || "User"}</div>
                          {m.role === 'host' && <div className="text-[10px] text-amber-600 font-bold uppercase tracking-wide">Host</div>}
                          {m.role === 'owner' && <div className="text-[10px] text-amber-600 font-bold uppercase tracking-wide">Owner</div>}
                       </div>
                    </div>
                 </div>
               ))}
            </div>
          </div>
        </div>
      )}

      {/* Chat Panel - WRAPPED IN MODAL */}
      {chatOpen && group && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 animate-in zoom-in-95 duration-200">
           {/* Backdrop */}
           <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setChatOpen(false)} />
           
           {/* Modal Content */}
           <div className="relative w-full max-w-2xl h-[85vh] bg-white rounded-3xl shadow-2xl overflow-hidden ring-1 ring-black/10">
               <Suspense fallback={<div className="flex h-full items-center justify-center">Loading...</div>}>
                 <ChatPanel 
                   groupId={group.id} 
                   onClose={() => { setChatOpen(false); setChatFull(false); }} 
                   full={true}
                   setFull={() => {}}
                 />
               </Suspense>
           </div>
        </div>
      )}
    </>
  );
}