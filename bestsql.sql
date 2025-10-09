-- ============================================================
-- BASELINE SECURITY & SETUP (deduplicated and idempotent)
-- ============================================================

create extension if not exists pgcrypto;

-- =========================
-- FRIENDSHIPS (core table + RLS)
-- =========================
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_id_a uuid not null references public.profiles(user_id) on delete cascade,
  user_id_b uuid not null references public.profiles(user_id) on delete cascade,
  status text not null check (status in ('pending','accepted','blocked')),
  requested_by uuid not null references public.profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (least(user_id_a, user_id_b), greatest(user_id_a, user_id_b))
);

alter table public.friendships enable row level security;

drop policy if exists fr_select_participants on public.friendships;
create policy fr_select_participants
on public.friendships for select
to authenticated
using (user_id_a = auth.uid() or user_id_b = auth.uid());

drop policy if exists fr_insert_self on public.friendships;
create policy fr_insert_self
on public.friendships for insert
to authenticated
with check (requested_by = auth.uid());

-- ============================================================
-- PROFILES
-- ============================================================

alter table public.profiles enable row level security;

-- view / edit self
drop policy if exists profiles_read_self on public.profiles;
create policy profiles_read_self
on public.profiles for select to authenticated
using (user_id = auth.uid());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
on public.profiles for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- insert self
drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self
on public.profiles for insert to authenticated
with check (user_id = auth.uid());

-- view accepted friends
drop policy if exists profiles_read_friends on public.profiles;
create policy profiles_read_friends
on public.profiles for select to authenticated
using (
  exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and (
        (f.user_id_a = auth.uid() and f.user_id_b = profiles.user_id)
        or
        (f.user_id_b = auth.uid() and f.user_id_a = profiles.user_id)
      )
  )
);

-- maintain default name
create or replace function public.set_default_profile_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name is null or btrim(new.name) = '' then
    select split_part(u.email, '@', 1)
    into new.name
    from auth.users u
    where u.id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_default_name on public.profiles;
create trigger trg_profiles_default_name
before insert on public.profiles
for each row execute function public.set_default_profile_name();

-- backfill existing null names
update public.profiles p
set name = split_part(u.email, '@', 1)
from auth.users u
where p.user_id = u.id
  and (p.name is null or btrim(p.name) = '');

-- ============================================================
-- DIRECT MESSAGES
-- ============================================================

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.profiles(user_id),
  to_id uuid not null references public.profiles(user_id),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists dm_from_created_idx on public.direct_messages(from_id, created_at desc);
create index if not exists dm_to_created_idx on public.direct_messages(to_id, created_at desc);

alter table public.direct_messages enable row level security;

drop policy if exists dm_participants_select on public.direct_messages;
create policy dm_participants_select
on public.direct_messages for select to authenticated
using (from_id = auth.uid() or to_id = auth.uid());

drop policy if exists dm_from_self on public.direct_messages;
create policy dm_from_self
on public.direct_messages for insert to authenticated
with check (from_id = auth.uid());

-- ============================================================
-- GROUP MEMBERS & ACCESS
-- ============================================================

alter table public.group_members enable row level security;

drop policy if exists gm_select_same_group on public.group_members;
create policy gm_select_same_group
on public.group_members for select to authenticated
using (
  exists (
    select 1 from public.group_members gm2
    where gm2.group_id = group_members.group_id
      and gm2.user_id = auth.uid()
      and gm2.status = 'active'
  )
);

drop policy if exists gm_insert_self on public.group_members;
create policy gm_insert_self
on public.group_members for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists gm_delete_self on public.group_members;
create policy gm_delete_self
on public.group_members for delete to authenticated
using (user_id = auth.uid());

-- ============================================================
-- RATINGS RLS (linter fix)
-- ============================================================
alter table public.ratings enable row level security;

drop policy if exists ratings_read_self on public.ratings;
create policy ratings_read_self
on public.ratings for select to authenticated
using (rater_id = auth.uid() or ratee_id = auth.uid());

drop policy if exists ratings_insert_self on public.ratings;
create policy ratings_insert_self
on public.ratings for insert to authenticated
with check (rater_id = auth.uid());

-- ============================================================
-- ENUM + OWNER MEMBERSHIP TRIGGER (group creation)
-- ============================================================
drop function if exists public.add_owner_membership();
create function public.add_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.group_members (group_id, user_id, role, status)
  values (new.id, new.creator_id, 'member', 'active')
  on conflict (user_id, group_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_group_created on public.groups;
create trigger on_group_created
after insert on public.groups
for each row
execute function public.add_owner_membership();

-- ============================================================
-- SEARCH PATH FIX (for Supabase security advisor warnings)
-- ============================================================
do $$
declare
  r record;
begin
  for r in
    select n.nspname as schema,
           p.proname as name,
           pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'normalize_group_fields',
        'enforce_group_category_from_game',
        'set_updated_at',
        'is_group_host',
        'is_group_member',
        'check_vote_option_same_poll',
        'fr_touch_updated_at',
        '_fr_order_pair',
        'touch_updated_at'
      )
  loop
    execute format('alter function %I.%I(%s) set search_path = public',
      r.schema, r.name, r.args);
  end loop;
end $$;


















-- ============================================================ 


-- ============================================================
-- Circles DB Patch – Deduped, Idempotent, Production-safe
-- Purpose: fix creator_id, auto-membership, polls/votes/chat RLS,
--          profile bootstrap, and consistent group policies.
-- Safe to re-run: YES (uses IF EXISTS / IF NOT EXISTS / guards)
-- ============================================================

set local search_path = public;

-- A) GROUP CREATOR FIX + AUTO MEMBERSHIP
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='groups' AND column_name='owner_id') THEN
    UPDATE public.groups g SET creator_id = g.owner_id WHERE g.creator_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='groups' AND column_name='user_id') THEN
    UPDATE public.groups g SET creator_id = g.user_id WHERE g.creator_id IS NULL;
  END IF;
END$$;

ALTER TABLE public.group_members
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

WITH ranked AS (
  SELECT gm.group_id, gm.user_id,
         row_number() OVER (PARTITION BY gm.group_id ORDER BY gm.created_at ASC) AS rn
  FROM public.group_members gm
)
UPDATE public.groups g
SET creator_id = r.user_id
FROM ranked r
WHERE g.id = r.group_id AND r.rn = 1 AND g.creator_id IS NULL;

WITH ranked AS (
  SELECT gm.group_id, gm.user_id,
         CASE WHEN lower(gm.role::text) = 'owner' THEN 0 ELSE 1 END AS pref,
         row_number() OVER (
           PARTITION BY gm.group_id
           ORDER BY CASE WHEN lower(gm.role::text) = 'owner' THEN 0 ELSE 1 END, gm.created_at ASC
         ) AS rn
  FROM public.group_members gm
)
UPDATE public.groups g
SET creator_id = r.user_id
FROM ranked r
WHERE g.id = r.group_id AND r.rn = 1 AND g.creator_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema='public' AND table_name='groups'
      AND constraint_name='groups_creator_fkey' AND constraint_type='FOREIGN KEY'
  ) THEN
    ALTER TABLE public.groups
      ADD CONSTRAINT groups_creator_fkey
      FOREIGN KEY (creator_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;
  END IF;
END$$;

DO $$
DECLARE v_nulls int;
BEGIN
  SELECT count(*) INTO v_nulls FROM public.groups WHERE creator_id IS NULL;
  IF v_nulls = 0 THEN
    BEGIN ALTER TABLE public.groups ALTER COLUMN creator_id SET NOT NULL;
    EXCEPTION WHEN others THEN NULL; END;
  END IF;
END$$;

DROP TRIGGER IF EXISTS on_group_created ON public.groups;
DROP FUNCTION IF EXISTS public.add_owner_membership();
CREATE FUNCTION public.add_owner_membership()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.group_members (group_id, user_id, role, status)
  VALUES (NEW.id, NEW.creator_id, 'member', 'accepted')
  ON CONFLICT (user_id, group_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_group_created
AFTER INSERT ON public.groups
FOR EACH ROW EXECUTE FUNCTION public.add_owner_membership();

-- B) GROUPS RLS
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS groups_insert_creator ON public.groups;
CREATE POLICY groups_insert_creator
ON public.groups FOR INSERT TO authenticated
WITH CHECK (creator_id = auth.uid());

DROP POLICY IF EXISTS groups_update_creator ON public.groups;
CREATE POLICY groups_update_creator
ON public.groups FOR UPDATE TO authenticated
USING (creator_id = auth.uid())
WITH CHECK (creator_id = auth.uid());

DROP POLICY IF EXISTS groups_delete_creator ON public.groups;
CREATE POLICY groups_delete_creator
ON public.groups FOR DELETE TO authenticated
USING (creator_id = auth.uid());

DROP POLICY IF EXISTS groups_select_creator_or_member ON public.groups;
CREATE POLICY groups_select_creator_or_member
ON public.groups FOR SELECT TO authenticated
USING (
  creator_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = groups.id AND gm.user_id = auth.uid()
  )
);

-- C) PROFILES BOOTSTRAP (handle_new_user trigger)
SELECT routine_schema, routine_name
FROM information_schema.routines
WHERE routine_name = 'handle_new_user';

SELECT tgname, tgrelid::regclass AS table, proname AS function
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE tgrelid = 'auth.users'::regclass AND NOT t.tgisinternal;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();
CREATE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

SELECT u.id AS auth_user_id, p.user_id AS profile_user_id
FROM auth.users u
LEFT JOIN public.profiles p ON p.user_id = u.id
ORDER BY u.created_at DESC
LIMIT 5;

-- D) POLLS / OPTIONS / VOTES (tables + trigger + RLS)
CREATE TABLE IF NOT EXISTS public.group_polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  title text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open',
  closes_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.group_poll_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES public.group_polls(id) ON DELETE CASCADE,
  label text NOT NULL,
  starts_at timestamptz,
  place text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.group_votes (
  poll_id uuid NOT NULL REFERENCES public.group_polls(id) ON DELETE CASCADE,
  option_id uuid NOT NULL REFERENCES public.group_poll_options(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (poll_id, user_id)
);

CREATE OR REPLACE FUNCTION public.check_vote_option_same_poll()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE opt_poll uuid;
BEGIN
  SELECT poll_id INTO opt_poll FROM public.group_poll_options WHERE id = NEW.option_id;
  IF opt_poll IS NULL OR opt_poll <> NEW.poll_id THEN
    RAISE EXCEPTION 'option does not belong to poll';
  END IF;
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_votes_check_option ON public.group_votes;
CREATE TRIGGER trg_votes_check_option
BEFORE INSERT OR UPDATE ON public.group_votes
FOR EACH ROW EXECUTE FUNCTION public.check_vote_option_same_poll();

CREATE INDEX IF NOT EXISTS idx_group_polls_group       ON public.group_polls(group_id);
CREATE INDEX IF NOT EXISTS idx_group_poll_options_poll ON public.group_poll_options(poll_id);
CREATE INDEX IF NOT EXISTS idx_group_votes_poll        ON public.group_votes(poll_id);
CREATE INDEX IF NOT EXISTS idx_group_votes_user        ON public.group_votes(user_id);

ALTER TABLE public.group_polls        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_votes        ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_group_member(gid uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members m
    WHERE m.group_id = gid AND m.user_id = auth.uid()
  );
$$;

DROP POLICY IF EXISTS polls_select_member ON public.group_polls;
CREATE POLICY polls_select_member
ON public.group_polls FOR SELECT TO authenticated
USING ( public.is_group_member(group_id) );

DROP POLICY IF EXISTS polls_insert_host ON public.group_polls;
CREATE POLICY polls_insert_host
ON public.group_polls FOR INSERT TO authenticated
WITH CHECK ( EXISTS (SELECT 1 FROM public.groups g WHERE g.id = group_id AND g.host_id = auth.uid()) );

DROP POLICY IF EXISTS polls_update_host ON public.group_polls;
CREATE POLICY polls_update_host
ON public.group_polls FOR UPDATE TO authenticated
USING ( EXISTS (SELECT 1 FROM public.groups g WHERE g.id = group_id AND g.host_id = auth.uid()) )
WITH CHECK ( EXISTS (SELECT 1 FROM public.groups g WHERE g.id = group_id AND g.host_id = auth.uid()) );

DROP POLICY IF EXISTS options_select_member ON public.group_poll_options;
CREATE POLICY options_select_member
ON public.group_poll_options FOR SELECT TO authenticated
USING ( EXISTS (SELECT 1 FROM public.group_polls p WHERE p.id = poll_id AND public.is_group_member(p.group_id)) );

DROP POLICY IF EXISTS options_insert_host ON public.group_poll_options;
CREATE POLICY options_insert_host
ON public.group_poll_options FOR INSERT TO authenticated
WITH CHECK ( EXISTS (SELECT 1 FROM public.group_polls p JOIN public.groups g ON g.id = p.group_id WHERE p.id = poll_id AND g.host_id = auth.uid()) );

DROP POLICY IF EXISTS votes_select_member ON public.group_votes;
CREATE POLICY votes_select_member
ON public.group_votes FOR SELECT TO authenticated
USING ( EXISTS (SELECT 1 FROM public.group_polls p WHERE p.id = poll_id AND public.is_group_member(p.group_id)) );

DROP POLICY IF EXISTS votes_upsert_member ON public.group_votes;
CREATE POLICY votes_upsert_member
ON public.group_votes FOR INSERT TO authenticated
WITH CHECK ( auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.group_polls p WHERE p.id = poll_id AND public.is_group_member(p.group_id)) );

DROP POLICY IF EXISTS votes_delete_own ON public.group_votes;
CREATE POLICY votes_delete_own
ON public.group_votes FOR DELETE TO authenticated
USING ( user_id = auth.uid() );

-- E) GROUP CHAT
CREATE TABLE IF NOT EXISTS public.group_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_group_messages_group ON public.group_messages(group_id, created_at DESC);
ALTER TABLE public.group_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS msgs_select_member ON public.group_messages;
CREATE POLICY msgs_select_member
ON public.group_messages FOR SELECT TO authenticated
USING ( public.is_group_member(group_id) );

DROP POLICY IF EXISTS msgs_insert_member ON public.group_messages;
CREATE POLICY msgs_insert_member
ON public.group_messages FOR INSERT TO authenticated
WITH CHECK ( auth.uid() = user_id AND public.is_group_member(group_id) );

-- F) GROUP MEMBERS RLS
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gm_select_same_group ON public.group_members;
CREATE POLICY gm_select_same_group
ON public.group_members FOR SELECT TO authenticated
USING ( EXISTS (SELECT 1 FROM public.group_members gm2 WHERE gm2.group_id = group_members.group_id AND gm2.user_id = auth.uid() AND gm2.status = 'accepted') );

DROP POLICY IF EXISTS gm_insert_self ON public.group_members;
CREATE POLICY gm_insert_self
ON public.group_members FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS gm_delete_self ON public.group_members;
CREATE POLICY gm_delete_self
ON public.group_members FOR DELETE TO authenticated
USING (user_id = auth.uid());

-- G) INDEXES
CREATE INDEX IF NOT EXISTS idx_group_members_user  ON public.group_members(user_id, status);
CREATE INDEX IF NOT EXISTS idx_group_members_group ON public.group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_groups_creator      ON public.groups(creator_id);
CREATE INDEX IF NOT EXISTS idx_groups_created_at   ON public.groups(created_at);

-- H) Reload PostgREST\nNOTIFY pgrst, 'reload schema';\n```
















-- ============================================================

-- ============================================================
-- Circles SQL – Groups, Members, Messaging (Deduped / Idempotent)
-- Safe to re-run. Removes duplicates, fixes RLS, standardizes FKs.
-- ============================================================

begin;
set local search_path = public;
create extension if not exists pgcrypto;

-- ============================================================
-- 0) DIAGNOSTICS (optional; keep or remove)
-- ============================================================
-- Category/game triggers present?
select event_manipulation, action_timing, event_object_table, trigger_name
from information_schema.triggers
where trigger_schema='public'
  and (trigger_name like '%groups_sync_category%' or trigger_name like '%groups_normalize%');

-- Whitelist FKs?
select conname, conrelid::regclass as on_table
from pg_constraint
where conname in ('fk_groups_game_allowed','fk_groups_category_allowed');

-- Quick preview
select id, title, game, category, game_slug, created_at
from public.groups
order by created_at desc
limit 5;

-- ============================================================
-- 1) GROUPS: base columns + updated_at trigger (canonical)
-- ============================================================
alter table public.groups
  add column if not exists title        text,
  add column if not exists description  text,
  add column if not exists category     text,
  add column if not exists game         text,
  add column if not exists capacity     integer,
  add column if not exists visibility   text default 'public',
  add column if not exists city         text,
  add column if not exists online_link  text,
  add column if not exists is_online    boolean default true,
  add column if not exists created_at   timestamptz default now(),
  add column if not exists updated_at   timestamptz default now(),
  add column if not exists game_slug    text
    generated always as ( lower(regexp_replace(coalesce(game,''), '[^a-z0-9]+', '', 'g')) ) stored;

create index if not exists idx_groups_game_slug on public.groups(game_slug);
create index if not exists idx_groups_category  on public.groups(category);
create index if not exists idx_groups_game      on public.groups(game);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_groups_touch_updated on public.groups;
create trigger trg_groups_touch_updated
before update on public.groups
for each row execute function public.touch_updated_at();

-- ============================================================
-- 2) WHITELISTS (allowed_categories / allowed_games) + seed
-- ============================================================
create table if not exists public.allowed_categories (
  name      text primary key,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.allowed_games (
  id        text primary key,
  name      text not null,
  category  text not null references public.allowed_categories(name),
  is_active boolean default true,
  created_at timestamptz default now()
);

insert into public.allowed_categories(name) values
  ('games'), ('study'), ('outdoors')
on conflict do nothing;

insert into public.allowed_games(id, name, category) values
  ('hokm','Hokm','games'),
  ('takhtenard','Takhte Nard','games'),
  ('mafia','Mafia','games'),
  ('monopoly','Monopoly','games'),
  ('uno','UNO','games'),
  ('chess','Chess','games'),
  ('mathematics','Mathematics','study'),
  ('biology','Biology','study'),
  ('chemistry','Chemistry','study'),
  ('history','History','study'),
  ('hiking','Hiking','outdoors'),
  ('camping','Camping','outdoors'),
  ('kayaking','Kayaking','outdoors')
on conflict do nothing;

-- RLS: public read once (deduped)
alter table public.allowed_categories enable row level security;
alter table public.allowed_games     enable row level security;

drop policy if exists allowed_categories_read on public.allowed_categories;
create policy allowed_categories_read
on public.allowed_categories for select to anon, authenticated using (true);

drop policy if exists allowed_games_read on public.allowed_games;
create policy allowed_games_read
on public.allowed_games for select to anon, authenticated using (true);

-- ============================================================
-- 3) GROUPS: whitelist FKs + normalization + category sync
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_groups_game_allowed') then
    alter table public.groups
      add constraint fk_groups_game_allowed
      foreign key (game) references public.allowed_games(id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fk_groups_category_allowed') then
    alter table public.groups
      add constraint fk_groups_category_allowed
      foreign key (category) references public.allowed_categories(name);
  end if;
end$$;

create or replace function public.normalize_group_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.category is not null then new.category := lower(trim(new.category)); end if;
  if new.game     is not null then new.game     := lower(trim(new.game));     end if;
  return new;
end;
$$;

drop trigger if exists trg_groups_normalize on public.groups;
create trigger trg_groups_normalize
before insert or update on public.groups
for each row execute function public.normalize_group_fields();

create or replace function public.enforce_group_category_from_game()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare gcat text;
begin
  if new.game is null then
    raise exception 'game is required' using errcode='23514';
  end if;
  select category into gcat from public.allowed_games where id = new.game;
  if gcat is null then
    raise exception 'unknown game: %', new.game using errcode='23514';
  end if;
  new.category := gcat;
  return new;
end;
$$;

drop trigger if exists trg_groups_sync_category on public.groups;
create trigger trg_groups_sync_category
before insert or update of game on public.groups
for each row execute function public.enforce_group_category_from_game();

-- Clean existing rows once
update public.groups
set category = lower(trim(category)),
    game     = lower(trim(game))
where (category is not null and category <> lower(trim(category)))
   or (game     is not null and game     <> lower(trim(game)));

update public.groups g
set category = ag.category
from public.allowed_games ag
where g.game = ag.id
  and (g.category is distinct from ag.category);

-- Groups RLS: single public read policy (deduped)
alter table public.groups enable row level security;

drop policy if exists groups_select_public on public.groups;
create policy groups_select_public
on public.groups for select
to public using (true);

-- Ensure visibility set
update public.groups set visibility = 'public' where visibility is null;

-- ============================================================
-- 4) GROUP MEMBERS (canonical schema + RLS)
-- ============================================================
create table if not exists public.group_members (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  user_id    uuid not null references public.profiles(user_id) on delete cascade,
  role       text default 'member',
  status     text default 'accepted',
  created_at timestamptz default now(),
  unique (group_id, user_id)
);

create index if not exists gm_user_created_idx on public.group_members (user_id, created_at desc);
create index if not exists gm_group_idx        on public.group_members (group_id);

alter table public.group_members enable row level security;

-- Insert yourself
drop policy if exists gm_insert_self on public.group_members;
create policy gm_insert_self
on public.group_members for insert to authenticated
with check (auth.uid() = user_id);

-- Read members of same group (replaces narrow "read own")
drop policy if exists gm_read_self on public.group_members;
drop policy if exists gm_select_same_group on public.group_members;
create policy gm_select_same_group
on public.group_members for select to authenticated
using (
  exists (
    select 1 from public.group_members gm2
    where gm2.group_id = group_members.group_id
      and gm2.user_id = auth.uid()
  )
);

-- Host can remove members (one copy only)
drop policy if exists gm_host_can_remove on public.group_members;
create policy gm_host_can_remove
on public.group_members for delete to authenticated
using (
  exists (
    select 1 from public.groups g
    where g.id = group_members.group_id
      and g.host_id = auth.uid()
  )
);

-- ============================================================
-- 5) GROUP MESSAGES (schema + RLS + indexes) – ONE canonical block
-- ============================================================
create table if not exists public.group_messages (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  content     text not null default '',
  parent_id   uuid null references public.group_messages(id) on delete cascade,
  attachments jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

-- Ensure canonical columns/defaults even if table existed
alter table public.group_messages
  add column if not exists content     text,
  add column if not exists attachments jsonb default '[]'::jsonb,
  add column if not exists created_at  timestamptz default now(),
  add column if not exists parent_id   uuid;

update public.group_messages set attachments = '[]'::jsonb where attachments is null;
update public.group_messages set created_at = now()        where created_at is null;
update public.group_messages set content = ''               where content is null;

create index if not exists idx_group_messages_group_created
  on public.group_messages(group_id, created_at desc);
create index if not exists idx_group_messages_parent
  on public.group_messages(parent_id);
create index if not exists idx_group_messages_created
  on public.group_messages(created_at);
create index if not exists idx_group_messages_user_id
  on public.group_messages(user_id);

alter table public.group_messages enable row level security;

-- READ: only members
drop policy if exists gm_select_members_only on public.group_messages;
create policy gm_select_members_only
on public.group_messages for select to authenticated
using (
  exists (
    select 1 from public.group_members mem
    where mem.group_id = group_messages.group_id
      and mem.user_id  = auth.uid()
  )
);

-- INSERT: only members; enforce author = auth.uid()
drop policy if exists gm_insert_member_only on public.group_messages;
create policy gm_insert_member_only
on public.group_messages for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.group_members mem
    where mem.group_id = group_messages.group_id
      and mem.user_id  = auth.uid()
  )
);

-- UPDATE/DELETE: author only
drop policy if exists gm_update_own on public.group_messages;
create policy gm_update_own
on public.group_messages for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists gm_delete_own on public.group_messages;
create policy gm_delete_own
on public.group_messages for delete to authenticated
using (user_id = auth.uid());














-- ============================================================
-- 6) REACTIONS + READ RECEIPTS (schema + RLS + indexes)
-- ============================================================
-- Reactions
create table if not exists public.group_message_reactions (
  id         uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.group_messages(id) on delete cascade,
  user_id    uuid not null default auth.uid(),
  emoji      text not null check (char_length(emoji) between 1 and 12),
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

create index if not exists idx_gmr_message on public.group_message_reactions(message_id);
create index if not exists idx_gmr_user    on public.group_message_reactions(user_id);

alter table public.group_message_reactions enable row level security;

drop policy if exists gmr_select_members_only on public.group_message_reactions;
create policy gmr_select_members_only
on public.group_message_reactions for select to authenticated
using (
  exists (
    select 1
    from public.group_messages gm
    join public.group_members mem
      on mem.group_id = gm.group_id and mem.user_id = auth.uid()
    where gm.id = group_message_reactions.message_id
  )
);

drop policy if exists gmr_upsert_member on public.group_message_reactions;
create policy gmr_upsert_member
on public.group_message_reactions for insert to authenticated
with check (
  exists (
    select 1
    from public.group_messages gm
    join public.group_members mem
      on mem.group_id = gm.group_id and mem.user_id = auth.uid()
    where gm.id = group_message_reactions.message_id
  )
);

drop policy if exists gmr_delete_own on public.group_message_reactions;
create policy gmr_delete_own
on public.group_message_reactions for delete to authenticated
using (user_id = auth.uid());

-- Read receipts
create table if not exists public.group_message_reads (
  message_id uuid not null references public.group_messages(id) on delete cascade,
  user_id    uuid not null,
  read_at    timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists idx_gmdr_message on public.group_message_reads(message_id);
create index if not exists idx_gmdr_user    on public.group_message_reads(user_id);

alter table public.group_message_reads enable row level security;

drop policy if exists gmdr_select_members_only on public.group_message_reads;
create policy gmdr_select_members_only
on public.group_message_reads for select to authenticated
using (
  exists (
    select 1
    from public.group_messages gm
    join public.group_members mem
      on mem.group_id = gm.group_id and mem.user_id = auth.uid()
    where gm.id = group_message_reads.message_id
  )
);

drop policy if exists gmdr_upsert_self_member on public.group_message_reads;
create policy gmdr_upsert_self_member
on public.group_message_reads for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.group_messages gm
    join public.group_members mem
      on mem.group_id = gm.group_id and mem.user_id = auth.uid()
    where gm.id = group_message_reads.message_id
  )
);

-- ============================================================
-- 7) REALTIME publication (guarded add)
-- ============================================================
do $$
begin
  perform 1 from pg_publication where pubname = 'supabase_realtime';
  if not found then
    create publication supabase_realtime;
  end if;

  -- add if missing
  if not exists (
    select 1 from pg_publication p
    join pg_publication_rel pr on pr.prpubid = p.oid
    join pg_class c on c.oid = pr.prrelid
    join pg_namespace n on n.oid = c.relnamespace
    where p.pubname='supabase_realtime' and n.nspname='public' and c.relname='group_messages'
  ) then
    alter publication supabase_realtime add table public.group_messages;
  end if;

  if not exists (
    select 1 from pg_publication p
    join pg_publication_rel pr on pr.prpubid = p.oid
    join pg_class c on c.oid = pr.prrelid
    join pg_namespace n on n.oid = c.relnamespace
    where p.pubname='supabase_realtime' and n.nspname='public' and c.relname='group_message_reactions'
  ) then
    alter publication supabase_realtime add table public.group_message_reactions;
  end if;

  if not exists (
    select 1 from pg_publication p
    join pg_publication_rel pr on pr.prpubid = p.oid
    join pg_class c on c.oid = pr.prrelid
    join pg_namespace n on n.oid = c.relnamespace
    where p.pubname='supabase_realtime' and n.nspname='public' and c.relname='group_message_reads'
  ) then
    alter publication supabase_realtime add table public.group_message_reads;
  end if;

  if not exists (
    select 1 from pg_publication p
    join pg_publication_rel pr on pr.prpubid = p.oid
    join pg_class c on c.oid = pr.prrelid
    join pg_namespace n on n.oid = c.relnamespace
    where p.pubname='supabase_realtime' and n.nspname='public' and c.relname='profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end$$;

-- ============================================================
-- 8) FINAL
-- ============================================================
notify pgrst, 'reload schema';
commit;