import { constants } from 'node:fs';
import { open, lstat, link, mkdir, readdir, rmdir, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { isAbsolute, join } from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RECORD = /^([a-f0-9]{64})-([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(\.result|\.ack|\.clean)?$/;
const HASH = /^[a-f0-9]{64}$/;
const TEMP = /^\.tmp-[a-f0-9]{32}$/;
const VERSION_MARKER = '.journal-protocol-v4';
const OUTCOMES = new Set(['DEFINITIVE_SUCCESS', 'DEFINITIVE_FAILURE', 'UNKNOWN']);
function validName(principal, attempt) { return typeof principal === 'string' && HASH.test(principal) && typeof attempt === 'string' && UUID.test(attempt); }
function validDate(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }

// Stale locks and corrupt authoritative records fail closed; never remove foreign evidence.
export async function createAttemptJournal(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) throw new Error('An absolute private attempt journal directory is required.');
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw new Error('Attempt journal directory must be owner-only and owned by this process.');
  async function syncDir() { const fd = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW); try { await fd.sync(); } finally { await fd.close(); } }
  async function put(name, value, published = () => {}) {
    const temp = join(directory, `.tmp-${randomBytes(16).toString('hex')}`);
    const fd = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      try { await fd.writeFile(JSON.stringify(value)); await fd.sync(); } finally { await fd.close(); }
      await link(temp, join(directory, name));
      published();
      await syncDir();
    } finally {
      // A private orphan is safe to leave behind; cleanup must not mask publication.
      try { await unlink(temp); } catch {}
    }
  }
  async function readRecord(name) {
    const fd = await open(join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await fd.stat();
      if (!info.isFile() || (info.mode & 0o077) || info.size > 1024 || (typeof process.getuid === 'function' && info.uid !== process.getuid())) throw new Error('Invalid journal entry');
      return JSON.parse(await fd.readFile('utf8'));
    } finally { await fd.close(); }
  }
  let initialized = false;
  async function scan() {
    const entries = await readdir(directory), reservations = new Map(), results = new Map(), acknowledgements = new Map(), clean = new Map();
    if (initialized && !entries.includes(VERSION_MARKER)) throw new Error('Journal protocol marker missing');
    for (const name of entries) {
      if (name === '.lock' || name === '.inflight') continue;
      if (name === VERSION_MARKER) {
        const version = await readRecord(name);
        if (!version || typeof version !== 'object' || Array.isArray(version) || Object.keys(version).length !== 1 || version.format !== 4) throw new Error('Invalid journal protocol marker');
        continue;
      }
      if (TEMP.test(name)) {
        let info;
        try { info = await lstat(join(directory, name)); }
        catch (reason) { if (reason.code === 'ENOENT') continue; throw reason; }
        if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) || (typeof process.getuid === 'function' && info.uid !== process.getuid())) throw new Error('Invalid journal temporary entry');
        continue;
      }
      const match = RECORD.exec(name);
      if (!match) throw new Error('Invalid journal entry');
      const value = await readRecord(name);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid journal entry');
      const base = `${match[1]}-${match[2]}`;
      if (match[3] === '.result') {
        if (!OUTCOMES.has(value.outcome) || !((Object.keys(value).length === 1 && !('format' in value)) || (Object.keys(value).length === 2 && value.format === 2) || (Object.keys(value).length === 3 && value.format === 3 && value.outcome === 'DEFINITIVE_FAILURE' && Number.isSafeInteger(value.retryNotBefore) && value.retryNotBefore >= 0))) throw new Error('Invalid journal outcome');
        results.set(base, value);
      } else if (match[3] === '.ack') {
        if (Object.keys(value).length !== 2 || !OUTCOMES.has(value.recordedOutcome) || !validDate(value.acknowledgedAt)) throw new Error('Invalid journal acknowledgement');
        acknowledgements.set(base, value);
      } else if (match[3] === '.clean') {
        if (Object.keys(value).length !== 1 || !OUTCOMES.has(value.outcome) || value.outcome === 'UNKNOWN') throw new Error('Invalid journal cleanup');
        clean.set(base, value);
      } else {
        if (Object.keys(value).length !== 2 || typeof value.digest !== 'string' || !HASH.test(value.digest) || !Number.isSafeInteger(value.reservedAt) || value.reservedAt < 0) throw new Error('Invalid journal reservation');
        reservations.set(base, value);
      }
    }
    for (const name of results.keys()) if (!reservations.has(name)) throw new Error('Orphan journal outcome');
    for (const [name, value] of acknowledgements) if (!reservations.has(name) || results.get(name)?.outcome !== value.recordedOutcome) throw new Error('Orphan journal acknowledgement');
    for (const [name, value] of clean) if (!reservations.has(name) || ![2, 3].includes(results.get(name)?.format) || results.get(name)?.outcome !== value.outcome) throw new Error('Orphan journal cleanup');
    return { reservations, results, acknowledgements, clean };
  }
  async function locked(fn) {
    const lock = join(directory, '.lock');
    const deadline = performance.now() + 5000;
    for (;;) {
      try { await mkdir(lock, { mode: 0o700 }); break; }
      catch (reason) {
        if (reason.code !== 'EEXIST' || performance.now() >= deadline) throw new Error('Journal locked or unavailable');
        await delay(Math.min(20, Math.max(1, deadline - performance.now())));
      }
    }
    try { await syncDir(); return await fn(); }
    finally { await rmdir(lock); await syncDir(); }
  }
  async function markerMatches(principal, attempt) {
    let info;
    try { info = await lstat(join(directory, '.inflight')); } catch (reason) { if (reason.code === 'ENOENT') return false; throw reason; }
    // Old directory markers and malformed/unowned markers are never recoverable.
    if (!info.isFile() || info.isSymbolicLink()) return false;
    let marker;
    try { marker = await readRecord('.inflight'); } catch { return false; }
    return marker && typeof marker === 'object' && !Array.isArray(marker) && Object.keys(marker).length === 2 && marker.principal === principal && marker.attempt === attempt;
  }
  async function clearMarker(principal, attempt, authorized = () => true) {
    if (!await markerMatches(principal, attempt)) return false;
    // This synchronous check is the authorization serialization point for cleanup.
    if (!authorized()) throw new Error('Authorization revoked');
    await unlink(join(directory, '.inflight'));
    await syncDir();
    return true;
  }
  async function publishClean(name, outcome) {
    try { await put(`${name}.clean`, { outcome }); }
    catch (reason) {
      // A link may have succeeded before a sync or temporary-file cleanup failed.
      let value;
      try { value = await readRecord(`${name}.clean`); } catch { throw reason; }
      if (!value || Object.keys(value).length !== 1 || value.outcome !== outcome) throw reason;
      await syncDir();
    }
  }
  await locked(async () => {
    await scan();
    let marker;
    try { marker = await lstat(join(directory, VERSION_MARKER)); }
    catch (reason) { if (reason.code !== 'ENOENT') throw reason; }
    if (!marker) {
      // An older in-flight operation could otherwise publish after the upgrade.
      try { await lstat(join(directory, '.inflight')); throw new Error('Resolve in-flight work before journal upgrade'); }
      catch (reason) { if (reason.code !== 'ENOENT') throw reason; }
      await put(VERSION_MARKER, { format: 4 });
    }
    initialized = true;
  });
  return {
    async begin(principal, attempt) {
      if (!validName(principal, attempt)) throw new Error('Invalid journal identity');
      let published = false;
      try {
        return await locked(async () => {
          const { reservations, results, acknowledgements, clean } = await scan();
          if (reservations.has(`${principal}-${attempt}`)) return 'duplicate';
          if (await markerMatches(principal, attempt)) return 'duplicate';
          for (const [name, result] of results) {
            if ([2, 3].includes(result.format) && !acknowledgements.has(name) && !clean.has(name)) return 'busy';
          }
          try { await put('.inflight', { principal, attempt }, () => { published = true; }); return 'begun'; }
          catch (reason) { if (reason.code === 'EEXIST' && !published) return 'busy'; throw reason; }
        });
      } catch {
        if (published) {
          try {
            await locked(async () => {
              const { reservations } = await scan();
              if (reservations.has(`${principal}-${attempt}`) || !await clearMarker(principal, attempt)) throw new Error('Marker recovery required');
            });
          } catch { throw new Error('Marker may require manual recovery'); }
        }
        throw new Error('Journal unavailable before submission');
      }
    },
    async end(principal, attempt) {
      if (!validName(principal, attempt)) throw new Error('Invalid journal identity');
      await locked(async () => {
        const { reservations, results, acknowledgements, clean } = await scan(), name = `${principal}-${attempt}`;
        const result = results.get(name);
        if (reservations.has(name) && !result) throw new Error('Attempt has not ended');
        if (acknowledgements.has(name) || clean.has(name)) {
          await clearMarker(principal, attempt);
          return;
        }
        if (result?.outcome === 'UNKNOWN') throw new Error('Unknown outcome requires review');
        if (!await clearMarker(principal, attempt)) {
          if ([2, 3].includes(result?.format)) throw new Error('Cleanup requires review');
          try { await lstat(join(directory, '.inflight')); }
          catch (reason) { if (reason.code === 'ENOENT' && result) return; throw reason; }
          throw new Error('In-flight marker does not match');
        }
        if ([2, 3].includes(result?.format)) await publishClean(name, result.outcome);
      });
    },
    async cleanupResolved(principal, attempt) {
      if (!validName(principal, attempt)) throw new Error('Invalid journal identity');
      try {
        return await locked(async () => {
          const { results, acknowledgements, clean } = await scan(), name = `${principal}-${attempt}`;
          if (!results.has(name) || (!acknowledgements.has(name) && !clean.has(name))) return false;
          await syncDir();
          return true;
        });
      } catch { return false; }
    },
    async hasPendingFailure(principal, attempt) {
      if (!validName(principal, attempt)) throw new Error('Invalid journal identity');
      return locked(async () => {
        const { results, acknowledgements, clean } = await scan(), name = `${principal}-${attempt}`;
        const result = results.get(name);
        if (![2, 3].includes(result?.format) || result.outcome !== 'DEFINITIVE_FAILURE' || acknowledgements.has(name) || clean.has(name)) return false;
        await syncDir();
        return true;
      });
    },
    async revision() {
      return locked(async () => (await scan()).acknowledgements.size);
    },
    async reserve(principal, attempt, digest, time, maxPerHour, revision) {
      if (!validName(principal, attempt) || !Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid journal identity or revision');
      return locked(async () => {
        const { reservations, results, acknowledgements } = await scan(), name = `${principal}-${attempt}`;
        if (acknowledgements.size !== revision) return 'stale';
        if (reservations.has(name)) return 'duplicate';
        if ([...results.entries()].some(([key, result]) => key.startsWith(`${principal}-`) && result.format === 3 && result.retryNotBefore > time)) return 'rate';
        let recent = 0;
        for (const [key, value] of reservations) if (key.startsWith(`${principal}-`) && value.reservedAt > time - 60 * 60 * 1000) recent++;
        if (recent >= maxPerHour) return 'rate';
        await put(name, { digest, reservedAt: time });
        return 'reserved';
      });
    },
    async reserveAndDispatch(principal, attempt, digest, time, maxPerHour, revision, authorized, dispatch, onReserved) {
      if (!validName(principal, attempt) || !HASH.test(digest) || !Number.isSafeInteger(revision) || revision < 0 || typeof authorized !== 'function' || typeof dispatch !== 'function' || typeof onReserved !== 'function') throw new Error('Invalid dispatch');
      return locked(async () => {
        const { reservations, results, acknowledgements } = await scan(), name = `${principal}-${attempt}`;
        if (acknowledgements.size !== revision) return 'stale';
        if (reservations.has(name)) return 'duplicate';
        if ([...results.entries()].some(([key, result]) => key.startsWith(`${principal}-`) && result.format === 3 && result.retryNotBefore > time)) return 'rate';
        let recent = 0;
        for (const [key, value] of reservations) if (key.startsWith(`${principal}-`) && value.reservedAt > time - 60 * 60 * 1000) recent++;
        if (recent >= maxPerHour) return 'rate';
        if (!await markerMatches(principal, attempt)) throw new Error('In-flight marker does not match');
        await put(name, { digest, reservedAt: time }, onReserved);
        if (!authorized()) return 'unauthorized';
        // The callback starts the network operation synchronously, while review is excluded.
        // It must not return a promise to locked(), which must release before the network settles.
        const returned = dispatch();
        if (returned !== undefined) {
          // Do not let a malformed async callback create an unhandled rejection.
          Promise.resolve(returned).catch(() => {});
          throw new Error('Invalid dispatch callback');
        }
        return 'submitted';
      });
    },
    async abortBeforeDispatch(principal, attempt, ownedReservation) {
      if (!validName(principal, attempt)) throw new Error('Invalid journal identity');
      await locked(async () => {
        const { reservations, results, acknowledgements, clean } = await scan(), name = `${principal}-${attempt}`;
        let result = results.get(name);
        if (reservations.has(name) && !ownedReservation) throw new Error('Reservation ownership unknown; manual recovery required');
        if (reservations.has(name) && !result) {
          result = { outcome: 'DEFINITIVE_FAILURE', format: 2 };
          await put(`${name}.result`, result);
        }
        if (result?.outcome === 'UNKNOWN' && !acknowledgements.has(name)) throw new Error('Unknown outcome requires review');
        if (acknowledgements.has(name) || clean.has(name)) {
          await clearMarker(principal, attempt);
          return;
        }
        if (!await clearMarker(principal, attempt)) {
          if ([2, 3].includes(result?.format)) throw new Error('Cleanup requires review');
          try { await lstat(join(directory, '.inflight')); }
          catch (reason) { if (reason.code === 'ENOENT') return; throw reason; }
          throw new Error('In-flight marker does not match; manual recovery required');
        }
        if ([2, 3].includes(result?.format)) await publishClean(name, result.outcome);
      });
    },
    async finish(principal, attempt, outcome, retryNotBefore = null) {
      if (!validName(principal, attempt) || !OUTCOMES.has(outcome) || (retryNotBefore !== null && (outcome !== 'DEFINITIVE_FAILURE' || !Number.isSafeInteger(retryNotBefore) || retryNotBefore < 0))) throw new Error('Invalid journal outcome');
      const name = `${principal}-${attempt}`, reservation = await readRecord(name);
      if (!reservation || Object.keys(reservation).length !== 2 || typeof reservation.digest !== 'string' || !HASH.test(reservation.digest) || !Number.isSafeInteger(reservation.reservedAt) || reservation.reservedAt < 0) throw new Error('Invalid journal reservation');
      // Results are immutable and their reservation already exists. Publication does not
      // need the global lock, so unrelated stale locks cannot lose a known outcome.
      const result = retryNotBefore === null ? { outcome, format: 2 } : { outcome, format: 3, retryNotBefore };
      try { await put(`${name}.result`, result); }
      catch (reason) {
        if (reason.code !== 'EEXIST') throw reason;
        const existing = await readRecord(`${name}.result`);
        if (!existing || (retryNotBefore === null ? !(existing.outcome === outcome && ((Object.keys(existing).length === 1 && !('format' in existing)) || (Object.keys(existing).length === 2 && existing.format === 2))) : !(existing.outcome === outcome && existing.format === 3 && Object.keys(existing).length === 3 && existing.retryNotBefore === retryNotBefore))) throw new Error('Conflicting journal outcome');
        await syncDir();
      }
    },
    async acknowledge(principal, attempt, time, authorized) {
      if (!validName(principal, attempt) || typeof authorized !== 'function') throw new Error('Invalid journal identity or authorization');
      return locked(async () => {
        const { reservations, results, acknowledgements } = await scan(), name = `${principal}-${attempt}`;
        const outcome = results.get(name)?.outcome, existing = acknowledgements.get(name);
        if (!reservations.has(name) || !outcome) return null;
        if (existing) {
          // A prior durable receipt may precede marker cleanup. Never clear a new marker.
          if (!authorized()) throw new Error('Authorization revoked');
          await clearMarker(principal, attempt, authorized);
          return existing;
        }
        if (outcome === 'UNKNOWN' && !await markerMatches(principal, attempt)) return null;
        const acknowledgedAt = new Date(time).toISOString();
        const receipt = { recordedOutcome: outcome, acknowledgedAt };
        // This synchronous check under the lock orders review against logout/disconnect.
        if (!authorized()) throw new Error('Authorization revoked');
        await put(`${name}.ack`, receipt);
        await clearMarker(principal, attempt);
        return receipt;
      });
    }
  };
}
