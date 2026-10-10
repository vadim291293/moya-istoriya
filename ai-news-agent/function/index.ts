import { createHandler } from './worker.mjs';

// The private scheduler token is checked by the handler before any provider call.
// Supabase JWT verification is disabled because cron uses this custom token.
Deno.serve(createHandler(() => ({
  SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
  SUPABASE_SECRET_KEYS: Deno.env.get('SUPABASE_SECRET_KEYS'),
  SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  GROQ_API_KEY: Deno.env.get('GROQ_API_KEY'),
  TELEGRAM_BOT_TOKEN: Deno.env.get('TELEGRAM_BOT_TOKEN'),
}), fetch, (promise) => EdgeRuntime.waitUntil(promise)));
