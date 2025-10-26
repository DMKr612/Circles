import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate, Link } from "react-router-dom";

// map for quick lookups when rendering selected chips
const EMPTY_ARR: string[] = [];

import { State, City } from 'country-state-city';

// Build German city list dynamically (no flatMap to avoid lib target issues)
const DE_CITIES: string[] = (() => {
  const states = (State.getStatesOfCountry('DE') || []) as Array<{ isoCode: string; name: string }>;
  const names: string[] = [];
  for (const s of states) {
    const cities = (City.getCitiesOfState('DE', s.isoCode) || []) as Array<{ name: string }>;
    for (const c of cities) {
      if (c && typeof c.name === 'string' && c.name.trim()) {
        names.push(c.name.trim());
      }
    }
  }
  return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b, 'de'));
})();

function suggestCity(input: string): string | null {
  const q = input.trim().toLowerCase();
  if (!q) return null;
  const exact = DE_CITIES.find(n => n.toLowerCase() === q);
  if (exact) return exact;
  return DE_CITIES.find(n => n.toLowerCase().startsWith(q)) ?? null;
}

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
  const friendsById = useMemo(() => new Map(friends.map(f => [f.id, f])), [friends]);


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
  const [cityTouched, setCityTouched] = useState(false);
  const cityCanonical = useMemo(() => suggestCity(city), [city]);
  const cityValid = !!cityCanonical;
  const [cityOpen, setCityOpen] = useState(false);
  const [cityIdx, setCityIdx] = useState<number>(-1);
  const filteredCities = useMemo(() => {
    const q = city.trim().toLowerCase();
    if (!q) return DE_CITIES.slice(0, 8);
    return DE_CITIES.filter(n => n.toLowerCase().includes(q)).slice(0, 8);
  }, [city]);
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

  const canSubmit = !listsLoading
    && title.trim().length > 0
    && category
    && gameId
    && capacity >= 3 && capacity <= 12
    && cityValid; // city required and must be in whitelist

  function toggleInvite(id: string) {
    setInviteeIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }



  async function sendInvites(groupId: string, inviterId: string) {
    if (!inviteeIds.length) return;

    // 0) Try server-side RPC (SECURITY DEFINER) that handles RLS and also creates notifications
    try {
      const { error: rpcErr } = await supabase.rpc('send_group_invites', {
        p_group_id: groupId,
        p_recipient_ids: inviteeIds,
      });
      if (!rpcErr) {
        console.debug('[CreateGroup] send_group_invites RPC ok', { groupId, inviteeCount: inviteeIds.length });
        return;
      }
      console.warn('[CreateGroup] send_group_invites RPC failed, will fallback', rpcErr?.message);
    } catch (e) {
      console.warn('[CreateGroup] send_group_invites RPC threw, will fallback', e);
    }

    // 1) Fallback: create pending invitations client-side (RLS should allow inviter to insert)
    try {
      const payload = inviteeIds.map((rid) => ({
        group_id: groupId,
        inviter_id: inviterId,
        recipient_id: rid,
        status: 'pending',
      }));
      const { error: invErr } = await supabase.from('group_invitations').insert(payload);
      if (invErr) console.warn('[CreateGroup] group_invitations insert failed', invErr.message);
    } catch {}

    // 2) Fallback notifications attempt (may be blocked by RLS). We enrich payload so the UI can render nicely.
    try {
      // Optionally fetch group title for nicer notification payload
      let groupTitle: string | null = null;
      try {
        const { data: g } = await supabase.from('groups').select('title').eq('id', groupId).maybeSingle();
        groupTitle = (g as any)?.title ?? null;
      } catch {}

      // Try to resolve inviter display name
      let inviterName: string | null = null;
      try {
        const { data: p } = await supabase
          .from('profiles')
          .select('display_name,name')
          .in('id', [inviterId])
          .maybeSingle();
        inviterName = (p as any)?.display_name || (p as any)?.name || null;
      } catch {}

      const notes = inviteeIds.map((rid) => ({
        user_id: rid, // NOTE: RLS likely blocks this unless done via RPC
        kind: 'group_invite',
        payload: {
          group_id: groupId,
          group_title: groupTitle,
          inviter_id: inviterId,
          inviter_name: inviterName,
        },
        is_read: false,
      }));

      const { error: noteErr } = await supabase.from('notifications').insert(notes);
      if (noteErr) console.warn('[CreateGroup] notifications insert likely blocked by RLS (expected). Use RPC send_group_invites.', noteErr.message);
    } catch {}
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    if (!cityValid) { setCityTouched(true); return; }
    const { data: u, error: uErr } = await supabase.auth.getUser();
    if (uErr || !u?.user?.id) {
      alert(uErr?.message || "Sign in required");
      return;
    }
    const uid = u.user.id;

    const cap = Math.max(3, Math.min(12, capacity));

    // insert only columns that certainly exist; let triggers/defaults handle the rest
    const cleanedCity = (cityCanonical ?? null);
    const row = {
      title: title.trim(),
      purpose: (description.trim().replace(/\s+$/, '') || null),
      category: (category || "").toLowerCase(),
      game: gameId,                          // allowed_games.id
      city: cleanedCity,                     // <-- persist city to DB
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
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Create a new Circle</h1>
          <p className="mt-1 text-sm text-neutral-600">A small, calm space for the right people.</p>
        </div>
        <Link to="/browse" className="rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50">Back</Link>
      </div>

      <div className="grid gap-6">
        {/* Basics card */}
        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-medium text-neutral-800">Basics</h2>
          {listsLoading && (<div className="text-sm text-neutral-500">Loading categories…</div>)}
          <div className="grid gap-5">
            {/* Title */}
            <div>
              <label className="block text-xs font-medium text-neutral-700">Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Friday Night Hokm"
                className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
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
                  className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
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
                  className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
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

            {/* City (required) */}
            <div className="relative">
              <label className="block text-xs font-medium text-neutral-700">City <span className="text-red-600">*</span></label>
              <input
                value={city}
                onChange={(e) => { setCity(e.target.value); setCityOpen(true); setCityIdx(-1); }}
                onFocus={() => setCityOpen(true)}
                onBlur={() => { setTimeout(() => setCityOpen(false), 120); setCityTouched(true); }}
                onKeyDown={(e) => {
                  if (!cityOpen) return;
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setCityIdx((i) => Math.min(filteredCities.length - 1, i + 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setCityIdx((i) => Math.max(-1, i - 1));
                  } else if (e.key === 'Enter') {
                    if (cityIdx >= 0 && filteredCities[cityIdx]) {
                      e.preventDefault();
                      setCity(filteredCities[cityIdx]);
                      setCityOpen(false);
                    }
                  }
                }}
                placeholder="Start typing… e.g., Offenburg"
                className={[
                  "mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30",
                  cityTouched && !cityValid ? "border-red-400 focus:border-red-500" : ""
                ].join(" ")}
                aria-autocomplete="list"
                aria-expanded={cityOpen}
                aria-controls="city-suggest"
                role="combobox"
              />
              {cityOpen && filteredCities.length > 0 && (
                <div
                  id="city-suggest"
                  className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-neutral-200 bg-white shadow-lg"
                  role="listbox"
                >
                  {filteredCities.map((n, i) => (
                    <button
                      type="button"
                      key={n + i}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { setCity(n); setCityOpen(false); setCityIdx(-1); }}
                      className={[
                        "flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-emerald-50",
                        i === cityIdx ? "bg-emerald-50" : ""
                      ].join(" ")}
                      role="option"
                      aria-selected={i === cityIdx}
                    >
                      <span className="truncate">{n}</span>
                    </button>
                  ))}
                </div>
              )}
              {!cityValid && cityTouched && (
                <p className="mt-1 text-xs text-red-600">Choose a city from suggestions.</p>
              )}
              {cityValid && cityTouched && cityCanonical !== city && (
                <p className="mt-1 text-xs text-neutral-500">Using “{cityCanonical}”.</p>
              )}
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
                className="mt-1 w-32 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
              />
              <p className="mt-1 text-xs text-neutral-500">Between 3 and 12 people.</p>
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-medium text-neutral-700">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Tell people what this group is about…"
                rows={4}
                className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
              />
            </div>
          </div>
        </section>

        {/* Invite friends card (temporarily disabled) */}
        {false && (
        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-medium">Invite friends (optional)</h2>
          <p className="mt-1 text-xs text-neutral-500">Pick people who fit this circle. If you have no friends yet, we show a few suggestions so you can try invites.</p>

          {/* Search box */}
          <div className="mb-3">
            <input
              value={inviteQuery}
              onChange={(e) => setInviteQuery(e.target.value)}
              placeholder="Search people by name…"
              className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
            />
          </div>

          {/* Your friends */}
          <div className="mb-4">
            {inviteeIds.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {inviteeIds.map((id) => {
                  const f = friendsById.get(id);
                  const label = (f?.display_name || id.slice(0,8));
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggleInvite(id)}
                      className="inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs text-emerald-800 hover:bg-emerald-100"
                    >
                      <span className="inline-block h-4 w-4 rounded-full bg-neutral-200" style={{ backgroundImage: f?.avatar_url ? `url(${f.avatar_url})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }} />
                      {label}
                      <span className="ml-1 text-neutral-500">×</span>
                    </button>
                  );
                })}
              </div>
            )}
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
                        'flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                        inviteeIds.includes(f.id) ? 'border-emerald-300 bg-emerald-50' : 'border-neutral-200 hover:bg-neutral-50'
                      ].join(' ')}
                    >
                      <div className="h-6 w-6 shrink-0 rounded-full bg-neutral-200" style={{ backgroundImage: f.avatar_url ? `url(${f.avatar_url})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }} />
                      <span className="truncate">{f.display_name || f.id.slice(0, 8)}</span>
                      <span className={[
                        'ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium',
                        inviteeIds.includes(f.id) ? 'bg-emerald-100 text-emerald-800' : 'bg-neutral-100 text-neutral-600'
                      ].join(' ')}>
                        {inviteeIds.includes(f.id) ? 'Selected' : 'Invite'}
                      </span>
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
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2">
          <Link to="/browse" className="rounded-md border px-3 py-1.5 text-sm hover:bg-black/[0.04]">Cancel</Link>
          <button
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="rounded-md bg-emerald-600 px-4 py-2 text-white shadow-sm hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 disabled:opacity-60"
          >
            Create Group
          </button>
        </div>
      </div>
    </div>
  );
}