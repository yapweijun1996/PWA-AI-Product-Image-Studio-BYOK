import { constants } from 'node:fs';
import { open, lstat, mkdir, readdir, rmdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const RECORD = /^([a-f0-9]{64})-([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(\.result)?$/;
const HASH = /^[a-f0-9]{64}$/;
const OUTCOMES = new Set(['DEFINITIVE_SUCCESS', 'DEFINITIVE_FAILURE', 'UNKNOWN']);

// This store intentionally fails closed on an interrupted write or stale lock. No
// attempt evidence is automatically removed; a stale lock requires owner review.
export async function createAttemptJournal(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) throw new Error('An absolute private attempt journal directory is required.');
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw new Error('Attempt journal directory must be owner-only and owned by this process.');
  async function syncDir() { const fd = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW); try { await fd.sync(); } finally { await fd.close(); } }
  async function put(name, value) {
    const fd = await open(join(directory, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await fd.writeFile(JSON.stringify(value)); await fd.sync(); } finally { await fd.close(); }
    await syncDir();
  }
  async function readRecord(name) {
    const fd = await open(join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await fd.stat();
      if (!info.isFile() || (info.mode & 0o077) || info.size > 1024 || (typeof process.getuid === 'function' && info.uid !== process.getuid())) throw new Error('Invalid journal entry');
      return JSON.parse(await fd.readFile('utf8'));
    } finally { await fd.close(); }
  }
  async function scan() {
    const entries = await readdir(directory), reservations = new Map(), results = [];
    for (const name of entries) {
      if (name === '.lock' || name === '.inflight') continue;
      const match = RECORD.exec(name);
      if (!match) throw new Error('Invalid journal entry');
      const value = await readRecord(name);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid journal entry');
      if (match[3]) {
        if (Object.keys(value).length !== 1 || !OUTCOMES.has(value.outcome)) throw new Error('Invalid journal outcome');
        results.push(name.slice(0, -7));
      } else {
        if (Object.keys(value).length !== 2 || !HASH.test(value.digest) || !Number.isSafeInteger(value.reservedAt) || value.reservedAt < 0) throw new Error('Invalid journal reservation');
        reservations.set(name, value);
      }
    }
    for (const name of results) if (!reservations.has(name)) throw new Error('Orphan journal outcome');
    return reservations;
  }
  async function locked(fn) {
    const lock = join(directory, '.lock');
    try { await mkdir(lock, { mode: 0o700 }); } catch { throw new Error('Journal locked or unavailable'); }
    try { await syncDir(); return await fn(); }
    finally { await rmdir(lock); await syncDir(); }
  }
  // Reject corruption before accepting generation, not merely on a duplicate.
  await locked(scan);
  return {
    async begin() {
      try { await mkdir(join(directory, '.inflight'), { mode: 0o700 }); await syncDir(); return true; }
      catch { return false; }
    },
    async end() { await rmdir(join(directory, '.inflight')); await syncDir(); },
    async reserve(principal, attempt, digest, time, maxPerHour) {
      return locked(async () => {
        const records = await scan(), name = `${principal}-${attempt}`;
        if (records.has(name)) return 'duplicate';
        let recent = 0;
        for (const [key, value] of records) if (key.startsWith(`${principal}-`) && value.reservedAt > time - 60 * 60 * 1000) recent++;
        if (recent >= maxPerHour) return 'rate';
        await put(name, { digest, reservedAt: time });
        return 'reserved';
      });
    },
    async finish(principal, attempt, outcome) {
      await locked(async () => { const records = await scan(), name = `${principal}-${attempt}`; if (!records.has(name) || !OUTCOMES.has(outcome)) throw new Error('Invalid journal outcome'); await put(`${name}.result`, { outcome }); });
    }
  };
}
