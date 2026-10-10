-- Hosted setup for the dedicated AI-news project.
create table public.news_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  scheduler_token_hash text not null,
  model text not null default 'qwen/qwen3.8-27b',
  daily_token_budget integer not null default 100000 check (daily_token_budget between 7000 and 150000),
  daily_request_budget integer not null default 80 check (daily_request_budget between 1 and 500),
  telegram_chat_id text,
  pairing_code text not null default left(replace(gen_random_uuid()::text, '-', ''), 12),
  started_at timestamptz,
  lock_owner uuid,
  lock_until timestamptz,
  blocked_until timestamptz
);
create table public.news_sources (
  id text primary key,
  name text not null,
  feed_url text not null,
  allowed_host text not null,
  initialized boolean not null default false,
  enabled boolean not null default true,
  etag text,
  last_modified text,
  last_success_at timestamptz,
  last_error text
);
create table public.news_items (
  id uuid primary key default gen_random_uuid(),
  source_id text not null references public.news_sources(id),
  url text not null unique,
  title text not null,
  excerpt text not null default '',
  published_at timestamptz,
  discovered_at timestamptz not null default now(),
  state text not null default 'pending' check (state in
    ('pending','baseline','skipped','reviewed','ready','sending','sent','uncertain','failed','duplicate')),
  decision jsonb,
  event_key text,
  attempts integer not null default 0,
  telegram_message_id bigint,
  sent_at timestamptz,
  last_error text
);
create index news_items_pending on public.news_items(discovered_at) where state = 'pending';
create unique index news_items_event_key on public.news_items(event_key) where event_key is not null;
create table public.news_runs (
  id uuid primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  details jsonb not null default '{}'::jsonb
);
create table public.news_usage (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.news_runs(id),
  day date not null default ((now() at time zone 'UTC')::date),
  reserved_tokens integer not null check (reserved_tokens between 1 and 7000),
  used_tokens integer,
  created_at timestamptz not null default now()
);
create index news_usage_day on public.news_usage(day);

alter table public.news_settings enable row level security;
alter table public.news_sources enable row level security;
alter table public.news_items enable row level security;
alter table public.news_runs enable row level security;
alter table public.news_usage enable row level security;
revoke all on public.news_settings, public.news_sources, public.news_items, public.news_runs, public.news_usage from public, anon, authenticated;
grant select, insert, update, delete on public.news_settings, public.news_sources, public.news_items, public.news_runs, public.news_usage to service_role;

do $setup$
declare
  monitor_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  perform vault.create_secret(monitor_token, 'ai_news_scheduler_token', 'Private token for the AI news scheduler');
  insert into public.news_settings (scheduler_token_hash)
  values (encode(sha256(convert_to(monitor_token, 'UTF8')), 'hex'));
end;
$setup$;

insert into public.news_sources (id, name, feed_url, allowed_host) values
  ('openai', 'OpenAI', 'https://openai.com/news/rss.xml', 'openai.com'),
  ('google_ai', 'Google AI', 'https://blog.google/technology/ai/rss/', 'blog.google'),
  ('huggingface', 'Hugging Face', 'https://huggingface.co/blog/feed.xml', 'huggingface.co');

create function public.news_begin_run(p_run_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $fn$
begin
  update public.news_settings
  set lock_owner = p_run_id, lock_until = now() + interval '3 minutes'
  where id and enabled
    and (lock_until is null or lock_until < now())
    and (blocked_until is null or blocked_until <= now());
  if not found then return false; end if;
  insert into public.news_runs(id) values(p_run_id);
  return true;
end;
$fn$;
revoke all on function public.news_begin_run(uuid) from public, anon, authenticated;
grant execute on function public.news_begin_run(uuid) to service_role;

create function public.news_reserve_tokens(p_run_id uuid, p_tokens integer)
returns uuid language plpgsql security invoker set search_path = '' as $fn$
declare
  cfg public.news_settings%rowtype;
  token_count bigint;
  request_count bigint;
  reservation uuid;
begin
  select * into cfg from public.news_settings where id for update;
  if not cfg.enabled or cfg.lock_owner is distinct from p_run_id or cfg.lock_until <= now()
     or p_tokens < 1 or p_tokens > 7000 then return null; end if;
  select coalesce(sum(coalesce(used_tokens, reserved_tokens)),0), count(*)
    into token_count, request_count from public.news_usage
    where day = (now() at time zone 'UTC')::date;
  if token_count + p_tokens > cfg.daily_token_budget
    or request_count >= cfg.daily_request_budget then return null; end if;
  insert into public.news_usage(run_id, reserved_tokens)
    values(p_run_id, p_tokens) returning id into reservation;
  return reservation;
end;
$fn$;
revoke all on function public.news_reserve_tokens(uuid, integer) from public, anon, authenticated;
grant execute on function public.news_reserve_tokens(uuid, integer) to service_role;
