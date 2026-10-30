import { STUDIO_MAX_RETRY_AFTER_SECONDS } from './studio-policy.mjs';

// Process-local observation only. A caller must persist and verify a proof under
// the journal lock before treating a wait as complete across processes/restarts.
export function createRetryWaitTracker(clock = () => performance.now()) {
  if (typeof clock !== 'function') throw new TypeError('Invalid monotonic clock');
  const observations = new Map();
  let last = -Infinity;
  let failed = false;
  function time() {
    if (failed) throw new Error('Monotonic clock unavailable');
    let value;
    try { value = clock(); } catch { failed = true; throw new Error('Monotonic clock unavailable'); }
    if (!Number.isFinite(value) || value < 0 || value < last) {
      failed = true;
      throw new Error('Monotonic clock unavailable');
    }
    last = value;
    return value;
  }
  return {
    observe(identity, seconds) {
      if (typeof identity !== 'string' || identity.length < 1 || identity.length > 128 ||
          !Number.isInteger(seconds) || seconds < 1 || seconds > STUDIO_MAX_RETRY_AFTER_SECONDS) {
        throw new TypeError('Invalid retry wait');
      }
      const now = time();
      const prior = observations.get(identity);
      if (prior && prior.seconds !== seconds) throw new Error('Conflicting retry wait');
      if (!prior) observations.set(identity, { seconds, start: now });
    },
    elapsed(identity) {
      const entry = observations.get(identity);
      if (!entry) throw new Error('Retry wait has not been observed');
      return time() - entry.start >= entry.seconds * 1000;
    },
  };
}
