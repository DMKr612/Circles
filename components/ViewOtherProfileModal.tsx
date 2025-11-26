import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Users, Trophy, Calendar } from "lucide-react";

// Types
type FriendState = 'none' | 'pending_in' | 'pending_out' | 'accepted' | 'blocked';

interface ViewOtherProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  viewUserId: string | null;
}

export default function ViewOtherProfileModal({ isOpen, onClose, viewUserId }: ViewOtherProfileModalProps) {
  const [uid, setUid] = useState<string | null>(null);

  // Profile State
  const [viewName, setViewName] = useState<string>("");
  const [viewAvatar, setViewAvatar] = useState<string | null>(null);
  const [viewAllowRatings, setViewAllowRatings] = useState<boolean>(true);
  const [viewRatingAvg, setViewRatingAvg] = useState<number>(0);
  const [viewRatingCount, setViewRatingCount] = useState<number>(0);
  
  // Stats State
  const [totalGroups, setTotalGroups] = useState<number>(0);
  const [mutualGroupsCount, setMutualGroupsCount] = useState<number>(0);
  const [mutualGroupNames, setMutualGroupNames] = useState<string[]>([]);
  const [targetGroupNames, setTargetGroupNames] = useState<string[]>([]);
  
  // Friend/Rating State
  const [myRating, setMyRating] = useState<number>(0);
  const [rateBusy, setRateBusy] = useState(false);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [viewFriendStatus, setViewFriendStatus] = useState<FriendState>('none');
  const [err, setErr] = useState<string | null>(null);

  // Load current user
  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      setUid(auth.user?.id || null);
    })();
  }, []);

  // Load Target Profile Data
  useEffect(() => {
    if (!isOpen || !viewUserId || !uid) return;
    
    setErr(null);
    setRateBusy(false);
    setHoverRating(null);

    async function loadData() {
      // 1. Basic Profile Info
      const { data: prof } = await supabase
        .from("profiles")
        .select("name,avatar_url,allow_ratings,rating_avg,rating_count")
        .eq("user_id", viewUserId)
        .maybeSingle();

      setViewName((prof as any)?.name ?? "User");
      setViewAvatar((prof as any)?.avatar_url ?? null);
      setViewAllowRatings(Boolean((prof as any)?.allow_ratings ?? true));
      setViewRatingAvg(Number((prof as any)?.rating_avg ?? 0));
      setViewRatingCount(Number((prof as any)?.rating_count ?? 0));

      // 2. My Rating of them
      const { data: pair } = await supabase
        .from('rating_pairs')
        .select('stars')
        .eq('rater_id', uid)
        .eq('ratee_id', viewUserId)
        .maybeSingle();
      setMyRating(Number(pair?.stars ?? 0));

      // 3. Friend Status
      const { data: rel } = await supabase
        .from("friendships")
        .select("status,requested_by")
        .or(`and(user_id_a.eq.${uid},user_id_b.eq.${viewUserId}),and(user_id_a.eq.${viewUserId},user_id_b.eq.${uid})`)
        .maybeSingle();

      let st: FriendState = 'none';
      if (rel) {
        if (rel.status === 'accepted') st = 'accepted';
        else if (rel.status === 'blocked') st = 'blocked';
        else if (rel.status === 'pending') {
          st = rel.requested_by === uid ? 'pending_out' : 'pending_in';
        }
      }
      setViewFriendStatus(st);

      // 4. Group Stats (Total & Mutual)
      // Get all groups for target user
      const { data: targetGroups } = await supabase
        .from("group_members")
        .select("group_id")
        .eq("user_id", viewUserId)
        .eq("status", "active");
      
      const targetGroupIds = (targetGroups || []).map((r: any) => r.group_id);
      setTotalGroups(targetGroupIds.length);

      if (targetGroupIds.length > 0) {
         const { data: tgDetails } = await supabase
           .from("groups")
           .select("title")
           .in("id", targetGroupIds)
           .limit(12);
         setTargetGroupNames((tgDetails || []).map((g: any) => g.title));
      } else {
         setTargetGroupNames([]);
      }

      // Get all groups for ME
      const { data: myGroups } = await supabase
        .from("group_members")
        .select("group_id")
        .eq("user_id", uid)
        .eq("status", "active");
        
      const myGroupIds = new Set((myGroups || []).map((r: any) => r.group_id));

      // Find intersection (Mutual)
      const mutualIds = targetGroupIds.filter(gid => myGroupIds.has(gid));
      setMutualGroupsCount(mutualIds.length);

      if (mutualIds.length > 0) {
          const { data: mutualDetails } = await supabase
            .from("groups")
            .select("title")
            .in("id", mutualIds)
            .limit(3); // Limit names to display
          setMutualGroupNames((mutualDetails || []).map((g: any) => g.title));
      } else {
          setMutualGroupNames([]);
      }
    }
    
    loadData();
  }, [isOpen, viewUserId, uid]);
  
  // --- Actions ---

  async function handleFriendAction(action: 'add' | 'accept' | 'remove') {
     if (!viewUserId) return;
     try {
        if (action === 'add') {
            await supabase.rpc("request_friend", { target_id: viewUserId });
            setViewFriendStatus('pending_out');
        } else if (action === 'accept') {
            await supabase.rpc("accept_friend", { from_id: viewUserId });
            setViewFriendStatus('accepted');
        } else {
            await supabase.rpc("remove_friend", { other_id: viewUserId });
            setViewFriendStatus('none');
        }
     } catch (e) { console.error(e); }
  }

  async function rateUser(n: number) {
    if (!uid || !viewUserId || rateBusy || !viewAllowRatings) return;
    setRateBusy(true);
    const prev = myRating;
    setMyRating(n);
    try {
      const { error } = await supabase.rpc('submit_rating', { p_ratee: viewUserId, p_stars: n });
      if (error) throw error;
      
      // Refresh avg
      const { data } = await supabase.from('profiles').select('rating_avg,rating_count').eq('user_id', viewUserId).single();
      if (data) {
          setViewRatingAvg(data.rating_avg);
          setViewRatingCount(data.rating_count);
      }
    } catch (e: any) {
      setMyRating(prev);
      setErr(e.message?.includes('weekly') ? "You can only rate once per week." : "Failed to rate.");
    } finally {
      setRateBusy(false);
    }
  }
  
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl ring-1 ring-black/5 overflow-hidden">
        
        {/* Header / Avatar */}
        <div className="flex flex-col items-center mb-6">
            <div className="h-20 w-20 rounded-full bg-gradient-to-br from-neutral-100 to-neutral-200 p-1 mb-3 shadow-inner">
               {viewAvatar ? (
                   <img src={viewAvatar} className="h-full w-full rounded-full object-cover bg-white" alt={viewName} />
               ) : (
                   <div className="h-full w-full rounded-full bg-white flex items-center justify-center text-2xl font-bold text-neutral-400">
                       {viewName.slice(0,1).toUpperCase()}
                   </div>
               )}
            </div>
            <h2 className="text-xl font-bold text-neutral-900">{viewName}</h2>
            <div className="flex items-center gap-1 mt-1">
                 {/* Star Rating Display */}
                 <div className="flex text-amber-400 text-sm">
                    {Array.from({length:6}).map((_,i) => (
                        <span key={i} className={i < Math.round(viewRatingAvg) ? "fill-current" : "text-neutral-200"}>★</span>
                    ))}
                 </div>
                 <span className="text-xs text-neutral-400">({viewRatingCount})</span>
            </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="bg-neutral-50 rounded-2xl p-3 text-center border border-neutral-100">
                <div className="text-2xl font-bold text-neutral-900">{totalGroups}</div>
                <div className="text-[10px] uppercase font-bold text-neutral-400 flex items-center justify-center gap-1">
                    <Calendar className="h-3 w-3" /> Total Groups
                </div>
            </div>
            <div className="bg-blue-50 rounded-2xl p-3 text-center border border-blue-100">
                <div className="text-2xl font-bold text-blue-600">{mutualGroupsCount}</div>
                <div className="text-[10px] uppercase font-bold text-blue-400 flex items-center justify-center gap-1">
                    <Users className="h-3 w-3" /> In Common
                </div>
            </div>
        </div>

        {/* All Groups They Joined */}
        <div className="mb-6 bg-neutral-50 rounded-xl p-3 border border-neutral-100">
          <div className="text-[10px] font-bold text-neutral-400 uppercase mb-2">
            Groups they joined:
          </div>

          {targetGroupNames.length === 0 ? (
            <div className="text-xs text-neutral-400">No groups found.</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {targetGroupNames.map((name, i) => (
                <span key={i} className="px-2 py-0.5 bg-white border border-neutral-200 rounded-md text-xs font-medium text-neutral-700">
                  {name}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Mutual Groups List (Small Preview) */}
        {mutualGroupNames.length > 0 && (
            <div className="mb-6 bg-neutral-50 rounded-xl p-3 border border-neutral-100">
                <div className="text-[10px] font-bold text-neutral-400 uppercase mb-2">You are both in:</div>
                <div className="flex flex-wrap gap-1.5">
                    {mutualGroupNames.map((name, i) => (
                        <span key={i} className="px-2 py-0.5 bg-white border border-neutral-200 rounded-md text-xs font-medium text-neutral-700">
                            {name}
                        </span>
                    ))}
                    {mutualGroupsCount > 3 && (
                        <span className="px-2 py-0.5 text-xs text-neutral-400">+{mutualGroupsCount - 3} more</span>
                    )}
                </div>
            </div>
        )}

        {/* Actions */}
        <div className="space-y-3">
             {/* Friend Action Button */}
             {viewFriendStatus === 'none' && (
                 <button onClick={() => handleFriendAction('add')} className="w-full py-2.5 rounded-xl bg-black text-white text-sm font-bold shadow-lg active:scale-95 transition-all">
                     Add Friend
                 </button>
             )}
             {viewFriendStatus === 'pending_in' && (
                 <button onClick={() => handleFriendAction('accept')} className="w-full py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold shadow-lg active:scale-95 transition-all">
                     Accept Request
                 </button>
             )}
             {viewFriendStatus === 'accepted' && (
                 <button onClick={() => handleFriendAction('remove')} className="w-full py-2.5 rounded-xl border border-neutral-200 text-neutral-600 text-sm font-bold hover:bg-neutral-50 transition-all">
                     Remove Friend
                 </button>
             )}
             {viewFriendStatus === 'pending_out' && (
                 <button disabled className="w-full py-2.5 rounded-xl bg-neutral-100 text-neutral-400 text-sm font-bold cursor-not-allowed">
                     Request Sent
                 </button>
             )}

             {/* Rating Area */}
             {viewAllowRatings && viewFriendStatus !== 'blocked' && (
                 <div className="pt-3 border-t border-neutral-100">
                     <div className="text-center text-xs font-medium text-neutral-400 mb-2">Rate this player</div>
                     <div className="flex justify-center gap-1">
                        {Array.from({length:6}).map((_, i) => {
                            const n = i + 1;
                            const active = (hoverRating ?? myRating) >= n;
                            return (
                                <button
                                    key={n}
                                    disabled={rateBusy}
                                    onMouseEnter={() => setHoverRating(n)}
                                    onMouseLeave={() => setHoverRating(null)}
                                    onClick={() => rateUser(n)}
                                    className={`text-2xl transition-transform hover:scale-110 ${active ? "text-amber-400" : "text-neutral-200"}`}
                                >
                                    ★
                                </button>
                            );
                        })}
                     </div>
                     {err && <div className="text-center text-[10px] text-red-500 mt-1">{err}</div>}
                 </div>
             )}
        </div>

        <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full hover:bg-neutral-100 text-neutral-400 transition-colors">
            ✕
        </button>

      </div>
    </div>
  );
}