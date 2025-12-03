import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronUp, MessageCircle, CheckSquare, UserPlus, Mail } from "lucide-react";
import { useAuth } from "@/App";

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  
  // Raw Data
  const [friendReqs, setFriendReqs] = useState<any[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [polls, setPolls] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);

  // UI State
  const [showOlder, setShowOlder] = useState(false);

  useEffect(() => {
    if (!user) return;

    const userId = user.id;

    async function loadData() {
      setLoading(true);
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

      try {
        const { data: rpcData } = await supabase.rpc("get_my_friend_requests");

        const friendRequests = (rpcData || []).map((r: any) => ({
          id: r.id,
          // We map sender_id to user_id_a so the existing Accept button works
          user_id_a: r.sender_id, 
          created_at: r.created_at,
          profiles: {
            name: r.sender_name,
            avatar_url: r.sender_avatar
          }
        }));

        const { data: inv } = await supabase
          .from("group_members" as any)
          .select("group_id, created_at, groups(title)")
          .eq("user_id", userId)
          .eq("status", "invited")
          .gt("created_at", twoWeeksAgo);

        const { data: myGroups } = await supabase
          .from("group_members" as any)
          .select("group_id")
          .eq("user_id", userId)
          .eq("status", "active");

        const gIds = myGroups?.map((g: any) => g.group_id) || [];

        let fetchedPolls: any[] = [];
        let fetchedMsgs: any[] = [];

        if (gIds.length > 0) {
          const { data: p } = await supabase
            .from("group_polls" as any)
            .select("id, title, group_id, created_at, groups(title)")
            .in("group_id", gIds)
            .eq("status", "open")
            .gt("created_at", twoWeeksAgo)
            .order("created_at", { ascending: false });
          fetchedPolls = p || [];

          const { data: m } = await supabase
            .from("group_messages" as any)
            .select("group_id, created_at, groups(title)")
            .in("group_id", gIds)
            .neq("user_id", userId)
            .gt("created_at", twoWeeksAgo)
            .order("created_at", { ascending: false })
            .limit(50);
          fetchedMsgs = m || [];
        }

        setFriendReqs(friendRequests || []);
        setInvites(inv || []);
        setPolls(fetchedPolls);
        setMessages(fetchedMsgs);
      } catch (e) {
        console.error("Error loading notifications", e);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [user]);

  // --- Process Data (Grouping & Sorting) ---

  const processedEvents = useMemo(() => {
    const events: any[] = [];
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    // A. Friend Requests
    friendReqs.forEach(r => {
      events.push({
        id: `fr-${r.id}`,
        type: 'friend_req',
        date: new Date(r.created_at),
        data: r
      });
    });

    // B. Group Invites
    invites.forEach(i => {
      events.push({
        id: `inv-${i.group_id}`,
        type: 'invite',
        date: new Date(i.created_at),
        data: i
      });
    });

    // C. Polls (Deduplicated by ID)
    const uniquePolls = new Map();
    polls.forEach(p => {
      if (!uniquePolls.has(p.id)) {
        uniquePolls.set(p.id, p);
      }
    });
    
    Array.from(uniquePolls.values()).forEach((p: any) => {
      events.push({
        id: `poll-${p.id}`,
        type: 'poll',
        date: new Date(p.created_at),
        data: p
      });
    });

    // D. Messages (WHATSAPP STYLE AGGREGATION)
    // Group messages by Group ID. Instead of showing 5 rows, show "5 new messages"
    const msgGroups: Record<string, { count: number, latest: Date, groupName: string }> = {};
    
    messages.forEach(m => {
      const gid = m.group_id;
      if (!msgGroups[gid]) {
        msgGroups[gid] = { 
          count: 0, 
          latest: new Date(m.created_at), 
          groupName: m.groups?.title || "Unknown Group" 
        };
      }
      msgGroups[gid].count++;
      // keep track of newest message time for sorting
      const mDate = new Date(m.created_at);
      if (mDate > msgGroups[gid].latest) msgGroups[gid].latest = mDate;
    });

    Object.keys(msgGroups).forEach(gid => {
      events.push({
        id: `msg-group-${gid}`,
        type: 'message_summary',
        date: msgGroups[gid].latest,
        data: { 
          group_id: gid, 
          title: msgGroups[gid].groupName, 
          count: msgGroups[gid].count 
        }
      });
    });

    // Sort all by date descending
    events.sort((a, b) => b.date.getTime() - a.date.getTime());

    // Split into Recent (< 24h) and Older (> 24h)
    const recent = events.filter(e => (now - e.date.getTime()) < oneDay);
    const older = events.filter(e => (now - e.date.getTime()) >= oneDay);

    return { recent, older };
  }, [friendReqs, invites, polls, messages]);

  // --- Handlers ---

  async function handleAcceptFriend(id: string, fromId: string) {
    await supabase.rpc("accept_friend", { from_id: fromId });
    setFriendReqs(prev => prev.filter(r => r.id !== id));
  }

  async function handleJoinGroup(gid: string) {
    if (!user) return;
    await supabase.from("group_members" as any).update({ status: "active" }).eq("group_id", gid).eq("user_id", user!.id);
    setInvites(prev => prev.filter(i => i.group_id !== gid));
    navigate(`/group/${gid}`);
  }

  // --- Render Helpers ---

  const renderEvent = (e: any) => {
    const isRecent = (Date.now() - e.date.getTime()) < (24 * 60 * 60 * 1000);
    
    return (
      <div key={e.id} className="bg-white border border-neutral-100 p-3 rounded-2xl flex items-center gap-3 shadow-sm mb-3 animate-in fade-in slide-in-from-bottom-2">
        {/* Icon Column */}
        <div className={`h-10 w-10 shrink-0 rounded-full flex items-center justify-center ${
          e.type === 'friend_req' ? 'bg-purple-100 text-purple-600' :
          e.type === 'invite' ? 'bg-amber-100 text-amber-600' :
          e.type === 'poll' ? 'bg-blue-100 text-blue-600' :
          'bg-emerald-100 text-emerald-600'
        }`}>
          {e.type === 'friend_req' && <UserPlus className="h-5 w-5" />}
          {e.type === 'invite' && <Mail className="h-5 w-5" />}
          {e.type === 'poll' && <CheckSquare className="h-5 w-5" />}
          {e.type === 'message_summary' && <MessageCircle className="h-5 w-5" />}
        </div>

        {/* Content Column */}
        <div className="flex-1 min-w-0">
          
          {/* Friend Request */}
          {e.type === 'friend_req' && (
            <>
              <div className="text-sm font-bold text-neutral-900">{e.data.profiles?.name || "User"}</div>
              <div className="text-xs text-neutral-500">Sent you a friend request</div>
              <div className="mt-2 flex gap-2">
                <button onClick={() => handleAcceptFriend(e.data.id, e.data.user_id_a)} className="bg-black text-white px-3 py-1 rounded-full text-xs font-bold">Accept</button>
              </div>
            </>
          )}

          {/* Group Invite */}
          {e.type === 'invite' && (
            <>
              <div className="text-sm font-bold text-neutral-900">{e.data.groups?.title}</div>
              <div className="text-xs text-neutral-500">You were invited to join</div>
              <div className="mt-2 flex gap-2">
                <button onClick={() => handleJoinGroup(e.data.group_id)} className="bg-black text-white px-3 py-1 rounded-full text-xs font-bold">Join</button>
              </div>
            </>
          )}

          {/* Poll */}
          {e.type === 'poll' && (
            <div onClick={() => navigate(`/group/${e.data.group_id}`)} className="cursor-pointer">
              <div className="text-sm font-bold text-neutral-900">{e.data.title}</div>
              <div className="text-xs text-neutral-500 flex items-center gap-1">
                Vote in <span className="font-medium text-neutral-700">{e.data.groups?.title}</span>
              </div>
            </div>
          )}

          {/* Message Summary (WhatsApp Style) */}
          {e.type === 'message_summary' && (
            <div onClick={() => navigate(`/group/${e.data.group_id}`)} className="cursor-pointer">
              <div className="text-sm font-bold text-neutral-900">{e.data.title}</div>
              <div className="text-xs text-neutral-500 font-medium">
                {e.data.count} new message{e.data.count > 1 ? 's' : ''}
              </div>
            </div>
          )}
        </div>

        {/* Time Column */}
        <div className="text-[10px] text-neutral-400 whitespace-nowrap self-start">
           {isRecent ? e.date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : e.date.toLocaleDateString()}
        </div>
      </div>
    );
  };

  if (loading) {
    return <div className="pt-24 text-center text-neutral-400 text-sm">Checking for updates...</div>;
  }

  const { recent, older } = processedEvents;
  const isEmpty = recent.length === 0 && older.length === 0;

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8 pb-32">
      <h1 className="text-2xl font-extrabold text-neutral-900 mb-6">Activity</h1>

      {isEmpty && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="h-16 w-16 bg-neutral-100 rounded-full flex items-center justify-center mb-4">
            <span className="text-2xl">💤</span>
          </div>
          <h3 className="text-neutral-900 font-bold">All caught up</h3>
          <p className="text-neutral-500 text-sm">No new notifications in the last 2 weeks.</p>
        </div>
      )}

      {/* Recent Section */}
      {recent.length > 0 && (
        <div className="mb-6">
          <h2 className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-3">New</h2>
          {recent.map(renderEvent)}
        </div>
      )}

      {/* Older Section (Collapsible) */}
      {older.length > 0 && (
        <div>
          <button 
            onClick={() => setShowOlder(!showOlder)}
            className="flex items-center gap-2 text-xs font-bold text-neutral-400 uppercase tracking-wider mb-3 hover:text-neutral-600 transition-colors w-full"
          >
            {showOlder ? <ChevronUp className="h-4 w-4"/> : <ChevronDown className="h-4 w-4"/>}
            Earlier ({older.length})
          </button>
          
          {showOlder && (
            <div className="animate-in slide-in-from-top-2 fade-in duration-300">
              {older.map(renderEvent)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}