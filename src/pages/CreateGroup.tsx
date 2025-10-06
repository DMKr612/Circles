import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useLocation, useNavigate, Link } from "react-router-dom";

type Cat = { name: string };
type Opt = { id: string; label: string; category: string };

export default function CreateGroupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const s = (location.state as any) || {};
  const presetCategory = (s.presetCategory as string | undefined) ?? "Games";
  const presetGame = (s.presetGame as string | undefined) ?? "";

  const [cats, setCats] = useState<Cat[]>([]);
  const [opts, setOpts] = useState<Opt[]>([]);
  const [listsLoading, setListsLoading] = useState<boolean>(true);

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
    setCategory(match?.name || cats[0].name);
  }, [cats, presetCategory]);

  const [gameOpen, setGameOpen] = useState(false);
  const [gameQuery, setGameQuery] = useState("");
  const [gameId, setGameId] = useState<string>("");
  useEffect(() => {
    if (!opts.length) return;
    const preset = String(presetGame || "").toLowerCase().replace(/\s+/g, "");
    const found = opts.find(o => o.id === preset || o.label.toLowerCase().replace(/\s+/g, "") === preset);
    if (found) setGameId(found.id);
  }, [opts, presetGame]);

  const catOptions = useMemo(() => {
    const q = catQuery.trim().toLowerCase();
    const base = cats.map(c => c.name);
    return q ? base.filter((c) => c.toLowerCase().includes(q)) : base;
  }, [catQuery, cats]);

  const gameOptions = useMemo(() => {
    const list = opts.filter(o => o.category === category);
    const q = gameQuery.trim().toLowerCase();
    return q ? list.filter((o) => o.label.toLowerCase().includes(q) || o.id.includes(q)) : list;
  }, [category, gameQuery, opts]);

  const canSubmit = !listsLoading && title.trim().length > 0 && category && gameId && capacity >= 3 && capacity <= 12;

  async function handleSubmit() {
    if (!canSubmit) return;
    const { data: u, error: uErr } = await supabase.auth.getUser();
    if (uErr || !u?.user?.id) {
      alert(uErr?.message || "Sign in required");
      return;
    }
    const uid = u.user.id;

    const cap = Math.max(3, Math.min(12, capacity));

    const row = {
      title: title.trim(),
      description: description.trim() || null,
      city: city.trim() || null,
      category: (category || "").toLowerCase(),
      game: gameId,              // canonical slug
      capacity: cap,                  // enforce >= 3 and <= 12 by UI
      host_id: uid,              // required for RLS + host-only polls
      creator_id: uid,           // REQUIRED by schema (NOT NULL)
      is_online: true,
      quick_match: false,
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

    // Add creator as a member (role/status must match enums)
    await supabase.from("group_members").upsert({
      group_id: created.id,
      user_id: uid,
      role: "member",
      status: "active",
    });

    navigate(`/groups/game/${encodeURIComponent(gameId)}`);
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Create Group</h1>
        <Link to="/browse" className="rounded-md border px-3 py-1.5 text-sm hover:bg-black/[0.04]">Back</Link>
      </div>

      {listsLoading && (<div className="text-sm text-neutral-500">Loading categories…</div>)}

      <div className="space-y-5">
        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-neutral-800">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Friday Night Hokm"
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
        </div>

        {/* Category combobox */}
        <div>
          <label className="block text-sm font-medium text-neutral-800">Category</label>
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
                      setCategory(label);
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
          <label className="block text-sm font-medium text-neutral-800">Game / Activity</label>
          <div className="relative mt-1">
            <input
              value={gameOpen ? gameQuery : (opts.find((o) => o.category === category && o.id === gameId)?.label || "")}
              onChange={(e) => { setGameOpen(true); setGameQuery(e.target.value); }}
              onFocus={() => setGameOpen(true)}
              placeholder="Search or choose game/activity…"
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-emerald-500"
              disabled={listsLoading || !category}
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
          <label className="block text-sm font-medium text-neutral-800">City (optional)</label>
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="e.g., Freiburg"
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
        </div>

        {/* Capacity (> 1) */}
        <div>
          <label className="block text-sm font-medium text-neutral-800">Capacity</label>
          <input
            type="number"
            min={2}
            max={12}
            value={capacity}
            onChange={(e) => setCapacity(Math.max(2, Math.min(12, Number(e.target.value || 2))))}
            className="mt-1 w-32 rounded-lg border px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
          <p className="mt-1 text-xs text-neutral-500">Must be between 2 and 12.</p>
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-neutral-800">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Tell people what this group is about…"
            rows={4}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-2">
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