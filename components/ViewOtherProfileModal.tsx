import React, { useEffect, useMemo, useState } from "react";
// FIX: Use a relative path from `components/` to `src/lib/`
import { supabase } from "@/lib/supabase";

// Demo stubs for toast calls
const success = (m?: string) => console.log("[ok]", m || "");
const error = (m?: string) => console.error("[err]", m || "");

type PairStatus = {
  stars: number | null;
  updated_at: string | null;
  next_allowed_at: string | null;
  edit_used: boolean;
};

type FriendState = 'none' | 'pending_in' | 'pending_out' | 'accepted' | 'blocked';

interface ViewOtherProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  viewUserId: string | null;
}

function fmtCooldown(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function ViewOtherProfileModal({ isOpen, onClose, viewUserId }: ViewOtherProfileModalProps) {
  const [uid, setUid] = useState<string | null>(null);

  // Modal state
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
  const [viewFriendStatus, setViewFriendStatus] = useState<FriendState>('none');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      setUid(auth.user?.id || null);
    })();
  }, []);

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

  // Load profile when modal opens or viewUserId changes
  useEffect(() => {
    if (!isOpen || !viewUserId || !uid) return;
    
    // Reset state
    setErr(null);
    setRateBusy(false);
    setHoverRating(null);

    async function loadData() {
      const { data: prof } = await supabase
        .from("profiles")
        .select("user_id,name,avatar_url,allow_ratings,rating_avg,rating_count")
        .eq("user_id", viewUserId)
        .maybeSingle();
      setViewName((prof as any)?.name ?? viewUserId!.slice(0,6));
      setViewAvatar((prof as any)?.avatar_url ?? null);
      setViewAllowRatings(Boolean((prof as any)?.allow_ratings ?? true));
      setViewRatingAvg(Number((prof as any)?.rating_avg ?? 0));
      setViewRatingCount(Number((prof as any)?.rating_count ?? 0));

      // Prefill my existing rating + window status
      await loadPairStatus(viewUserId!);

      // Load friend status
      const { data: rel } = await supabase
        .from("friendships")
        .select("id,user_id_a,user_id_b,status,requested_by")
        .or(`and(user_id_a.eq.${uid},user_id_b.eq.${viewUserId}),and(user_id_a.eq.${viewUserId},user_id_b.eq.${uid})`)
        .limit(1)
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
    }
    
    loadData();
    
  }, [isOpen, viewUserId, uid]);
  
  // --- Actions ---

  async function sendFriendRequest() {
    if (!viewUserId) return;
    try {
      const { error: rpcErr } = await supabase.rpc("request_friend", { target_id: viewUserId });
      if (rpcErr) throw rpcErr;
      setViewFriendStatus('pending_out');
      success('Friend request sent');
    } catch (e: any) {
      error(e?.message || 'Could not send friend request');
    }
  }

  async function acceptFriend() {
    if (!viewUserId) return;
    try {
      const { error: rpcErr } = await supabase.rpc("accept_friend", { from_id: viewUserId });
      if (rpcErr) throw rpcErr;
      setViewFriendStatus('accepted');
      success('Friend request accepted');
    } catch (e: any) {
      error(e?.message || 'Could not accept friend request');
    }
  }

  async function removeFriend() {
    if (!viewUserId) return;
    try {
      const { error: rpcErr } = await supabase.rpc("remove_friend", { other_id: viewUserId });
      if (rpcErr) throw rpcErr;
      setViewFriendStatus('none');
      success('Removed');
    } catch (e: any) {
      error(e?.message || 'Could not remove friend');
    }
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
  
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40">
      <div className="w-[560px] max-w-[92vw] rounded-2xl border border-black/10 bg-white p-5 shadow-xl">
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
              <div className="text-xs text-neutral-600">{viewUserId}</div>
            </div>
          </div>
          <button onClick={onClose} className="rounded-md border border-black/10 px-2 py-1 text-sm">Close</button>
        </div>
        
        {err && <div className="mb-2 text-xs text-red-600">{err}</div>}

        <div className="space-y-3">
          <div className="rounded-md border border-black/10 p-3 text-sm">
            <div className="mb-2 font-medium text-neutral-800">Friend status</div>
            {viewFriendStatus === 'accepted' && (
              <div className="flex items-center gap-2">
                <span className="text-emerald-700">You are friends.</span>
                <button
                  onClick={removeFriend}
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
                  onClick={acceptFriend}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white"
                >Accept</button>
              </div>
            )}
            {viewFriendStatus === 'pending_out' && <div className="text-neutral-700">You sent a friend request.</div>}
            {viewFriendStatus === 'none' && (
              <button
                onClick={sendFriendRequest}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white"
              >Add Friend</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}