import React, { useEffect, useMemo, useState } from "react";
// @ts-ignore: package ships without TS types in this setup
import { City } from 'country-state-city';
// FIX: Use a relative path from `components/` to `src/lib/`
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/App";

// Demo stubs for toast calls
const success = (m?: string) => console.log("[ok]", m || "");
const error = (m?: string) => console.error("[err]", m || "");

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: { name: string, avatarUrl: string | null }) => void;
}

export default function SettingsModal({ isOpen, onClose, onSave }: SettingsModalProps) {
  const { user } = useAuth();
  const uid = user?.id || null;
  
  // Settings modal state
  const [sName, setSName] = useState<string>("");
  const [sCity, setSCity] = useState<string>("");
  const [sTimezone, setSTimezone] = useState<string>("UTC");
  const [sInterests, setSInterests] = useState<string>("");
  const [sTheme, setSTheme] = useState<'system'|'light'|'dark'>('system');
  const [emailNotifs, setEmailNotifs] = useState<boolean>(false);
  const [pushNotifs, setPushNotifs] = useState<boolean>(false);
  const [allowRatings, setAllowRatings] = useState<boolean>(true);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [initials, setInitials] = useState<string>("?");

  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);

  // All German cities from country-state-city, deduped + sorted
  const [deCities, setDeCities] = useState<string[]>([]);
  const [citiesLoaded, setCitiesLoaded] = useState(false);

  // Helper to get device/browser timezone
  function deviceTZ(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }
  
  // Load German cities dynamically (only once)
  const loadCities = async () => {
    if (citiesLoaded || deCities.length > 0) return;
    setCitiesLoaded(true); // Mark as attempted
    try {
      // FIX: Dynamically import
      const { City } = await import('country-state-city');
      const all = (City.getCitiesOfCountry('DE') || []) as Array<{ name: string }>;
      const names = all.map(c => (c?.name || '').trim()).filter(Boolean);
      setDeCities(Array.from(new Set(names)).sort((a,b)=>a.localeCompare(b)));
    } catch (e) {
      console.error("Failed to load cities", e);
    }
  };

  // On modal open, load current user and profile data
  useEffect(() => {
    if (!isOpen) return;
    
    // Load cities when modal is opened
    loadCities();
    
    // Load theme/notif settings from localStorage
    const LS_THEME = localStorage.getItem('theme') as 'system'|'light'|'dark' | null;
    if (LS_THEME) setSTheme(LS_THEME);
    const LS_EMAIL = localStorage.getItem('emailNotifs');
    if (LS_EMAIL) setEmailNotifs(LS_EMAIL === '1');
    const LS_PUSH = localStorage.getItem('pushNotifs');
    if (LS_PUSH) setPushNotifs(LS_PUSH === '1');

    (async () => {
      if (!uid) {
        onClose(); // Should not happen if modal is opened from profile
        return;
      }
      
      const { data: p, error } = await supabase
        .from("profiles")
        .select("name, city, timezone, interests, avatar_url, allow_ratings")
        .eq("user_id", uid)
        .maybeSingle();
        
      if (error) { setSettingsMsg(error.message); return; }
      
      const name = (p as any)?.name ?? "";
      setSName(name);
      setSCity((p as any)?.city ?? "");
      setSTimezone((p as any)?.timezone ?? deviceTZ());
      const ints = Array.isArray((p as any)?.interests) ? ((p as any).interests as string[]) : [];
      setSInterests(ints.join(", "));
      setAvatarUrl((p as any)?.avatar_url ?? null);
      setAllowRatings((p as any)?.allow_ratings ?? true);
      setInitials((name || user?.email || "?").slice(0, 2).toUpperCase());
    })();
    
  }, [isOpen, onClose, uid, user?.email]);

  function applyTheme(theme: 'system'|'light'|'dark') {
    const root = document.documentElement;
    root.classList.remove('light','dark');
    if (theme === 'light') root.classList.add('light');
    else if (theme === 'dark') root.classList.add('dark');
  }

  async function saveSettings(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!uid) return;
    setSettingsMsg(null);
    setSettingsSaving(true);
    try {
      // sanitize
      const name = sName.trim();
      const city = sCity.trim();
      if (!city) { setSettingsMsg("Please choose a city."); setSettingsSaving(false); return; }
      const timezone = sTimezone.trim() || "UTC";
      const interests = sInterests.split(",").map(s => s.trim()).filter(Boolean);

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ name, city, timezone, interests, allow_ratings: allowRatings })
        .eq("user_id", uid);

      if (updateError) throw updateError;
      
      // Save theme/notifs to localStorage
      localStorage.setItem('theme', sTheme);
      localStorage.setItem('emailNotifs', emailNotifs ? '1' : '0');
      localStorage.setItem('pushNotifs', pushNotifs ? '1' : '0');
      applyTheme(sTheme);

      setSettingsMsg("Saved.");
      success('Profile saved');
      onSave({ name, avatarUrl }); // Pass new data back to Profile page
      
      // Auto-close after 1 sec
      setTimeout(() => {
        onClose();
        setSettingsMsg(null);
      }, 1000);
      
    } catch (err: any) {
      const msg = err?.message || "Failed to save";
      setSettingsMsg(msg);
      error(msg);
    } finally {
      setSettingsSaving(false);
    }
  }

  async function saveAllowRatings(next: boolean) {
    setAllowRatings(next);
    if (!uid) return;
    try {
      await supabase.from('profiles').update({ allow_ratings: next }).eq('user_id', uid);
    } catch {}
  }

  async function onAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!uid || !file) return;
    try {
      setAvatarUploading(true);
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `${uid}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      const url = pub?.publicUrl || null;
      if (url) {
        await supabase.from('profiles').update({ avatar_url: url }).eq('user_id', uid);
        setAvatarUrl(url);
        onSave({ name: sName, avatarUrl: url }); // Update parent immediately
      }
    } catch (e) {
      console.error(e);
      setSettingsMsg('Avatar upload failed');
    } finally {
      setAvatarUploading(false);
    }
  }
  
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40">
      <form
        onSubmit={saveSettings}
        className="w-[560px] max-w-[92vw] rounded-2xl border border-black/10 bg-white p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="text-base font-semibold text-neutral-900">Edit Profile</div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-black/10 px-2 py-1 text-sm"
          >
            Close
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-800">Name</label>
            <input
              value={sName}
              onChange={(e) => setSName(e.target.value)}
              className="w-full rounded-md border border-black/10 px-3 py-2 text-sm"
              placeholder="Your name"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-800">Avatar</label>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-neutral-200 grid place-items-center overflow-hidden">
                {avatarUrl ? <img src={avatarUrl} alt="" className="h-10 w-10 object-cover" /> : <span className="text-xs">{initials}</span>}
              </div>
              <input type="file" accept="image/*" onChange={onAvatarChange} className="text-sm" />
              {avatarUploading && <span className="text-xs text-neutral-600">Uploading…</span>}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-800">City</label>
            <input
              value={sCity}
              onChange={(e) => setSCity(e.target.value)}
              onFocus={loadCities} // Load cities on focus
              onBlur={() => { if (!sTimezone || sTimezone === "UTC") setSTimezone(deviceTZ()); }}
              className="w-full rounded-md border border-black/10 px-3 py-2 text-sm"
              placeholder="Start typing… e.g., Berlin"
              list="cities-de"
              required
            />
            <datalist id="cities-de">
              {deCities.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <div className="mt-1 text-[11px] text-neutral-500">
              Choose your city. This powers “My city” filters in Browse.
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-800">Timezone</label>
            <input
              value={sTimezone}
              onChange={(e) => setSTimezone(e.target.value)}
              className="w-full rounded-md border border-black/10 px-3 py-2 text-sm"
              placeholder="e.g., Europe/Berlin"
            />
            <div className="mt-1 text-[11px] text-neutral-500">
              Auto-fills from your device when you set City. You can still override manually.
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-800">Interests</label>
            <input
              value={sInterests}
              onChange={(e) => setSInterests(e.target.value)}
              className="w-full rounded-md border border-black/10 px-3 py-2 text-sm"
              placeholder="comma, separated, tags"
            />
            <div className="mt-1 text-[11px] text-neutral-500">Saved as tags in your profile.</div>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-neutral-800">Theme</label>
          <select
            value={sTheme}
            onChange={(e) => setSTheme(e.target.value as 'system'|'light'|'dark')}
            className="w-full rounded-md border border-black/10 px-3 py-2 text-sm"
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
          <div className="mt-1 text-[11px] text-neutral-500">Light/Dark applies after save.</div>
        </div>

        <div className="flex items-center gap-2">
          <input
            id="emailNotifs"
            type="checkbox"
            checked={emailNotifs}
            onChange={(e) => setEmailNotifs(e.target.checked)}
            className="h-4 w-4 rounded border-black/20"
          />
          <label htmlFor="emailNotifs" className="text-sm text-neutral-800">Email notifications</label>
        </div>
        <div className="flex items-center gap-2">
          <input
            id="pushNotifs"
            type="checkbox"
            checked={pushNotifs}
            onChange={(e) => setPushNotifs(e.target.checked)}
            className="h-4 w-4 rounded border-black/20"
          />
          <label htmlFor="pushNotifs" className="text-sm text-neutral-800">Push notifications</label>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium text-neutral-800">Allow profile ratings</div>
            <div className="text-[11px] text-neutral-500">Others can rate you when enabled.</div>
          </div>
          <button
            type="button"
            onClick={() => saveAllowRatings(!allowRatings)}
            className={`h-7 w-12 rounded-full ${allowRatings ? 'bg-emerald-600' : 'bg-neutral-300'} relative`}
            aria-pressed={allowRatings}
          >
            <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition ${allowRatings ? 'right-0.5' : 'left-0.5'}`} />
          </button>
        </div>
        {settingsMsg && (
          <div className={`mt-3 rounded-md border px-3 py-2 text-sm ${settingsMsg === 'Saved.' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
            {settingsMsg}
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-black/10 bg-white px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={settingsSaving}
            className={`rounded-md px-3 py-1.5 text-sm text-white ${settingsSaving ? "bg-neutral-400" : "bg-emerald-600 hover:bg-emerald-700"}`}
          >
            {settingsSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}