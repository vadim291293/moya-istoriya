create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.schedule(
  'ai-news-monitor-every-15-minutes',
  '*/15 * * * *',
  $job$
    select net.http_post(
      url := 'https://xdcqjzaceraigcgwglff.supabase.co/functions/v1/ai-news-monitor',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-news-token', (select decrypted_secret from vault.decrypted_secrets where name = 'ai_news_scheduler_token')
      ),
      body := '{"action":"run"}'::jsonb,
      timeout_milliseconds := 100000
    )
    from public.news_settings where id and enabled;
  $job$
);
