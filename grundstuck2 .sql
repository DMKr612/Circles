-- =====================================================================
-- Circles unified Supabase schema (idempotent, app-aligned)
-- - Covers groups, chat, invites, polls, friends, ratings, DMs, presence
-- - Safe to re-run; uses IF NOT EXISTS / ON CONFLICT where possible
-- =====================================================================

set local search_path = public;

-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Helper functions (shared)
-- ---------------------------------------------------------------------
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
-- ---------------------------------------------------------------------
-- Core reference tables
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  id            uuid generated always as (user_id) stored,
  name          text,
  display_name  text,
  username      text unique,
  avatar_url    text,
  city          text,
  timezone      text,
  interests     text,
  allow_ratings boolean default true,
  rating_avg    numeric default 0,
  rating_count  integer default 0,
  onboarded     boolean default false,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create table if not exists public.allowed_categories (
  name       text primary key,
  is_active  boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.allowed_games (
  id        text primary key,
  name      text not null,
  category  text not null references public.allowed_categories(name),
  is_active boolean default true,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------
-- Groups & membership
-- ---------------------------------------------------------------------
create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  creator_id  uuid not null references public.profiles(user_id) on delete cascade,
  host_id     uuid not null references public.profiles(user_id) on delete cascade,
  title       text not null,
  description text,
  purpose     text,
  category    text references public.allowed_categories(name),
  game        text references public.allowed_games(id),
  capacity    integer,
  visibility  text default 'public',
  city        text,
  location    text,
  online_link text,
  is_online   boolean default true,
  code        text unique,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  game_slug   text generated always as (
    lower(regexp_replace(coalesce(game,''), '[^a-z0-9]+', '', 'g'))
  ) stored
);
create index if not exists idx_groups_creator on public.groups(creator_id);
create index if not exists idx_groups_host on public.groups(host_id);
create index if not exists idx_groups_code on public.groups(code);

create table if not exists public.group_members (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  user_id    uuid not null references public.profiles(user_id) on delete cascade,
  role       text default 'member',
  status     text default 'active',
  created_at timestamptz default now(),
  unique (group_id, user_id)
);
create index if not exists gm_user_idx on public.group_members(user_id);
create index if not exists gm_group_idx on public.group_members(group_id);

create table if not exists public.group_live_locations (
  group_id   uuid not null references public.groups(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  lat        double precision,
  long       double precision,
  updated_at timestamptz default now(),
  primary key (group_id, user_id)
);
create index if not exists idx_group_live_locations_group on public.group_live_locations(group_id);

create table if not exists public.group_reads (
  group_id     uuid not null references public.groups(id) on delete cascade,
  user_id      uuid not null references public.profiles(user_id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- ---------------------------------------------------------------------
-- Chat (messages, reactions, reads)
-- ---------------------------------------------------------------------
create table if not exists public.group_messages (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups(id) on delete cascade,
  sender_id   uuid references auth.users(id) on delete set null,
  content     text not null default '',
  parent_id   uuid references public.group_messages(id) on delete cascade,
  attachments jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_group_messages_group on public.group_messages(group_id, created_at desc);
create index if not exists idx_group_messages_sender on public.group_messages(sender_id);

create table if not exists public.group_message_reactions (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  message_id uuid not null references public.group_messages(id) on delete cascade,
  user_id    uuid not null default auth.uid(),
  emoji      text not null check (char_length(emoji) between 1 and 12),
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);
create index if not exists idx_gmr_message on public.group_message_reactions(message_id);
create index if not exists idx_gmr_user on public.group_message_reactions(user_id);

-- Backfill group_id for existing reactions and enforce FK/not-null
alter table public.group_message_reactions
  add column if not exists group_id uuid;

update public.group_message_reactions gmr
set group_id = gm.group_id
from public.group_messages gm
where gmr.group_id is null
  and gm.id = gmr.message_id;

do $$
begin
  begin
    alter table public.group_message_reactions
      add constraint group_message_reactions_group_id_fkey
      foreign key (group_id) references public.groups(id) on delete cascade;
  exception when duplicate_object then null;
  end;
  begin
    alter table public.group_message_reactions alter column group_id set not null;
  exception when others then null;
  end;
end$$;

create index if not exists idx_gmr_group on public.group_message_reactions(group_id);

create table if not exists public.group_message_reads (
  message_id uuid not null references public.group_messages(id) on delete cascade,
  user_id    uuid not null,
  read_at    timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index if not exists idx_gmdr_message on public.group_message_reads(message_id);
create index if not exists idx_gmdr_user on public.group_message_reads(user_id);

-- ---------------------------------------------------------------------
-- Polling
-- ---------------------------------------------------------------------
create table if not exists public.group_polls (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  title      text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  status     text not null default 'open',
  closes_at  timestamptz,
  created_at timestamptz default now()
);

create table if not exists public.group_poll_options (
  id         uuid primary key default gen_random_uuid(),
  poll_id    uuid not null references public.group_polls(id) on delete cascade,
  label      text not null,
  starts_at  timestamptz,
  place      text,
  created_at timestamptz default now()
);

create table if not exists public.group_votes (
  poll_id    uuid not null references public.group_polls(id) on delete cascade,
  option_id  uuid not null references public.group_poll_options(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (poll_id, user_id)
);
create index if not exists idx_group_polls_group on public.group_polls(group_id);
create index if not exists idx_group_poll_options_poll on public.group_poll_options(poll_id);
create index if not exists idx_group_votes_poll on public.group_votes(poll_id);
create index if not exists idx_group_votes_user on public.group_votes(user_id);

-- ---------------------------------------------------------------------
-- Friends, DM, invites, notifications, ratings
-- ---------------------------------------------------------------------
create table if not exists public.friendships (
  id           uuid primary key default gen_random_uuid(),
  user_id_a    uuid not null references public.profiles(user_id) on delete cascade,
  user_id_b    uuid not null references public.profiles(user_id) on delete cascade,
  status       text not null check (status in ('pending','accepted','blocked')),
  requested_by uuid not null references public.profiles(user_id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (user_id_a <> user_id_b)
);
create index if not exists idx_friendships_requested_by on public.friendships(requested_by);

create unique index if not exists idx_friendships_pair
  on public.friendships (
    least(user_id_a, user_id_b),
    greatest(user_id_a, user_id_b)
  );

-- convenience view for legacy queries (accepted friends)
create or replace view public.friends as
  select f.id, f.user_id_a as user_id, f.user_id_b as friend_id, f.status, f.created_at
  from public.friendships f
  where f.status = 'accepted'
  union all
  select f.id, f.user_id_b as user_id, f.user_id_a as friend_id, f.status, f.created_at
  from public.friendships f
  where f.status = 'accepted';

create table if not exists public.direct_messages (
  id        uuid primary key default gen_random_uuid(),
  sender    uuid not null references auth.users(id) on delete cascade,
  receiver  uuid not null references auth.users(id) on delete cascade,
  content   text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists dm_from_created_idx on public.direct_messages(sender, created_at desc);
create index if not exists dm_to_created_idx on public.direct_messages(receiver, created_at desc);

create table if not exists public.group_invitations (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups(id) on delete cascade,
  inviter_id   uuid not null references public.profiles(user_id) on delete cascade,
  recipient_id uuid not null references public.profiles(user_id) on delete cascade,
  status       text default 'pending',
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  unique (group_id, recipient_id)
);

create table if not exists public.group_invites (
  code       text primary key,
  group_id   uuid not null references public.groups(id) on delete cascade,
  created_by uuid not null references public.profiles(user_id) on delete cascade,
  expires_at timestamptz,
  max_uses   integer,
  use_count  integer default 0,
  created_at timestamptz default now()
);

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(user_id) on delete cascade,
  kind       text not null,
  payload    jsonb not null default '{}'::jsonb,
  is_read    boolean default false,
  created_at timestamptz default now()
);
create index if not exists idx_notifications_user on public.notifications(user_id, is_read, created_at desc);

create table if not exists public.category_requests (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  note         text,
  requested_by uuid references public.profiles(user_id) on delete cascade,
  status       text default 'pending',
  created_at   timestamptz default now()
);

create table if not exists public.rating_pairs (
  id             uuid primary key default gen_random_uuid(),
  rater_id       uuid not null references auth.users(id) on delete cascade,
  ratee_id       uuid not null references auth.users(id) on delete cascade,
  stars          integer not null check (stars between 1 and 6),
  next_allowed_at timestamptz not null default (now() + interval '14 days'),
  edit_used      boolean not null default false,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),
  unique (rater_id, ratee_id)
);

create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(user_id) on delete cascade,
  reported_id uuid not null references public.profiles(user_id) on delete cascade,
  reason      text,
  resolved    boolean default false,
  created_at  timestamptz default now()
);

-- ---------------------------------------------------------------------
-- Group helper predicates (must be defined after tables exist)
-- ---------------------------------------------------------------------
create or replace function public.is_group_member(gid uuid, uid uuid default auth.uid())
returns boolean
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare u uuid := coalesce(uid, auth.uid());
begin
  if u is null then return false; end if;
  return exists (
    select 1
    from public.group_members m
    where m.group_id = gid
      and m.user_id  = u
      and m.status in ('active','accepted','invited')
  );
end;
$$;

create or replace function public.is_group_host(gid uuid, uid uuid default auth.uid())
returns boolean
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare u uuid := coalesce(uid, auth.uid());
begin
  if u is null then return false; end if;
  return exists (
    select 1 from public.groups g
    where g.id = gid
      and (g.host_id = u or g.creator_id = u)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, name, display_name, username, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', new.email),
    coalesce(new.raw_user_meta_data->>'name', new.email),
    coalesce(new.raw_user_meta_data->>'username', new.email),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.assign_group_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.code is null then
    new.code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  end if;
  return new;
end;
$$;

create or replace function public.set_group_owner_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.creator_id is null then new.creator_id := auth.uid(); end if;
  if new.host_id is null then new.host_id := new.creator_id; end if;
  return new;
end;
$$;

create or replace function public.normalize_group_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.category is not null then new.category := lower(trim(new.category)); end if;
  if new.game is not null then new.game := lower(trim(new.game)); end if;
  return new;
end;
$$;

create or replace function public.enforce_group_category_from_game()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare gcat text;
begin
  if new.game is not null then
    select category into gcat from public.allowed_games where id = new.game;
    if gcat is null then raise exception 'unknown game: %', new.game using errcode='23514'; end if;
    new.category := gcat;
  end if;
  return new;
end;
$$;

create or replace function public.add_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.group_members (group_id, user_id, role, status)
  values (new.id, new.creator_id, 'host', 'active')
  on conflict (group_id, user_id) do update set role = 'host', status = 'active';
  return new;
end;
$$;

create or replace function public.normalize_member_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is null then new.status := 'active'; end if;
  return new;
end;
$$;

create or replace function public.check_vote_option_same_poll()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  opt_poll uuid;
begin
  select poll_id into opt_poll from public.group_poll_options where id = new.option_id;
  if opt_poll is null or opt_poll <> new.poll_id then
    raise exception 'option does not belong to poll';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_groups_owner_defaults on public.groups;
create trigger trg_groups_owner_defaults before insert on public.groups for each row execute function public.set_group_owner_defaults();

drop trigger if exists trg_groups_assign_code on public.groups;
create trigger trg_groups_assign_code before insert on public.groups for each row execute function public.assign_group_code();

drop trigger if exists trg_groups_normalize on public.groups;
create trigger trg_groups_normalize before insert or update on public.groups for each row execute function public.normalize_group_fields();

drop trigger if exists trg_groups_sync_category on public.groups;
create trigger trg_groups_sync_category before insert or update of game on public.groups for each row execute function public.enforce_group_category_from_game();

drop trigger if exists trg_groups_touch_updated on public.groups;
create trigger trg_groups_touch_updated before update on public.groups for each row execute function public.touch_updated_at();

drop trigger if exists trg_profiles_touch_updated on public.profiles;
create trigger trg_profiles_touch_updated before update on public.profiles for each row execute function public.touch_updated_at();

drop trigger if exists on_group_created on public.groups;
create trigger on_group_created after insert on public.groups for each row execute function public.add_owner_membership();

drop trigger if exists trg_group_members_normalize on public.group_members;
create trigger trg_group_members_normalize before insert or update on public.group_members for each row execute function public.normalize_member_status();

drop trigger if exists trg_votes_check_option on public.group_votes;
create trigger trg_votes_check_option before insert or update on public.group_votes for each row execute function public.check_vote_option_same_poll();

-- ---------------------------------------------------------------------
-- RLS policies
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
drop policy if exists profiles_select_all on public.profiles;
create policy profiles_select_all on public.profiles for select to public using (true);
drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles for insert to authenticated with check (user_id = auth.uid());
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.allowed_categories enable row level security;
alter table public.allowed_games enable row level security;
drop policy if exists allowed_categories_read on public.allowed_categories;
create policy allowed_categories_read on public.allowed_categories for select to public using (true);
drop policy if exists allowed_games_read on public.allowed_games;
create policy allowed_games_read on public.allowed_games for select to public using (true);

alter table public.groups enable row level security;
drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups for select
  to public
  using (
    visibility = 'public'
    or public.is_group_member(id)
    or creator_id = auth.uid()
    or host_id = auth.uid()
  );
drop policy if exists groups_insert on public.groups;
create policy groups_insert on public.groups for insert to authenticated with check (creator_id = auth.uid() and host_id = auth.uid());
drop policy if exists groups_update on public.groups;
create policy groups_update on public.groups for update to authenticated using (creator_id = auth.uid() or host_id = auth.uid()) with check (creator_id = auth.uid() or host_id = auth.uid());
drop policy if exists groups_delete on public.groups;
create policy groups_delete on public.groups for delete to authenticated using (creator_id = auth.uid());

alter table public.group_members enable row level security;
drop policy if exists gm_select on public.group_members;
create policy gm_select on public.group_members for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_group_member(group_id)
    or public.is_group_host(group_id)
  );
drop policy if exists gm_insert_self on public.group_members;
create policy gm_insert_self on public.group_members for insert to authenticated with check (user_id = auth.uid());
drop policy if exists gm_update on public.group_members;
create policy gm_update on public.group_members for update
  to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.groups g where g.id = group_members.group_id and (g.host_id = auth.uid() or g.creator_id = auth.uid())))
  with check (true);
drop policy if exists gm_delete on public.group_members;
create policy gm_delete on public.group_members for delete
  to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.groups g where g.id = group_members.group_id and (g.host_id = auth.uid() or g.creator_id = auth.uid())));

alter table public.group_messages enable row level security;
drop policy if exists gm_select_members_only on public.group_messages;
create policy gm_select_members_only on public.group_messages for select to authenticated using (public.is_group_member(group_id));
drop policy if exists gm_insert_member_only on public.group_messages;
create policy gm_insert_member_only on public.group_messages for insert to authenticated with check (sender_id = auth.uid() and public.is_group_member(group_id));
drop policy if exists gm_update_own on public.group_messages;
create policy gm_update_own on public.group_messages for update to authenticated using (sender_id = auth.uid()) with check (sender_id = auth.uid());
drop policy if exists gm_delete_own on public.group_messages;
create policy gm_delete_own on public.group_messages for delete to authenticated using (sender_id = auth.uid());

alter table public.group_message_reactions enable row level security;
drop policy if exists gmr_select_members_only on public.group_message_reactions;
create policy gmr_select_members_only on public.group_message_reactions for select to authenticated using (
  public.is_group_member(group_id)
);
drop policy if exists gmr_upsert_member on public.group_message_reactions;
create policy gmr_upsert_member on public.group_message_reactions for insert to authenticated with check (
  user_id = auth.uid() and public.is_group_member(group_id)
);
drop policy if exists gmr_delete_own on public.group_message_reactions;
create policy gmr_delete_own on public.group_message_reactions for delete to authenticated using (user_id = auth.uid());

alter table public.group_message_reads enable row level security;
drop policy if exists gmdr_select_members_only on public.group_message_reads;
create policy gmdr_select_members_only on public.group_message_reads for select to authenticated using (
  public.is_group_member(
    (select gm.group_id from public.group_messages gm where gm.id = group_message_reads.message_id)
  )
);
drop policy if exists gmdr_upsert_self_member on public.group_message_reads;
create policy gmdr_upsert_self_member on public.group_message_reads for insert to authenticated with check (
  user_id = auth.uid() and public.is_group_member(
    (select gm.group_id from public.group_messages gm where gm.id = group_message_reads.message_id)
  )
);
drop policy if exists gmdr_update_self_member on public.group_message_reads;
create policy gmdr_update_self_member on public.group_message_reads for update to authenticated
using (
  user_id = auth.uid() and public.is_group_member(
    (select gm.group_id from public.group_messages gm where gm.id = group_message_reads.message_id)
  )
)
with check (
  user_id = auth.uid() and public.is_group_member(
    (select gm.group_id from public.group_messages gm where gm.id = group_message_reads.message_id)
  )
);

alter table public.group_reads enable row level security;
drop policy if exists group_reads_self on public.group_reads;
create policy group_reads_self on public.group_reads for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.group_live_locations enable row level security;
drop policy if exists gll_select_member on public.group_live_locations;
create policy gll_select_member on public.group_live_locations for select to authenticated using (public.is_group_member(group_id));
drop policy if exists gll_upsert_self on public.group_live_locations;
create policy gll_upsert_self on public.group_live_locations for insert to authenticated with check (user_id = auth.uid() and public.is_group_member(group_id));
drop policy if exists gll_update_self on public.group_live_locations;
create policy gll_update_self on public.group_live_locations for update to authenticated using (user_id = auth.uid() and public.is_group_member(group_id)) with check (user_id = auth.uid() and public.is_group_member(group_id));

alter table public.group_polls enable row level security;
alter table public.group_poll_options enable row level security;
alter table public.group_votes enable row level security;
drop policy if exists polls_select_member on public.group_polls;
create policy polls_select_member on public.group_polls for select to authenticated using (public.is_group_member(group_id));
drop policy if exists polls_insert_host on public.group_polls;
create policy polls_insert_host on public.group_polls for insert to authenticated with check (public.is_group_host(group_id));
drop policy if exists polls_update_host on public.group_polls;
create policy polls_update_host on public.group_polls for update to authenticated using (public.is_group_host(group_id)) with check (public.is_group_host(group_id));

drop policy if exists options_select_member on public.group_poll_options;
create policy options_select_member on public.group_poll_options for select to authenticated using (
  exists (select 1 from public.group_polls p where p.id = poll_id and public.is_group_member(p.group_id))
);
drop policy if exists options_insert_host on public.group_poll_options;
create policy options_insert_host on public.group_poll_options for insert to authenticated with check (
  exists (select 1 from public.group_polls p where p.id = poll_id and public.is_group_host(p.group_id))
);

drop policy if exists votes_select_member on public.group_votes;
create policy votes_select_member on public.group_votes for select to authenticated using (
  exists (select 1 from public.group_polls p where p.id = poll_id and public.is_group_member(p.group_id))
);
drop policy if exists votes_upsert_member on public.group_votes;
create policy votes_upsert_member on public.group_votes for insert to authenticated with check (
  user_id = auth.uid() and exists (select 1 from public.group_polls p where p.id = poll_id and public.is_group_member(p.group_id))
);
drop policy if exists votes_update_member on public.group_votes;
create policy votes_update_member on public.group_votes for update to authenticated
using (
  user_id = auth.uid()
  and exists (select 1 from public.group_polls p where p.id = poll_id and public.is_group_member(p.group_id))
)
with check (
  user_id = auth.uid()
  and exists (select 1 from public.group_polls p where p.id = poll_id and public.is_group_member(p.group_id))
);
drop policy if exists votes_delete_own on public.group_votes;
create policy votes_delete_own on public.group_votes for delete to authenticated using (user_id = auth.uid());

alter table public.friendships enable row level security;
drop policy if exists fr_select_participants on public.friendships;
create policy fr_select_participants on public.friendships for select to authenticated using (user_id_a = auth.uid() or user_id_b = auth.uid());
drop policy if exists fr_insert_self on public.friendships;
create policy fr_insert_self on public.friendships for insert to authenticated with check (requested_by = auth.uid() and (user_id_a = auth.uid() or user_id_b = auth.uid()));
drop policy if exists fr_update_participants on public.friendships;
create policy fr_update_participants on public.friendships for update to authenticated using (user_id_a = auth.uid() or user_id_b = auth.uid()) with check (true);
drop policy if exists fr_delete_participants on public.friendships;
create policy fr_delete_participants on public.friendships for delete to authenticated using (user_id_a = auth.uid() or user_id_b = auth.uid());

alter table public.direct_messages enable row level security;
drop policy if exists dm_participants_select on public.direct_messages;
create policy dm_participants_select on public.direct_messages for select to authenticated using (sender = auth.uid() or receiver = auth.uid());
drop policy if exists dm_from_self on public.direct_messages;
create policy dm_from_self on public.direct_messages for insert to authenticated with check (sender = auth.uid());

alter table public.group_invitations enable row level security;
drop policy if exists inv_select on public.group_invitations;
create policy inv_select on public.group_invitations for select to authenticated using (recipient_id = auth.uid() or inviter_id = auth.uid());
drop policy if exists inv_insert on public.group_invitations;
create policy inv_insert on public.group_invitations for insert to authenticated with check (inviter_id = auth.uid());
drop policy if exists inv_update on public.group_invitations;
create policy inv_update on public.group_invitations for update to authenticated using (recipient_id = auth.uid() or inviter_id = auth.uid()) with check (true);

alter table public.group_invites enable row level security;
drop policy if exists inv_codes_select on public.group_invites;
create policy inv_codes_select on public.group_invites for select to authenticated using (created_by = auth.uid() or public.is_group_host(group_id));
drop policy if exists inv_codes_insert on public.group_invites;
create policy inv_codes_insert on public.group_invites for insert to authenticated with check (created_by = auth.uid());

alter table public.notifications enable row level security;
drop policy if exists notif_select on public.notifications;
create policy notif_select on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists notif_insert on public.notifications;
create policy notif_insert on public.notifications for insert to authenticated with check (user_id = auth.uid());
drop policy if exists notif_update on public.notifications;
create policy notif_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.category_requests enable row level security;
drop policy if exists catreq_select on public.category_requests;
create policy catreq_select on public.category_requests for select to authenticated using (true);
drop policy if exists catreq_insert on public.category_requests;
create policy catreq_insert on public.category_requests for insert to authenticated with check (requested_by = auth.uid());

alter table public.rating_pairs enable row level security;
drop policy if exists rating_read on public.rating_pairs;
create policy rating_read on public.rating_pairs for select to authenticated using (rater_id = auth.uid() or ratee_id = auth.uid());
drop policy if exists rating_upsert on public.rating_pairs;
create policy rating_upsert on public.rating_pairs for insert to authenticated with check (rater_id = auth.uid());
drop policy if exists rating_update on public.rating_pairs;
create policy rating_update on public.rating_pairs for update to authenticated using (rater_id = auth.uid()) with check (rater_id = auth.uid());

alter table public.reports enable row level security;
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert to authenticated with check (reporter_id = auth.uid());
drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports for select to authenticated using (reporter_id = auth.uid());

-- ---------------------------------------------------------------------
-- RPCs / helper procedures
-- ---------------------------------------------------------------------
create or replace function public.send_group_message(
  p_group_id    uuid,
  p_content     text,
  p_parent_id   uuid default null,
  p_attachments jsonb default '[]'::jsonb
)
returns public.group_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.group_messages;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if not public.is_group_member(p_group_id) then raise exception 'not_a_member' using errcode='42501'; end if;

  insert into public.group_messages (group_id, sender_id, content, parent_id, attachments)
  values (p_group_id, auth.uid(), p_content, p_parent_id, coalesce(p_attachments, '[]'::jsonb))
  returning * into m;

  -- mark self as read immediately
  begin
    insert into public.group_message_reads (message_id, user_id, read_at)
    values (m.id, auth.uid(), now())
    on conflict (message_id, user_id) do update set read_at = excluded.read_at;
    insert into public.group_reads (group_id, user_id, last_read_at)
    values (p_group_id, auth.uid(), now())
    on conflict (group_id, user_id) do update set last_read_at = excluded.last_read_at;
  exception when others then null;
  end;

  return m;
end;
$$;

create or replace function public.mark_group_read(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  last_msg uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if not public.is_group_member(p_group_id) then raise exception 'not_a_member' using errcode='42501'; end if;

  select id into last_msg from public.group_messages where group_id = p_group_id order by created_at desc limit 1;
  if last_msg is not null then
    insert into public.group_message_reads (message_id, user_id, read_at)
    values (last_msg, auth.uid(), now())
    on conflict (message_id, user_id) do update set read_at = excluded.read_at;
  end if;

  insert into public.group_reads (group_id, user_id, last_read_at)
  values (p_group_id, auth.uid(), now())
  on conflict (group_id, user_id) do update set last_read_at = excluded.last_read_at;
end;
$$;

create or replace function public.request_friend(target_id uuid)
returns public.friendships
language plpgsql
security definer
set search_path = public
as $$
declare
  a uuid; b uuid; existing public.friendships;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if target_id = auth.uid() then raise exception 'cannot_friend_self'; end if;

  a := least(auth.uid(), target_id);
  b := greatest(auth.uid(), target_id);

  select * into existing from public.friendships
  where least(user_id_a, user_id_b) = a
    and greatest(user_id_a, user_id_b) = b;

  if existing.id is not null then
    if existing.status = 'blocked' and existing.requested_by <> auth.uid() then
      raise exception 'blocked';
    end if;
    update public.friendships
      set status = 'pending', requested_by = auth.uid(), updated_at = now()
      where id = existing.id
      returning * into existing;
    return existing;
  end if;

  insert into public.friendships (user_id_a, user_id_b, status, requested_by)
  values (a, b, 'pending', auth.uid())
  returning * into existing;
  return existing;
end;
$$;

create or replace function public.accept_friend(from_id uuid)
returns public.friendships
language plpgsql
security definer
set search_path = public
as $$
declare
  a uuid; b uuid; row public.friendships;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  a := least(auth.uid(), from_id);
  b := greatest(auth.uid(), from_id);

  select * into row from public.friendships
  where least(user_id_a, user_id_b) = a
    and greatest(user_id_a, user_id_b) = b;

  if row.id is null then raise exception 'no_request_found'; end if;

  update public.friendships
    set status = 'accepted', updated_at = now()
    where id = row.id
    returning * into row;
  return row;
end;
$$;

create or replace function public.remove_friend(other_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  delete from public.friendships
  where least(user_id_a, user_id_b) = least(auth.uid(), other_id)
    and greatest(user_id_a, user_id_b) = greatest(auth.uid(), other_id);
end;
$$;

create or replace function public.block_user(target_id uuid)
returns public.friendships
language plpgsql
security definer
set search_path = public
as $$
declare
  a uuid; b uuid; row public.friendships;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if target_id = auth.uid() then raise exception 'cannot_block_self'; end if;
  a := least(auth.uid(), target_id);
  b := greatest(auth.uid(), target_id);

  insert into public.friendships (user_id_a, user_id_b, status, requested_by)
  values (a, b, 'blocked', auth.uid())
  on conflict (least(user_id_a, user_id_b), greatest(user_id_a, user_id_b))
  do update set status = 'blocked', requested_by = auth.uid(), updated_at = now()
  returning * into row;
  return row;
end;
$$;

create or replace function public.get_my_friend_requests()
returns table (
  id uuid,
  sender_id uuid,
  sender_name text,
  sender_avatar text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select f.id,
         f.requested_by as sender_id,
         p.name as sender_name,
         p.avatar_url as sender_avatar,
         f.created_at
  from public.friendships f
  join public.profiles p on p.user_id = f.requested_by
  where f.status = 'pending'
    and (f.user_id_a = auth.uid() or f.user_id_b = auth.uid())
    and f.requested_by <> auth.uid()
  order by f.created_at desc;
$$;

create or replace function public.submit_rating(p_ratee uuid, p_stars integer)
returns public.profiles
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_profile public.profiles;
  v_allow boolean;
  v_existing public.rating_pairs;
  v_avg numeric;
  v_count integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_stars < 1 or p_stars > 6 then raise exception 'invalid_stars'; end if;

  select allow_ratings into v_allow from public.profiles where user_id = p_ratee;
  if coalesce(v_allow, true) = false then
    raise exception 'ratings_disabled';
  end if;

  select * into v_existing from public.rating_pairs where rater_id = auth.uid() and ratee_id = p_ratee;

  if v_existing.id is null then
    insert into public.rating_pairs (rater_id, ratee_id, stars, next_allowed_at, edit_used)
    values (auth.uid(), p_ratee, p_stars, now() + interval '14 days', false);
  else
    if now() < v_existing.next_allowed_at then
      if v_existing.edit_used then raise exception 'rate_cooldown_active'; end if;
      update public.rating_pairs
        set stars = p_stars, edit_used = true, updated_at = now()
        where id = v_existing.id;
    else
      update public.rating_pairs
        set stars = p_stars, edit_used = false, next_allowed_at = now() + interval '14 days', updated_at = now()
        where id = v_existing.id;
    end if;
  end if;

  select avg(stars)::numeric, count(*) into v_avg, v_count from public.rating_pairs where ratee_id = p_ratee;
  update public.profiles
    set rating_avg = coalesce(v_avg, 0), rating_count = v_count
    where user_id = p_ratee
    returning * into v_profile;
  return v_profile;
end;
$$;

create or replace function public.send_group_invites(p_group_id uuid, p_recipient_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rid uuid;
  title text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_group_host(p_group_id) then raise exception 'not_host'; end if;

  select g.title into title from public.groups g where g.id = p_group_id;

  foreach rid in array coalesce(p_recipient_ids, '{}') loop
    insert into public.group_members (group_id, user_id, role, status)
    values (p_group_id, rid, 'member', 'invited')
    on conflict (group_id, user_id) do update set status = 'invited';

    insert into public.group_invitations (group_id, inviter_id, recipient_id, status, updated_at)
    values (p_group_id, auth.uid(), rid, 'pending', now())
    on conflict (group_id, recipient_id)
    do update set status = excluded.status, updated_at = now();

    begin
      insert into public.notifications (user_id, kind, payload, is_read)
      values (
        rid,
        'group_invite',
        jsonb_build_object('group_id', p_group_id, 'group_title', title, 'inviter_id', auth.uid()),
        false
      );
    exception when others then null;
    end;
  end loop;
end;
$$;

create or replace function public.make_group_invite(
  p_group_id uuid,
  p_hours integer default 168,
  p_max_uses integer default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_expires timestamptz;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_group_host(p_group_id) then raise exception 'not_host'; end if;

  v_expires := case when p_hours is null or p_hours <= 0 then null else now() + make_interval(hours => p_hours) end;

  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    begin
      insert into public.group_invites (code, group_id, created_by, expires_at, max_uses)
      values (v_code, p_group_id, auth.uid(), v_expires, p_max_uses);
      exit;
    exception when unique_violation then
      continue;
    end;
  end loop;
  return v_code;
end;
$$;

create or replace function public.join_via_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.group_invites;
  v_capacity integer;
  v_member_cnt integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode='42501'; end if;

  select * into v_inv from public.group_invites where code = upper(trim(p_code));
  if not found then raise exception 'invite_not_found'; end if;
  if v_inv.expires_at is not null and v_inv.expires_at < now() then raise exception 'invite_expired'; end if;
  if v_inv.max_uses is not null and coalesce(v_inv.use_count,0) >= v_inv.max_uses then raise exception 'invite_used_up'; end if;

  select capacity into v_capacity from public.groups where id = v_inv.group_id;
  if v_capacity is not null then
    select count(*) into v_member_cnt from public.group_members where group_id = v_inv.group_id and status in ('active','accepted');
    if v_member_cnt >= v_capacity then raise exception 'group_full'; end if;
  end if;

  insert into public.group_members (group_id, user_id, role, status)
  values (v_inv.group_id, auth.uid(), 'member', 'active')
  on conflict (group_id, user_id) do update set status = 'active';

  update public.group_invites set use_count = coalesce(use_count,0) + 1 where code = v_inv.code;
  return v_inv.group_id;
end;
$$;

create or replace function public.resolve_poll(p_poll_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
  v_creator uuid;
begin
  select group_id, created_by into v_group, v_creator from public.group_polls where id = p_poll_id;
  if v_group is null then raise exception 'poll_not_found'; end if;
  if not public.is_group_host(v_group) and v_creator <> auth.uid() then
    raise exception 'not_allowed';
  end if;
  update public.group_polls
    set status = 'closed',
        closes_at = coalesce(closes_at, now())
    where id = p_poll_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Seed data
-- ---------------------------------------------------------------------
insert into public.allowed_categories(name) values ('games'), ('study'), ('outdoors')
on conflict (name) do nothing;

insert into public.allowed_games(id, name, category) values
  ('hokm','Hokm','games'),
  ('mafia','Mafia','games'),
  ('chess','Chess','games'),
  ('takhtenard','Takhte Nard','games'),
  ('monopoly','Monopoly','games'),
  ('uno','UNO','games'),
  ('mathematics','Mathematics','study'),
  ('biology','Biology','study'),
  ('chemistry','Chemistry','study'),
  ('history','History','study'),
  ('hiking','Hiking','outdoors'),
  ('camping','Camping','outdoors'),
  ('kayaking','Kayaking','outdoors')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Realtime publication (ensure required tables are included)
-- ---------------------------------------------------------------------
do $$
begin
  perform 1 from pg_publication where pubname = 'supabase_realtime';
  if not found then
    create publication supabase_realtime;
  end if;

  perform 1 from pg_publication p
    join pg_publication_rel pr on pr.prpubid = p.oid
    join pg_class c on c.oid = pr.prrelid
    join pg_namespace n on n.oid = c.relnamespace
   where p.pubname='supabase_realtime' and n.nspname='public' and c.relname='group_messages';
  if not found then alter publication supabase_realtime add table public.group_messages; end if;

  perform 1 from pg_publication p
    join pg_publication_rel pr on pr.prpubid = p.oid
    join pg_class c on c.oid = pr.prrelid
    join pg_namespace n on n.oid = c.relnamespace
   where p.pubname='supabase_realtime' and n.nspname='public' and c.relname='group_message_reactions';
  if not found then alter publication supabase_realtime add table public.group_message_reactions; end if;

  perform 1 from pg_publication p
    join pg_publication_rel pr on pr.prpubid = p.oid
    join pg_class c on c.oid = pr.prrelid
    join pg_namespace n on n.oid = c.relnamespace
   where p.pubname='supabase_realtime' and n.nspname='public' and c.relname='group_message_reads';
  if not found then alter publication supabase_realtime add table public.group_message_reads; end if;

  perform 1 from pg_publication p
    join pg_publication_rel pr on pr.prpubid = p.oid
    join pg_class c on c.oid = pr.prrelid
    join pg_namespace n on n.oid = c.relnamespace
   where p.pubname='supabase_realtime' and n.nspname='public' and c.relname='group_members';
  if not found then alter publication supabase_realtime add table public.group_members; end if;

  perform 1 from pg_publication p
    join pg_publication_rel pr on pr.prpubid = p.oid
    join pg_class c on c.oid = pr.prrelid
    join pg_namespace n on n.oid = c.relnamespace
   where p.pubname='supabase_realtime' and n.nspname='public' and c.relname='group_live_locations';
  if not found then alter publication supabase_realtime add table public.group_live_locations; end if;

  perform 1 from pg_publication p
    join pg_publication_rel pr on pr.prpubid = p.oid
    join pg_class c on c.oid = pr.prrelid
    join pg_namespace n on n.oid = c.relnamespace
   where p.pubname='supabase_realtime' and n.nspname='public' and c.relname='direct_messages';
  if not found then alter publication supabase_realtime add table public.direct_messages; end if;
end$$;

-- ---------------------------------------------------------------------
-- Grants (baseline; RLS still controls access)
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on table public.allowed_categories to anon;
grant select on table public.allowed_games to anon;
grant usage, select on all sequences in schema public to authenticated;

notify pgrst, 'reload schema';
