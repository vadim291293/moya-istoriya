alter table public.news_sources add column kind text not null default 'rss' check (kind in ('rss','html'));
alter table public.news_sources add column config jsonb not null default '{}'::jsonb;
alter table public.news_settings add column chat_enabled boolean not null default true;
alter table public.news_settings add column webhook_token_hash text;
create table public.news_chat_inbox (
 update_id bigint primary key,
 text text not null,
 state text not null default 'pending' check (state in ('pending','processing','ready','sending','sent','uncertain','failed')),
 response text,
 attempts integer not null default 0,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 telegram_message_id bigint,
 last_error text
);
create index news_chat_pending on public.news_chat_inbox(created_at) where state in ('pending','ready');
alter table public.news_chat_inbox enable row level security;
revoke all on public.news_chat_inbox from public,anon,authenticated;
grant select,insert,update,delete on public.news_chat_inbox to service_role;

do $setup$
declare token text:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
begin
 perform vault.create_secret(token,'ai_news_webhook_token','Private Telegram webhook token');
 update public.news_settings set webhook_token_hash=encode(sha256(convert_to(token,'UTF8')),'hex') where id;
end;
$setup$;

insert into public.news_sources(id,name,feed_url,allowed_host,kind,config) values
 ('gemini','Gemini / Veo','https://blog.google/products/gemini/rss/','blog.google','rss','{}'),
 ('xai','xAI / Grok (публикации xAI через Google News)','https://news.google.com/rss/search?q=site%3Ax.ai%2Fnews&hl=en-US&gl=US&ceid=US%3Aen','news.google.com','rss','{}'),
 ('runway','Runway Research','https://runwayml.com/research','runwayml.com','html','{"extra_hosts":["runway.com"]}'),
 ('luma','Luma AI','https://lumalabs.ai/news','lumalabs.ai','html','{}');

create function public.news_begin_chat_run(p_run_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $fn$
begin
 update public.news_settings set lock_owner=p_run_id,lock_until=now()+interval '3 minutes'
 where id and chat_enabled and (lock_until is null or lock_until<now());
 if not found then return false; end if;
 insert into public.news_runs(id,details) values(p_run_id,'{"kind":"chat"}'::jsonb);
 return true;
end;
$fn$;
revoke all on function public.news_begin_chat_run(uuid) from public,anon,authenticated;
grant execute on function public.news_begin_chat_run(uuid) to service_role;

create or replace function public.news_reserve_tokens(p_run_id uuid,p_tokens integer)
returns uuid language plpgsql security invoker set search_path='' as $fn$
declare cfg public.news_settings%rowtype; tokens bigint; requests bigint; reservation uuid;
begin
 select * into cfg from public.news_settings where id for update;
 if cfg.lock_owner is distinct from p_run_id or cfg.lock_until<=now()
  or (cfg.blocked_until is not null and cfg.blocked_until>now())
  or p_tokens<1 or p_tokens>7000 then return null; end if;
 select coalesce(sum(coalesce(used_tokens,reserved_tokens)),0),count(*) into tokens,requests
 from public.news_usage where day=(now() at time zone 'UTC')::date;
 if tokens+p_tokens>cfg.daily_token_budget or requests>=cfg.daily_request_budget then return null; end if;
 insert into public.news_usage(run_id,reserved_tokens) values(p_run_id,p_tokens) returning id into reservation;
 return reservation;
end;
$fn$;

select cron.schedule('ai-news-chat-recovery','* * * * *',$job$
 select net.http_post(
  url:='https://xdcqjzaceraigcgwglff.supabase.co/functions/v1/ai-news-monitor',
  headers:=jsonb_build_object('Content-Type','application/json','x-news-token',
   (select decrypted_secret from vault.decrypted_secrets where name='ai_news_scheduler_token')),
  body:='{"action":"chat"}'::jsonb,timeout_milliseconds:=100000)
 from public.news_settings where id and chat_enabled and exists(
  select 1 from public.news_chat_inbox where state in ('pending','processing','ready','sending'));
$job$);
select cron.schedule('ai-news-chat-retention','37 2 * * *',$job$
 delete from public.news_chat_inbox where created_at<now()-interval '30 days' and state in ('sent','failed','uncertain');
$job$);
