import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Users, Calendar, MessageSquare, UserPlus, UserCheck, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/App";

type FriendState = 'none' | 'pending_in' | 'pending_out' | 'accepted' | 'blocked';

interface ViewOtherProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  viewUserId: string | null;
}

export default function ViewOtherProfileModal({ isOpen, onClose, viewUserId }: ViewOtherProfileModalProps) {
  const navigate = useNavigate();

  const { user } = useAuth();
  const uid = user?.id || null;

  const [viewName, setViewName] = useState<string>("");
  const [viewAvatar, setViewAvatar] = useState<string | null>(null);
  const [viewAllowRatings, setViewAllowRatings] = useState<boolean>(true);
  const [viewRatingAvg, setViewRatingAvg] = useState<number>(0);
  const [viewRatingCount, setViewRatingCount] = useState<number>(0);

  const [totalGroups, setTotalGroups] = useState<number>(0);
  const [mutualGroupsCount, setMutualGroupsCount] = useState<number>(0);
  const [mutualGroupNames, setMutualGroupNames] = useState<string[]>([]);
  const [targetGroupNames, setTargetGroupNames] = useState<string[]>([]);

  const [myRating, setMyRating] = useState<number>(0);
  const [rateBusy, setRateBusy] = useState(false);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [viewFriendStatus, setViewFriendStatus] = useState<FriendState>('none');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !viewUserId || !uid) return;

    setErr(null);
    setRateBusy(false);
    setHoverRating(null);

    async function loadData() {
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

      const { data: pair } = await supabase
        .from('rating_pairs')
        .select('stars')
        .eq('rater_id', uid)
        .eq('ratee_id', viewUserId)
        .maybeSingle();
      setMyRating(Number(pair?.stars ?? 0));

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
      } else setTargetGroupNames([]);

      const { data: myGroups } = await supabase
        .from("group_members")
        .select("group_id")
        .eq("user_id", uid)
        .eq("status", "active");

      const myGroupIds = new Set((myGroups || []).map((r: any) => r.group_id));

      const mutualIds = targetGroupIds.filter(gid => myGroupIds.has(gid));
      setMutualGroupsCount(mutualIds.length);

      if (mutualIds.length > 0) {
        const { data: mutualDetails } = await supabase
          .from("groups")
          .select("title")
          .in("id", mutualIds)
          .limit(3);
        setMutualGroupNames((mutualDetails || []).map((g: any) => g.title));
      } else setMutualGroupNames([]);
    }

    loadData();
  }, [isOpen, viewUserId, uid]);

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
    } catch (e) {}
  }

  async function rateUser(n: number) {
    if (!uid || !viewUserId || rateBusy || !viewAllowRatings) return;
    setRateBusy(true);
    const prev = myRating;
    setMyRating(n);
    try {
      const { error } = await supabase.rpc('submit_rating', { p_ratee: viewUserId, p_stars: n });
      if (error) throw error;
      const { data } = await supabase.from('profiles').select('rating_avg,rating_count').eq('user_id', viewUserId).single();
      if (data) {
        setViewRatingAvg(data.rating_avg);
        setViewRatingCount(data.rating_count);
      }
    } catch (e: any) {
      setMyRating(prev);
      setErr("Failed to rate.");
    } finally {
      setRateBusy(false);
    }
  }

  function goToChat() {
    if (!viewUserId) return;
    onClose();
    navigate('/chats', { state: { openDmId: viewUserId } });
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl">
        <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full bg-white text-neutral-500">
          <X className="h-5 w-5" />
        </button>

        <div className="flex flex-col items-center mb-6">
          <div className="h-24 w-24 rounded-full bg-neutral-200 overflow-hidden">
            {viewAvatar ? (
              <img src={viewAvatar} className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full flex items-center justify-center text-3xl font-bold text-neutral-500">
                {viewName.slice(0,1).toUpperCase()}
              </div>
            )}
          </div>
          <h2 className="text-xl font-bold mt-3">{viewName}</h2>
        </div>

        <div className="flex gap-3 mb-6">
          <button onClick={goToChat} className="flex-1 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold flex items-center justify-center gap-2">
            <MessageSquare className="h-4 w-4" /> Message
          </button>

          {viewFriendStatus === 'none' && (
            <button onClick={() => handleFriendAction('add')} className="flex-1 py-2 rounded-xl bg-black text-white text-sm font-bold flex items-center justify-center gap-2">
              <UserPlus className="h-4 w-4" /> Add
            </button>
          )}

          {viewFriendStatus === 'pending_in' && (
            <button onClick={() => handleFriendAction('accept')} className="flex-1 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold flex items-center justify-center gap-2">
              <UserCheck className="h-4 w-4" /> Accept
            </button>
          )}

          {viewFriendStatus === 'accepted' && (
            <button onClick={() => handleFriendAction('remove')} className="flex-1 py-2 rounded-xl bg-neutral-200 text-neutral-600 text-sm font-bold flex items-center justify-center gap-2">
              <UserCheck className="h-4 w-4" /> Friends
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="p-3 rounded-xl bg-neutral-50 text-center">
            <div className="text-xl font-bold">{totalGroups}</div>
            <div className="text-[10px] uppercase font-bold text-neutral-500 mt-1 flex items-center justify-center gap-1">
              <Calendar className="h-3 w-3" /> Groups Joined
            </div>
          </div>

          <div className="p-3 rounded-xl bg-blue-50 text-center">
            <div className="text-xl font-bold text-blue-600">{mutualGroupsCount}</div>
            <div className="text-[10px] uppercase font-bold text-blue-400 mt-1 flex items-center justify-center gap-1">
              <Users className="h-3 w-3" /> Mutual Groups
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

        {/* Rating Area */}
        {viewAllowRatings && viewFriendStatus !== 'blocked' && (
          <div className="pt-3 border-t border-neutral-100">
            <div className="text-center text-xs font-medium text-neutral-400 mb-2">Rate this player</div>
            <div className="flex justify-center gap-1">
              {Array.from({ length: 6 }).map((_, i) => {
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
    </div>
  );
}