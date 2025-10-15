import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate, Link } from "react-router-dom";

type Cat = { name: string };
type Opt = { id: string; label: string; category: string };
type Friend = { id: string; display_name: string | null; avatar_url: string | null };

export default function CreateGroupPage() {
  const navigate = useNavigate();
  const presetCategory = "Games";
  const presetGame = "";

  const [cats, setCats] = useState<Cat[]>([]);
  const [opts, setOpts] = useState<Opt[]>([]);
  const [listsLoading, setListsLoading] = useState<boolean>(true);
  const [me, setMe] = useState<string>("");
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendsLoading, setFriendsLoading] = useState<boolean>(true);
  const [inviteeIds, setInviteeIds] = useState<string[]>([]);

  const [inviteQuery, setInviteQuery] = useState("");


  const friendIdSet = useMemo(() => new Set(friends.map(f => f.id)), [friends]);
  const filteredFriends = useMemo(() => {
  const q = inviteQuery.trim().toLowerCase();
  if (!q) return friends;
  return friends.filter(f =>
    (f.display_name || "").toLowerCase().includes(q) ||
    (f.id || "").toLowerCase().includes(q)
  );
}, [friends, inviteQuery]);


async function refreshFriendData(userId: string) {
  setFriendsLoading(true);
  try {
    // 1) accepted friend IDs in both directions
    const [a, b] = await Promise.all([
      supabase.from('friends').select('friend_id').eq('user_id', userId).eq('status', 'accepted'),
      supabase.from('friends').select('user_id').eq('friend_id', userId).eq('status', 'accepted'),
    ]);

    const ids: string[] = [];
    if (!a.error && Array.isArray(a.data)) ids.push(...a.data.map((r: any) => r.friend_id).filter(Boolean));
    if (!b.error && Array.isArray(b.data)) ids.push(...b.data.map((r: any) => r.user_id).filter(Boolean));
    const uniq = Array.from(new Set(ids));

    // 2) If no accepted friends, show suggestions so UI works without SQL seeding
    if (uniq.length === 0) {
      const sel = 'id, user_id, display_name, name, avatar_url';
      const p = await supabase
        .from('profiles')
        .select(sel)
        .neq('id', userId)
        .neq('user_id', userId)
        .limit(12);
      const list: Friend[] = (!p.error && Array.isArray(p.data) ? p.data : []).map((pr: any) => ({
        id: (pr.id || pr.user_id) as string,
        display_name: (pr.display_name || pr.name) ?? null,
        avatar_url: (pr.avatar_url ?? null) as string | null,
      }));
      setFriends(list);
      return;
    }

    // 3) otherwise fetch only those friend profiles (support PK = id OR user_id)
    const sel = 'id, user_id, display_name, name, avatar_url';
    let profs: any[] = [];
    const p1 = await supabase.from('profiles').select(sel).in('id', uniq);
    if (!p1.error && p1.data?.length) {
      profs = p1.data as any[];
    } else {
      const p2 = await supabase.from('profiles').select(sel).in('user_id', uniq);
      if (!p2.error && p2.data?.length) profs = p2.data as any[];
    }

    const list: Friend[] = (profs || [])
      .map(p => ({
        id: (p.id || p.user_id) as string,
        display_name: (p.display_name || p.name) ?? null,
        avatar_url: (p.avatar_url ?? null) as string | null,
      }))
      .filter(f => uniq.includes(f.id));

    setFriends(list);
  } finally {
    setFriendsLoading(false);
  }
}

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (!mounted) return;
      const id = !error ? data?.user?.id : undefined;
      if (id) {
        setMe(id);
        await refreshFriendData(id);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
  let mounted = true;
  (async () => {
    setListsLoading(true);
    const { data: c } = await supabase
      .from("allowed_categories")
      .select("name")
      .eq("is_active", true);
    const { data: g } = await supabase
      .from("allowed_games")
      .select("id,name,category")
      .eq("is_active", true);
    if (!mounted) return;
    setCats(c ?? []);
    setOpts((g ?? []).map((x: { id: string; name: string; category: string }) => ({ id: x.id, label: x.name, category: x.category })));
    setListsLoading(false);
  })();
  return () => { mounted = false; }; 
  }, []);


  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [city, setCity] = useState("");
  const [capacity, setCapacity] = useState<number>(3);

  const [catOpen, setCatOpen] = useState(false);
  const [catQuery, setCatQuery] = useState("");
  const [category, setCategory] = useState<string>("");
  // set default once lists load
  useEffect(() => {
    if (!cats.length) return;
    const label = String(presetCategory || cats[0].name);
    const match = cats.find(c => c.name.toLowerCase() === label.toLowerCase());
    setCategory((match?.name || cats[0].name).toLowerCase());
  }, [cats, presetCategory]);

  const [gameOpen, setGameOpen] = useState(false);
  const [gameQuery, setGameQuery] = useState("");
  const [gameId, setGameId] = useState<string>("");
  useEffect(() => {
    if (!opts.length) return;
    if (!category) return;
    const preset = String(presetGame || "").toLowerCase().replace(/\s+/g, "");
    const found = opts.find(o => o.id === preset || o.label.toLowerCase().replace(/\s+/g, "") === preset);
    if (found) setGameId(found.id);
  }, [opts, presetGame, category]);

  const catOptions = useMemo(() => {
    const q = catQuery.trim().toLowerCase();
    const base = cats.map(c => c.name);
    return q ? base.filter((c) => c.toLowerCase().includes(q)) : base;
  }, [catQuery, cats]);

  const gameOptions = useMemo(() => {
    const list = opts.filter(o => o.category.toLowerCase() === (category || "").toLowerCase());
    const q = gameQuery.trim().toLowerCase();
    return q ? list.filter((o) => o.label.toLowerCase().includes(q) || o.id.includes(q)) : list;
  }, [category, gameQuery, opts]);

  const canSubmit = !listsLoading && title.trim().length > 0 && category && gameId && capacity >= 3 && capacity <= 12;

  function toggleInvite(id: string) {
    setInviteeIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }



  async function sendInvites(groupId: string, inviterId: string) {
    if (!inviteeIds.length) return;
    // Try to insert pending invitations; if table doesn’t exist, fail soft.
    try {
      const payload = inviteeIds.map(rid => ({ group_id: groupId, inviter_id: inviterId, recipient_id: rid, status: 'pending' }));
      await supabase.from('group_invitations').insert(payload);
    } catch {}
    // Try to create notifications entries for recipients.
    try {
      const notes = inviteeIds.map(rid => ({ user_id: rid, kind: 'group_invite', payload: { group_id: groupId, inviter_id: inviterId }, is_read: false }));
      await supabase.from('notifications').insert(notes);
    } catch {}
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    const { data: u, error: uErr } = await supabase.auth.getUser();
    if (uErr || !u?.user?.id) {
      alert(uErr?.message || "Sign in required");
      return;
    }
    const uid = u.user.id;

    const cap = Math.max(3, Math.min(12, capacity));

    // insert only columns that certainly exist; let triggers/defaults handle the rest
    const row = {
      title: title.trim(),
      purpose: description.trim() || null,   // maps UI description -> DB "purpose"
      category: (category || "").toLowerCase(),
      game: gameId,                          // allowed_games.id
      capacity: cap,
      visibility: 'public',                  // baseline readable
      host_id: uid,                          // required for RLS/host policies
    } as const;

    const { data: created, error } = await supabase
      .from("groups")
      .insert(row)
      .select("id")
      .single();

    if (error) {
      alert(error.message);
      return;
    }

    // Optionally create pending invites + notifications; navigate immediately.
    sendInvites(created.id, uid);
    navigate(`/group/${created.id}`);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pb-12 pt-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Create a new group</h1>
        <Link to="/browse" className="rounded-md border px-3 py-1.5 text-sm hover:bg-black/[0.04]">Back</Link>
      </div>

      <div className="grid gap-6">
        {/* Basics card */}
        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-medium">Basics</h2>
          {listsLoading && (<div className="text-sm text-neutral-500">Loading categories…</div>)}
          <div className="grid gap-5">
            {/* Title */}
            <div>
              <label className="block text-xs font-medium text-neutral-700">Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Friday Night Hokm"
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-emerald-500"
              />
            </div>

            {/* Category combobox */}
            <div>
              <label className="block text-xs font-medium text-neutral-700">Category</label>
              <div className="relative mt-1">
                <input
                  value={catOpen ? catQuery : category || ""}
                  onChange={(e) => { setCatOpen(true); setCatQuery(e.target.value); }}
                  onFocus={() => setCatOpen(true)}
                  placeholder="Search or choose category…"
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-emerald-500"
                  disabled={listsLoading}
                />
                {catOpen && (
                  <div className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border bg-white shadow">
                    {catOptions.length === 0 && (
                      <div className="px-3 py-2 text-sm text-neutral-500">No matches</div>
                    )}
                    {catOptions.map((label: string) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => {
                          setCategory(label.toLowerCase());
                          setCatOpen(false);
                          setCatQuery("");
                          if (!opts.some(o => o.category === label && o.id === gameId)) setGameId("");
                        }}
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-50"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Game/Activity combobox */}
            <div>
              <label className="block text-xs font-medium text-neutral-700">Game / Activity</label>
              <div className="relative mt-1">
                <input
                  value={gameOpen ? gameQuery : (opts.find((o) => o.category.toLowerCase() === (category || "").toLowerCase() && o.id === gameId)?.label || "")}
                  onChange={(e) => { setGameOpen(true); setGameQuery(e.target.value); }}
                  onFocus={() => setGameOpen(true)}
                  placeholder="Search or choose game/activity…"
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-emerald-500"
                  disabled={listsLoading || !(category && category.trim().length > 0)}
                />
                {gameOpen && (
                  <div className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border bg-white shadow">
                    {gameOptions.length === 0 && (
                      <div className="px-3 py-2 text-sm text-neutral-500">No matches</div>
                    )}
                    {gameOptions.map((o: Opt) => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => { setGameId(o.id); setGameOpen(false); setGameQuery(""); }}
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-50"
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* City (optional) */}
            <div>
              <label className="block text-xs font-medium text-neutral-700">City (optional)</label>
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g., Freiburg"
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-emerald-500"
              />
            </div>

            {/* Capacity (> 1) */}
            <div>
              <label className="block text-xs font-medium text-neutral-700">Capacity</label>
              <input
                type="number"
                min={3}
                max={12}
                value={capacity}
                onChange={(e) => setCapacity(Math.max(3, Math.min(12, Number(e.target.value || 3))))}
                className="mt-1 w-32 rounded-lg border px-3 py-2 text-sm outline-none focus:border-emerald-500"
              />
              <p className="mt-1 text-xs text-neutral-500">Must be between 3 and 12.</p>
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-medium text-neutral-700">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Tell people what this group is about…"
                rows={4}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-emerald-500"
              />
            </div>
          </div>
        </section>

        {/* Invite friends card */}
        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-medium">Invite friends (optional)</h2>
          <p className="mt-1 text-xs text-neutral-500">Filters your friends. If you have none yet, we show suggested people so you can test invites.</p>

          {/* Search box */}
          <div className="mb-3">
            <input
              value={inviteQuery}
              onChange={(e) => setInviteQuery(e.target.value)}
              placeholder="Search people by name…"
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-emerald-500"
            />
          </div>

          {/* Your friends */}
          <div className="mb-4">
            <div className="mb-2 text-xs font-medium text-neutral-700">
              Your friends <span className="font-normal text-neutral-500">({filteredFriends.length})</span>
             </div>
            {friendsLoading && (<div className="text-sm text-neutral-500">Loading friends…</div>)}
            {!friendsLoading && filteredFriends.length === 0 && (
              <div className="text-sm text-neutral-500">No friends match your search.</div>
            )}
            {!friendsLoading && filteredFriends.length > 0 && (
              <div>
                <div className="mb-2 text-xs text-neutral-500">Selected: {inviteeIds.length}</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {filteredFriends.map((f) => (
                    <button
                      type="button"
                      key={f.id}
                      onClick={() => toggleInvite(f.id)}
                      className={[
                        'flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm hover:bg-neutral-50',
                        inviteeIds.includes(f.id) ? 'border-emerald-400 ring-2 ring-emerald-200' : 'border-neutral-200'
                      ].join(' ')}
                    >
                      <div className="h-6 w-6 shrink-0 rounded-full bg-neutral-200" style={{ backgroundImage: f.avatar_url ? `url(${f.avatar_url})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }} />
                      <span className="truncate">{f.display_name || f.id.slice(0, 8)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>


          {inviteeIds.length > 0 && (
            <p className="mt-3 text-xs text-emerald-700">Invitees receive a notification and must accept.</p>
          )}
        </section>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2">
          <Link to="/browse" className="rounded-md border px-3 py-1.5 text-sm hover:bg-black/[0.04]">Cancel</Link>
          <button
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="rounded-md bg-emerald-700 px-4 py-2 text-white disabled:opacity-60"
          >
            Create Group
          </button>
        </div>
      </div>
    </div>
  );
}