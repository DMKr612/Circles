import { useEffect, useState, useRef, lazy, Suspense } from "react";
import { supabase } from "@/lib/supabase";
import { useNavigate } from "react-router-dom";
import { useLocation } from "react-router-dom";
import { MessageSquare, Users, User, ArrowLeft, Send, Search as SearchIcon, Filter } from "lucide-react";
import Spinner from "@/components/ui/Spinner";
import ViewOtherProfileModal from "@/components/ViewOtherProfileModal"; // 1. Import Modal

// Lazy load the existing group chat component
const ChatPanel = lazy(() => import("../components/ChatPanel"));

type ChatItem = {
  type: 'group' | 'dm';
  id: string; // group_id or friend_user_id
  name: string;
  avatar_url: string | null;
  subtitle: string;
  isFavorite?: boolean;
};

type DMMsg = {
  id: string;
  from_id: string;
  to_id: string;
  body: string;
  created_at: string;
};

export default function Chats() {
  const navigate = useNavigate();
  const location = useLocation();
  const [me, setMe] = useState<string | null>(null);
  const [list, setList] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Selection State
  const [selected, setSelected] = useState<ChatItem | null>(null);

  // Profile Modal State
  const [viewProfileId, setViewProfileId] = useState<string | null>(null); // 2. Add State

  // DM Specific State
  const [dmMessages, setDmMessages] = useState<DMMsg[]>([]);
  const [dmInput, setDmInput] = useState("");
  const [dmLoading, setDmLoading] = useState(false);
  const dmEndRef = useRef<HTMLDivElement>(null);

  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  // 1. Load User & List (Groups + Friends)
  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setMe(user.id);

      // Fetch Groups
      const { data: groups } = await supabase
        .from("group_members")
        .select("group_id, groups(id, title, category)")
        .eq("user_id", user.id)
        .eq("status", "active");

      // Fetch Friends
      const { data: friends } = await supabase
        .from("friendships")
        .select("user_id_a, user_id_b")
        .or(`user_id_a.eq.${user.id},user_id_b.eq.${user.id}`)
        .eq("status", "accepted");

      const items: ChatItem[] = [];

      // Process Groups
      if (groups) {
        groups.forEach((g: any) => {
          if (g.groups) {
            items.push({
              type: 'group',
              id: g.groups.id,
              name: g.groups.title,
              avatar_url: null,
              subtitle: g.groups.category || 'Group'
            });
          }
        });
      }

      // Process Friends
      if (friends) {
        const friendIds = friends.map((f: any) => 
          f.user_id_a === user.id ? f.user_id_b : f.user_id_a
        );
        if (friendIds.length > 0) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("user_id, name, avatar_url")
            .in("user_id", friendIds);
          
          profiles?.forEach((p: any) => {
            items.push({
              type: 'dm',
              id: p.user_id,
              name: p.name || "User",
              avatar_url: p.avatar_url,
              subtitle: "Direct Message"
            });
          });
        }
      }

      items.sort((a, b) => a.name.localeCompare(b.name));
      setList(items);
      setLoading(false);
    }
    load();
  }, []);

  // Auto-select DM if location.state?.openDmId is provided
  useEffect(() => {
    const openId = location.state?.openDmId;
    if (openId && list.length > 0 && !selected) {
      const found = list.find(i => i.id === openId && i.type === 'dm');
      if (found) {
        setSelected(found);
      } else {
        (async () => {
          const { data: p } = await supabase
            .from("profiles")
            .select("name, avatar_url")
            .eq("user_id", openId)
            .single();
          if (p) {
            const newChat: ChatItem = {
              type: "dm",
              id: openId,
              name: p.name || "User",
              avatar_url: p.avatar_url,
              subtitle: "Direct Message",
            };
            setList((prev) => [newChat, ...prev]);
            setSelected(newChat);
          }
        })();
      }
      window.history.replaceState({}, "");
    }
  }, [location.state, list, selected]);

  // 2. Load DM Messages when a Friend is selected
  useEffect(() => {
    if (!me || !selected || selected.type !== 'dm') return;

    let sub: any = null;
    
    async function loadDMs() {
      setDmLoading(true);
      const otherId = selected!.id;
      
      const { data } = await supabase
        .from("direct_messages")
        .select("*")
        .or(`and(from_id.eq.${me},to_id.eq.${otherId}),and(from_id.eq.${otherId},to_id.eq.${me})`)
        .order("created_at", { ascending: true })
        .limit(100);
      
      setDmMessages(data || []);
      setDmLoading(false);
      setTimeout(() => dmEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);

      sub = supabase.channel(`dm:${otherId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'direct_messages' },
          (payload) => {
            const newMsg = payload.new as DMMsg;
            const isMatch = 
              (newMsg.from_id === me && newMsg.to_id === otherId) ||
              (newMsg.from_id === otherId && newMsg.to_id === me);

            if (isMatch) {
              setDmMessages(prev => [...prev, newMsg]);
              setTimeout(() => dmEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
            }
          }
        )
        .subscribe();
    }

    loadDMs();

    return () => {
      if (sub) supabase.removeChannel(sub);
    };
  }, [selected, me]);

  // 3. Send DM
  const sendDM = async () => {
    if (!dmInput.trim() || !me || !selected || selected.type !== 'dm') return;
    const text = dmInput.trim();
    setDmInput("");
    await supabase.from("direct_messages").insert({
      from_id: me,
      to_id: selected.id,
      body: text
    });
  };

  const getFilteredList = () => {
    return list.filter(item => {
      if(filter === "groups" && item.type !== "group") return false;
      if(filter === "private" && item.type !== "dm") return false;
      if(filter === "fav" && !item.isFavorite) return false;
      if(!item.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  };

  const filteredList = getFilteredList();

  const FilterPill = ({ id, label }: { id: string; label: string }) => (
    <button 
      onClick={() => setFilter(id)} 
      className={`
        whitespace-nowrap px-4 py-1.5 rounded-full text-xs font-semibold transition-all border
        ${filter === id 
          ? "bg-neutral-900 text-white border-neutral-900 shadow-md transform scale-105" 
          : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50 hover:border-neutral-300"}
      `}
    >
      {label}
    </button>
  );

  // Component: The Chat List (Sidebar)
  const ChatList = () => (
    <div className={`flex flex-col h-full bg-white border-r border-neutral-200 ${selected ? 'hidden md:flex' : 'flex'} w-full md:w-80 lg:w-96`}>
      <div className="p-5 border-b border-neutral-100 bg-white/80 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">Chats</h1>
          {loading && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-neutral-900"></div>}
        </div>
        
        <div className="relative mb-4 group">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-neutral-400 group-focus-within:text-emerald-600 transition-colors">
            <SearchIcon className="h-4 w-4" />
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search conversations..."
            className="block w-full pl-10 pr-3 py-2.5 border border-neutral-200 rounded-xl leading-5 bg-neutral-50 placeholder-neutral-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-sm font-medium"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          <FilterPill id="all" label="All" />
          <FilterPill id="groups" label="Groups" />
          <FilterPill id="private" label="Private" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 flex justify-center"><Spinner /></div>
        ) : filteredList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-neutral-400 px-6 text-center">
            <div className="w-16 h-16 bg-neutral-50 rounded-full flex items-center justify-center mb-4">
              <Filter className="h-6 w-6 opacity-30" />
            </div>
            <p className="text-sm font-medium">No chats found.</p>
            <p className="text-xs mt-1 opacity-70">Try adjusting your filters or search.</p>
          </div>
        ) : (
          <div className="px-2 py-2 space-y-1">
            {filteredList.map(item => (
              <button
                key={item.type + item.id}
                onClick={() => setSelected(item)}
                className={`
                  w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all duration-200
                  ${selected?.id === item.id 
                    ? 'bg-emerald-50 shadow-sm ring-1 ring-emerald-100' 
                    : 'hover:bg-neutral-50'}
                `}
              >
                <div className={`
                  h-12 w-12 rounded-full flex items-center justify-center text-lg font-bold shrink-0 shadow-sm
                  ${item.type === 'group' 
                    ? 'bg-gradient-to-br from-indigo-100 to-indigo-200 text-indigo-700' 
                    : 'bg-gradient-to-br from-neutral-100 to-neutral-200 text-neutral-600'}
                `}>
                  {item.type === 'dm' && item.avatar_url ? (
                    <img src={item.avatar_url} alt="" className="h-full w-full object-cover rounded-full" />
                  ) : (
                    item.type === 'group' ? <Users className="h-5 w-5" /> : item.name.slice(0,1).toUpperCase()
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className={`font-semibold truncate ${selected?.id === item.id ? 'text-emerald-900' : 'text-neutral-900'}`}>
                    {item.name}
                  </div>
                  <div className="text-xs text-neutral-500 truncate mt-0.5">
                    {item.subtitle}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // Component: The Active Window (Right Pane)
  const ActiveChat = () => {
    if (!selected) {
      return (
        <div className="hidden md:flex flex-1 items-center justify-center bg-neutral-50/50 flex-col gap-6">
          <div className="bg-white p-6 rounded-full shadow-sm ring-1 ring-black/5">
            <MessageSquare className="h-12 w-12 text-emerald-500/50" />
          </div>
          <div className="text-center">
            <h3 className="text-lg font-semibold text-neutral-900">Select a conversation</h3>
            <p className="text-sm text-neutral-500 mt-1">Choose a group or friend to start chatting</p>
          </div>
        </div>
      );
    }

    // 3. Helper to handle clicks on header
    const handleHeaderClick = () => {
      if (selected.type === 'group') {
        navigate(`/group/${selected.id}`);
      } else if (selected.type === 'dm') {
        setViewProfileId(selected.id); // <--- OPEN MODAL INSTEAD OF NAVIGATE
      }
    };

    return (
      <div className="fixed inset-0 z-50 pb-20 md:pb-0 md:static md:inset-auto md:flex-1 bg-white flex flex-col h-full">
        {/* Header */}
        <div className="h-[72px] border-b border-neutral-200 flex items-center px-4 gap-4 bg-white/95 backdrop-blur-sm shrink-0 shadow-sm z-20">
          <button onClick={() => setSelected(null)} className="md:hidden p-2 -ml-2 rounded-full hover:bg-neutral-100 transition-colors">
            <ArrowLeft className="h-5 w-5 text-neutral-600" />
          </button>
          
          <div 
            onClick={handleHeaderClick} 
            className="flex items-center gap-4 flex-1 min-w-0 cursor-pointer hover:opacity-70 transition-opacity"
            title={`View ${selected.type === 'group' ? 'Group' : 'Profile'}`}
          >
            <div className={`h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold shadow-sm ${selected.type === 'group' ? 'bg-indigo-100 text-indigo-700' : 'bg-neutral-100 text-neutral-600'}`}>
               {selected.type === 'dm' && selected.avatar_url ? (
                 <img src={selected.avatar_url} alt="" className="h-full w-full object-cover rounded-full" />
               ) : (
                 selected.type === 'group' ? '#' : selected.name.slice(0,1)
               )}
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="font-bold text-neutral-900 truncate text-base">{selected.name}</div>
              <div className="text-xs text-neutral-500 flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${selected.type === 'group' ? 'bg-indigo-500' : 'bg-emerald-500'}`}></span>
                {selected.type === 'group' ? 'Group Chat' : 'Direct Message'}
              </div>
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-hidden relative bg-neutral-50"> 
          {/* Background Pattern */}
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none" 
               style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg width='20' height='20' viewBox='0 0 20 20' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23000000' fill-opacity='1' fill-rule='evenodd'%3E%3Ccircle cx='3' cy='3' r='1'/%3E%3C/g%3E%3C/svg%3E")` }}>
          </div>

          {selected.type === 'group' ? (
            <Suspense fallback={<div className="h-full w-full flex items-center justify-center"><Spinner /></div>}>
              <div className="h-full w-full relative z-10">
                <ChatPanel 
                  groupId={selected.id} 
                  onClose={() => setSelected(null)} 
                  full={true} 
                  setFull={()=>{}} 
                  user={{ id: me }}
                />
              </div>
            </Suspense>
          ) : (
            // Custom DM Interface
            <div className="flex flex-col h-full relative z-10">
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {dmLoading && (
                  <div className="flex justify-center py-4">
                    <div className="bg-white/80 px-4 py-1.5 rounded-full text-xs font-medium text-neutral-500 shadow-sm border border-neutral-100">
                      Loading history...
                    </div>
                  </div>
                )}
                {!dmLoading && dmMessages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-neutral-400 space-y-3">
                    <div className="w-16 h-16 bg-white rounded-full shadow-sm flex items-center justify-center">
                      <MessageSquare className="h-8 w-8 text-neutral-200" />
                    </div>
                    <div className="text-sm">No messages yet. Say hi! 👋</div>
                  </div>
                )}
                
                {dmMessages.map((m, idx) => {
                  const isMine = m.from_id === me;
                  const showAvatar = !isMine && (idx === 0 || dmMessages[idx-1].from_id !== m.from_id);
                  
                  return (
                    <div key={m.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'} group animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                      <div className={`flex max-w-[80%] md:max-w-[70%] ${isMine ? 'flex-row-reverse' : 'flex-row'} items-end gap-2`}>
                        {/* Avatar placeholder for friend side */}
                        {!isMine && (
                          <div className="w-6 h-6 shrink-0 mb-1">
                            {showAvatar && (
                              selected.avatar_url ? 
                              <img src={selected.avatar_url} className="w-6 h-6 rounded-full object-cover shadow-sm" /> :
                              <div className="w-6 h-6 rounded-full bg-neutral-200 flex items-center justify-center text-[9px] font-bold text-neutral-500">
                                {selected.name.slice(0,1)}
                              </div>
                            )}
                          </div>
                        )}

                        <div className={`
                          px-4 py-2.5 text-sm shadow-sm relative
                          ${isMine 
                            ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white rounded-2xl rounded-tr-sm' 
                            : 'bg-white text-neutral-800 border border-neutral-100 rounded-2xl rounded-tl-sm'}
                        `}>
                          {m.body}
                          <div className={`text-[9px] mt-1 text-right opacity-70 ${isMine ? 'text-emerald-100' : 'text-neutral-400'}`}>
                            {new Date(m.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={dmEndRef} />
              </div>
              
              {/* DM Input */}
              <div className="p-4 bg-white border-t border-neutral-200/80 backdrop-blur-md">
                <div className="flex items-center gap-2 max-w-4xl mx-auto bg-neutral-50 border border-neutral-200 rounded-full px-2 py-2 focus-within:ring-2 focus-within:ring-emerald-500/20 focus-within:border-emerald-500 transition-all shadow-inner">
                  <input
                    value={dmInput}
                    onChange={(e) => setDmInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendDM()}
                    placeholder="Type a message..."
                    className="flex-1 bg-transparent border-0 px-4 py-1 text-sm focus:ring-0 text-neutral-900 placeholder-neutral-400 outline-none"
                  />
                  <button 
                    onClick={sendDM}
                    disabled={!dmInput.trim()}
                    className={`
                      p-2.5 rounded-full transition-all duration-200 flex items-center justify-center shadow-sm
                      ${dmInput.trim() 
                        ? 'bg-emerald-600 text-white hover:bg-emerald-700 hover:scale-105 active:scale-95' 
                        : 'bg-neutral-200 text-neutral-400 cursor-not-allowed'}
                    `}
                  >
                    <Send className="h-4 w-4 ml-0.5" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Main Layout
  return (
    <>
      <div className="flex h-[calc(100vh-64px)] w-full overflow-hidden bg-white fixed top-0 left-0">
        <ChatList />
        <ActiveChat />
      </div>
      
      {/* 4. Render the Modal */}
      <ViewOtherProfileModal
        isOpen={!!viewProfileId}
        onClose={() => setViewProfileId(null)}
        viewUserId={viewProfileId}
      />
    </>
  );
}