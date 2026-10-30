import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { createAttemptJournal } from '../../studio-journal.mjs';
const [directory, principal, digest] = process.argv.slice(2);
let monotonic = 0;
const journal = await createAttemptJournal(directory, { monotonicClock: () => monotonic });
process.send({ ready: true });
process.on('message', async (message) => {
  try {
    if (message.action === 'crash-before-dir-sync') {
      const original = fs.link;
      fs.link = async (source, target) => {
        const result = await original(source, target);
        if (String(target).endsWith('.waitproof')) {
          process.send({ linked: true });
          await new Promise(() => {});
        }
        return result;
      };
      syncBuiltinESMExports();
      monotonic = message.monotonic;
      await journal.reserve(principal, message.attempt, digest, message.wallTime, 100, 0);
    } else if (message.action === 'reserve') {
      monotonic = message.monotonic;
      const result = await journal.reserve(principal, message.attempt, digest, message.wallTime, 100, 0);
      process.send({ request: message.request, result });
    }
  } catch (error) {
    process.send({ request: message.request, error: error instanceof Error ? error.message : 'unknown' });
  }
});
