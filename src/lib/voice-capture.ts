import type { VoiceAsset } from './memory-asset';

export type VoicePhase = 'idle' | 'starting' | 'recording' | 'stopping';
// A permission/prepare promise from an old screen must not race a new recorder.
let captureOwner: object | null = null;
export function createVoiceCapture(deps: {
  active: () => boolean;
  canPublish: () => boolean;
  permission: () => Promise<boolean>;
  mode: (recording: boolean) => Promise<void>;
  prepare: () => Promise<void>;
  record: () => void;
  stop: () => Promise<void>;
  uri: () => string | null;
  asset: (uri: string) => Promise<VoiceAsset>;
  phase: (phase: VoicePhase) => void;
  error: (message: string) => void;
  accept: (asset: VoiceAsset) => void;
}) {
  const owner = {};
  let phase: VoicePhase = 'idle';
  let cancelled = false;
  const currentPhase = (): VoicePhase => phase;
  const change = (next: VoicePhase) => { phase = next; if (deps.canPublish()) deps.phase(next); };
  const report = (message: string) => { if (deps.canPublish()) deps.error(message); };
  const valid = () => !cancelled && captureOwner === owner && deps.active();
  async function reset() {
    try { await deps.mode(false); } catch { /* Microphone has already been stopped. */ }
    if (captureOwner === owner) captureOwner = null;
    change('idle');
  }
  return {
    async start() {
      if (phase !== 'idle' || !deps.active()) return;
      if (captureOwner) { report('Дождитесь завершения предыдущей записи голоса.'); return; }
      captureOwner = owner; cancelled = false; change('starting');
      let prepared = false;
      try {
        if (!await deps.permission()) { report('Разрешите доступ к микрофону, чтобы сохранить голос.'); return; }
        if (!valid()) return;
        await deps.mode(true);
        if (!valid()) return;
        await deps.prepare(); prepared = true;
        if (!valid()) return;
        deps.record(); change('recording');
      } catch { report('Не удалось начать запись голоса. Проверьте разрешение на микрофон.'); }
      finally {
        if (currentPhase() !== 'recording') {
          if (prepared) try { await deps.stop(); } catch { /* No recording started. */ }
          await reset();
        }
      }
    },
    async stop(accept = true, alreadyFinished = false, completedUri?: string | null) {
      if (phase !== 'recording') return;
      change('stopping');
      try {
        if (!alreadyFinished) await deps.stop();
        const uri = completedUri ?? deps.uri();
        if (accept && !cancelled && uri && deps.canPublish()) {
          const asset = await deps.asset(uri);
          if (!cancelled && deps.canPublish()) deps.accept(asset);
        }
      } catch { report('Не удалось сохранить голос. Попробуйте записать ещё раз.'); }
      finally { await reset(); }
    },
    cancel() {
      cancelled = true;
      // Stop synchronously dispatched on blur/unmount; pending preparation will
      // observe cancellation at each awaited boundary and never start the mic.
      if (phase === 'recording') void this.stop(false);
    },
    get phase() { return phase; },
  };
}
