import { Link, useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Search, Users, Tag, ArrowLeft, Sparkles, Globe, MapPin, ChevronDown, ChevronUp } from "lucide-react";

/**
 * BrowsePage
 * Modern, mobile-optimized browse screen.
 * "Filter by Game" removed. "Recent Groups" is collapsible and shows location context.
 */

export type Game = {
  id: string;
  name: string;
  blurb: string;
  tag: string;
  online: number;
  groups: number;
  image: string;
};

type GroupRow = { id: string; title: string | null; description?: string | null; city?: string | null; category?: string | null; capacity?: number | null; created_at?: string | null; game?: string | null; code?: string | null; };

const CATEGORIES = ["All", "Games", "Study", "Outdoors"] as const;

export const GAMES: Game[] = [
  { id: "hokm",   name: "Hokm",        blurb: "Classic Persian card game",      tag: "Games",    online: 120, groups: 8,  image: "🎴" },
  { id: "takhtenard",   name: "Takhte Nard", blurb: "Traditional backgammon",         tag: "Games",    online: 95,  groups: 6,  image: "🎲" },
  { id: "mafia",  name: "Mafia",       blurb: "Social deduction party game",     tag: "Games",    online: 210, groups: 12, image: "🕵️" },
  { id: "mono",   name: "Monopoly",    blurb: "Buy, sell, and trade properties", tag: "Games",    online: 180, groups: 10, image: "💰" },
  { id: "uno",    name: "Uno",         blurb: "Colorful card matching fun",      tag: "Games",    online: 250, groups: 15, image: "🃏" },
  { id: "chess",  name: "Chess",       blurb: "Classic strategy board game",     tag: "Games",    online: 130, groups: 9,  image: "♟️" },
  { id: "mathematics",   name: "Mathematics", blurb: "Study numbers", tag: "Study",   online: 75,  groups: 5,  image: "📐" },
  { id: "biology",    name: "Biology",     blurb: "Explore life sciences",             tag: "Study",   online: 60,  groups: 4,  image: "🧬" },
  { id: "chemistry",   name: "Chemistry",   blurb: "Chemicals and reactions", tag: "Study",  online: 50,  groups: 3,  image: "⚗️" },
  { id: "history",   name: "History",     blurb: "Past events and cultures",  tag: "Study",  online: 45,  groups: 3,  image: "📜" },
  { id: "dreisam",  name: "Hiking", blurb: "Join a hike up the mountain", tag: "Outdoors", online: 40, groups: 3,  image: "⛰️" },
  { id: "visit",   name: "Visiting",    blurb: "Cultural and city visits",            tag: "Outdoors", online: 55, groups: 4,  image: "🏛️" },
  { id: "camp",    name: "Camping",     blurb: "Overnight outdoor trips",     tag: "Outdoors", online: 35, groups: 2,  image: "🏕️" },
  { id: "kayak",   name: "Kayaking",    blurb: "Water adventures", tag: "Outdoors", online: 30, groups: 2, image: "🛶" },
];

export default function BrowsePage() {
  const [params, setParams] = useSearchParams();
  const groupId = params.get("id");
  const code = params.get("code");
  const [q, setQ] = useState<string>(params.get("q") ?? "");
  const [cat, setCat] = useState<typeof CATEGORIES[number]>(
    (params.get("category") as typeof CATEGORIES[number]) ?? "All"
  );

  // Dropdown state for Recent Groups (default open)
  const [recentGroupsOpen, setRecentGroupsOpen] = useState(true); 

  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  
  // Stats
  const [groupCountByGame, setGroupCountByGame] = useState<Record<string, number>>({});
  const [memberCountByGame, setMemberCountByGame] = useState<Record<string, number>>({});
  const [totalOnlineLive, setTotalOnlineLive] = useState<number>(0);

  // User's city for the "recent groups" button label context
  const [userCity, setUserCity] = useState<string | null>(null);

  // Request Modal
  const [showReq, setShowReq] = useState(false);
  const [reqName, setReqName] = useState("");
  const [reqNote, setReqNote] = useState("");
  const [reqBusy, setReqBusy] = useState(false);
  const [reqMsg, setReqMsg] = useState<string | null>(null);

  // Sync URL
  useEffect(() => {
    const next = new URLSearchParams(params);
    if (cat && cat !== "All") next.set("category", cat); else next.delete("category");
    if (q) next.set("q", q); else next.delete("q");
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [q, cat, groupId, code]);

  // Detect Code
  const codeFromQ = useMemo(() => {
    const s = (q || "").trim().replace(/[^A-Za-z0-9]/g, "");
    return /^[A-Za-z0-9]{6,16}$/.test(s) ? s.toUpperCase() : null;
  }, [q]);

  // Load User City (for the dropdown label)
  useEffect(() => {
    (async () => {
        const { data: u } = await supabase.auth.getUser();
        if (!u.user) return;
        const { data: prof } = await supabase.from('profiles').select('city').eq('user_id', u.user.id).maybeSingle();
        if (prof?.city) setUserCity(prof.city);
    })();
  }, []);

  // Load Groups (Search by code/ID/recent)
  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setLoading(true);
        setGroups([]);
        
        // 1. Search by Code
        if (code || codeFromQ) {
            const raw = (code || codeFromQ)!;
            const cleaned = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
            const { data, error } = await supabase
                .from("groups")
                .select("id, title, description, city, category, game, created_at, code")
                .or(`code.eq.${cleaned},id.eq.${raw}`) // check code OR uuid
                .maybeSingle();
            
            if (!error && data) {
                if (mounted) setGroups([data]);
                setLoading(false);
                // If a specific group is found via code/search, auto-open the dropdown
                setRecentGroupsOpen(true);
                return;
            }
        }

        // 2. Browse Recent
        let query = supabase
          .from("groups")
          .select("id, title, description, city, category, game, created_at, code")
          .order("created_at", { ascending: false })
          .limit(50);

        // Apply Category Filter
        if (cat && cat !== "All") {
           query = query.eq("category", cat.toLowerCase());
        }
        
        if (q && !codeFromQ) {
           query = query.ilike("title", `%${q}%`);
        }

        const { data } = await query;
        if (mounted) setGroups(data || []);
      } catch (e) {
        console.warn(e);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [cat, q, code, codeFromQ, reloadTick]);

  // Load Stats
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: gm } = await supabase.from("group_members").select("user_id, groups(game)");
      if (!mounted || !gm) return;
      
      const gc: Record<string, number> = {};
      const mc: Record<string, number> = {};
      const users = new Set<string>();

      gm.forEach((r: any) => {
         const g = (r.groups?.game || "").toLowerCase();
         if (g) {
             gc[g] = (gc[g] || 0) + 1;
             mc[g] = (mc[g] || 0) + 1;
         }
         if (r.user_id) users.add(r.user_id);
      });

      setGroupCountByGame(gc);
      setMemberCountByGame(mc);
      setTotalOnlineLive(users.size);
    })();
    return () => { mounted = false; };
  }, []);

  // Filter games for the dropdown based on search/category
  const filteredGames = useMemo(() => {
    const byCat = cat === "All" ? GAMES : GAMES.filter(g => g.tag === cat);
    if (!q) return byCat;
    return byCat.filter(g => g.name.toLowerCase().includes(q.toLowerCase()));
  }, [q, cat]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 pb-32">
      
      {/* Header Area */}
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold text-neutral-900 tracking-tight">Discover</h1>
        
        <div className="mt-3 flex items-center justify-between">
           <div className="flex items-center gap-2 text-sm font-medium text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              {totalOnlineLive} Online Now
           </div>
           <button onClick={() => setShowReq(true)} className="text-sm font-semibold text-neutral-500 hover:text-black underline">
              Request Game
           </button>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="sticky top-0 z-30 bg-neutral-50/95 py-3 backdrop-blur-md mb-6 -mx-4 px-4 border-b border-neutral-100 transition-all">
        <div className="relative mb-3">
          <Search className="absolute left-3.5 top-3 h-5 w-5 text-neutral-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search groups, or invite codes..."
            className="w-full h-11 rounded-xl border border-neutral-200 bg-white pl-11 pr-4 text-sm shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black transition-all placeholder:text-neutral-400"
          />
        </div>
        
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {CATEGORIES.map(c => (
            <button
              key={c}
              onClick={() => { setCat(c); }} 
              className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
                cat === c 
                  ? "bg-neutral-900 text-white shadow-md scale-105" 
                  : "bg-white text-neutral-600 border border-neutral-200 hover:bg-neutral-100"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* SECTION: Recent Groups (Collapsible Dropdown Style) */}
      <div className="mb-8">
          <button 
            onClick={() => setRecentGroupsOpen(!recentGroupsOpen)}
            className="w-full flex items-center justify-between bg-neutral-50 border border-neutral-200 rounded-2xl p-4 shadow-sm hover:bg-neutral-100 transition-all active:scale-[0.99]"
          >
             <div className="flex items-center gap-3">
                 <div className="h-10 w-10 flex items-center justify-center bg-white rounded-full text-emerald-600 shadow-sm">
                    <MapPin className="h-5 w-5" />
                 </div>
                 <div className="text-left">
                     <div className="text-xs font-bold text-neutral-400 uppercase tracking-wide">Location</div>
                     <div className="text-base font-bold text-neutral-900 flex items-center gap-2">
                        {userCity ? `${userCity} & Nearby` : "All Locations"}
                        {codeFromQ && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Filtered</span>}
                     </div>
                 </div>
             </div>
             <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-neutral-400">{groups.length} found</span>
                {recentGroupsOpen ? <ChevronUp className="text-neutral-400" /> : <ChevronDown className="text-neutral-400" />}
             </div>
          </button>

          {/* Groups List Content */}
          {recentGroupsOpen && (
              <div className="mt-4 animate-in slide-in-from-top-4 duration-300">
                  {loading ? (
                     <div className="space-y-3">
                         {[1,2,3].map(i => <div key={i} className="h-24 w-full rounded-2xl bg-white animate-pulse shadow-sm" />)}
                     </div>
                  ) : groups.length === 0 ? (
                     <div className="py-12 text-center rounded-3xl bg-neutral-50 border-2 border-dashed border-neutral-200">
                        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm mb-3 text-2xl">
                           🔍
                        </div>
                        <h3 className="text-lg font-bold text-neutral-900">No groups found</h3>
                        <p className="text-sm text-neutral-500 max-w-xs mx-auto mt-1 px-4">
                            Try adjusting your search or filters.
                        </p>
                        <Link to="/create" className="mt-4 inline-block rounded-full bg-black px-6 py-2 text-sm font-bold text-white shadow-lg hover:bg-neutral-800 active:scale-95 transition-all">
                            Create New Group
                        </Link>
                     </div>
                  ) : (
                     <div className="grid gap-3">
                       {groups.map(g => (
                         <Link to={`/group/${g.id}`} key={g.id} className="block group">
                            <div className="relative overflow-hidden rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm transition-all hover:shadow-md hover:border-neutral-200 active:scale-[0.99]">
                               <div className="flex justify-between items-start">
                                  <div className="flex-1 min-w-0 pr-4">
                                     <h3 className="font-bold text-neutral-900 text-base truncate">{g.title}</h3>
                                     <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-neutral-500 font-medium">
                                        <span className="capitalize text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md font-bold">{g.game || g.category}</span>
                                        <span className="flex items-center gap-0.5">
                                           {g.city ? <MapPin className="h-3 w-3"/> : <Globe className="h-3 w-3"/>}
                                           {g.city || "Online"}
                                        </span>
                                     </div>
                                  </div>
                                  <div className="h-8 w-8 flex-shrink-0 rounded-full bg-neutral-50 flex items-center justify-center text-neutral-300 group-hover:bg-black group-hover:text-white transition-colors">
                                     <ArrowLeft className="h-4 w-4 rotate-180" />
                                  </div>
                               </div>
                               {g.description && (
                                  <p className="mt-3 text-sm text-neutral-600 line-clamp-2 leading-relaxed">{g.description}</p>
                               )}
                               {g.code && (
                                   <div className="mt-3 pt-3 border-t border-neutral-50 flex items-center gap-2">
                                       <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">Invite Code</span>
                                       <span className="font-mono text-xs font-bold text-neutral-700 bg-neutral-100 px-1.5 py-0.5 rounded">{g.code}</span>
                                   </div>
                               )}
                            </div>
                         </Link>
                       ))}
                     </div>
                  )}
              </div>
          )}
      </div>

      {/* SECTION: Games Grid */}
      <section>
        <h2 className="text-lg font-bold text-neutral-900 mb-4">Browse by Category</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {filteredGames.map(g => (
             <Link to={`/groups/game/${g.id}`} key={g.id} className="block group">
                <div className="flex items-center p-4 bg-white rounded-2xl border border-neutral-100 shadow-sm transition-all hover:shadow-md hover:border-neutral-200 active:scale-[0.98]">
                   <div className="h-14 w-14 flex items-center justify-center text-3xl bg-neutral-50 rounded-2xl mr-4 shadow-inner ring-1 ring-black/5">
                      {g.image}
                   </div>
                   <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                         <h3 className="font-bold text-neutral-900 truncate">{g.name}</h3>
                         <span className="text-[10px] font-bold bg-neutral-100 text-neutral-500 px-1.5 py-0.5 rounded uppercase tracking-wide">
                            {g.tag}
                         </span>
                      </div>
                      <p className="text-xs text-neutral-500 truncate mt-0.5">{g.blurb}</p>
                      <div className="flex items-center gap-3 mt-2 text-[11px] font-medium text-neutral-400">
                         <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {memberCountByGame[g.id] || 0}</span>
                         <span className="flex items-center gap-1"><Tag className="h-3 w-3" /> {groupCountByGame[g.id] || 0} groups</span>
                      </div>
                   </div>
                </div>
             </Link>
          ))}
        </div>
        {filteredGames.length === 0 && (
            <div className="py-12 text-center text-neutral-500">
                No games found. Try a different search.
            </div>
        )}
      </section>

      {/* Request Modal */}
      {showReq && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
           <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowReq(false)} />
           <div className="relative w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl animate-in zoom-in-95 duration-200">
              <h3 className="text-xl font-bold text-neutral-900 mb-2">Request Game</h3>
              <p className="text-sm text-neutral-500 mb-6">Don't see your favorite game? Let us know.</p>
              
              <div className="space-y-4">
                 <div>
                    <label className="block text-xs font-bold text-neutral-400 uppercase mb-1">Game Name</label>
                    <input 
                       value={reqName}
                       onChange={e => setReqName(e.target.value)}
                       className="w-full rounded-xl border-2 border-neutral-100 px-4 py-3 text-sm font-bold focus:border-black focus:ring-0 outline-none transition-colors"
                       placeholder="e.g. Catan"
                    />
                 </div>
                 <div>
                    <label className="block text-xs font-bold text-neutral-400 uppercase mb-1">Why?</label>
                    <textarea 
                       value={reqNote}
                       onChange={e => setReqNote(e.target.value)}
                       className="w-full rounded-xl border-2 border-neutral-100 px-4 py-3 text-sm focus:border-black focus:ring-0 outline-none transition-colors resize-none"
                       rows={3}
                       placeholder="It's super popular..."
                    />
                 </div>
                 
                 {reqMsg && <p className="text-sm font-medium text-emerald-600 text-center">{reqMsg}</p>}

                 <div className="flex gap-3 pt-2">
                    <button onClick={() => setShowReq(false)} className="flex-1 rounded-xl font-bold text-neutral-500 hover:bg-neutral-50 py-3 text-sm transition-colors">Cancel</button>
                    <button 
                       disabled={reqBusy || !reqName}
                       onClick={async () => {
                          setReqBusy(true);
                          const { data: u } = await supabase.auth.getUser();
                          await supabase.from("category_requests").insert({
                              name: reqName, note: reqNote, requested_by: u.user?.id
                          });
                          setReqMsg("Request sent! Thanks.");
                          setTimeout(() => { setShowReq(false); setReqMsg(null); setReqName(""); }, 1500);
                          setReqBusy(false);
                       }}
                       className="flex-1 rounded-xl bg-black text-white font-bold py-3 text-sm shadow-lg active:scale-95 transition-all disabled:opacity-50 disabled:scale-100"
                    >
                       {reqBusy ? "Sending..." : "Submit"}
                    </button>
                 </div>
              </div>
           </div>
        </div>
      )}
    </div>
  );
}