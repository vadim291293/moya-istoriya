export class Failure extends Error {
  constructor(code, retry = 0) { super(code); this.code = code; this.retry = retry; }
}
export const errorCode = error => error instanceof Failure ? error.code : 'internal_error';
export const deadline = ms => AbortSignal.timeout(ms);
export const safeJson = async response => {
  try { return await response.json(); } catch { throw new Failure('invalid_json'); }
};
export async function telegram(method, body, env, fetchImpl) {
  let response;
  try { response = await fetchImpl('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/' + method,
    { method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:deadline(10000) }); }
  catch { throw new Failure('telegram_delivery_unknown'); }
  let data;
  try { data = await response.json(); } catch { throw new Failure('telegram_delivery_unknown'); }
  if (data.ok !== true) {
    if (response.status === 429 || data.error_code === 429)
      throw new Failure('telegram_rate_limit',Math.max(60,Number(data.parameters?.retry_after)||60));
    if(response.status>=500) throw new Failure('telegram_delivery_unknown');
    throw new Failure('telegram_rejected');
  }
  return data.result;
}
