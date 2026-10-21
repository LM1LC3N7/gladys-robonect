// -----------------------------------------------------------------------------
// What must survive a restart, in /data (the only writable place of the
// container):
//   - the end of a pause (429, or a 5xx), and the block after a user name or
//     a password refused, so a restart never asks the module again before its
//     time and never loops on refused credentials;
//   - the time of the last read (written at most once a minute), so a
//     restart never reads the module sooner than the interval;
//   - the id of the mower last read at the address, so "Pause" and "Back to
//     the base" are never refused before the first read after a restart.
// NO SECRET: neither the user name nor the password. The only thing derived
// from credentials is the salted fingerprint of credentials the module
// REFUSED (src/config.js), erased at the first accepted read. The file is
// readable by the container user only (0600). Bounded when read back.
// -----------------------------------------------------------------------------

import { readFile, rename, writeFile } from 'node:fs/promises';
import { TIMINGS } from './constants.js';
import { idOf } from './robonect/client.js';

export const STATE_FILE = '/data/robonect-state.json';

export function fileStore(path = STATE_FILE) {
  // One write at a time: two saves never share the temporary file.
  let chain = Promise.resolve();
  return {
    async load() {
      try {
        const text = await readFile(path, 'utf8');
        return text.length > 16 * 1024 ? null : JSON.parse(text);
      } catch {
        return null;
      }
    },
    save(data) {
      const text = JSON.stringify(data);
      const write = chain.then(async () => {
        const temporary = `${path}.tmp`;
        await writeFile(temporary, text, { mode: 0o600 });
        await rename(temporary, path);
      });
      chain = write.catch(() => {});
      return write;
    },
  };
}

/** For the tests: the same JSON round trip as the file. */
export function memoryStore(initial = null) {
  return {
    data: initial === null ? null : JSON.parse(JSON.stringify(initial)),
    saves: 0,
    async load() {
      return this.data === null ? null : JSON.parse(JSON.stringify(this.data));
    },
    async save(data) {
      this.data = JSON.parse(JSON.stringify(data));
      this.saves += 1;
    },
  };
}

const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const HEX = /^[0-9a-f]{32,64}$/;
const place = (value) =>
  typeof value.address === 'string' && value.address.length > 0 && value.address.length <= 300;
/** A text read back from /data: bounded, without control characters, else undefined. */
const cleanText = (value) =>
  // eslint-disable-next-line no-control-regex
  typeof value === 'string' && value.length <= 300 && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : undefined;

/**
 * The persisted state, repaired and bounded:
 * `{ pause: { until, reason } | null, block: { until, failures, salt, refused } | null,
 *   mower: { address, id } | null, serial: { address, id } | null,
 *   lastAttemptAt: number | null, lastGood: { address, at, summary: { en, fr } } | null }`.
 */
export function normalizeMemory(raw, now) {
  const data = object(raw);
  const pause = object(data.pause);
  const block = object(data.block);
  const mower = object(data.mower);
  const serial = object(data.serial);
  const good = object(data.lastGood);
  const summary = object(good.summary);
  const failures = Number.isInteger(block.failures) && block.failures > 0 ? block.failures : 1;
  return {
    pause:
      Number.isFinite(pause.until) && pause.until > now
        ? {
            until: Math.min(pause.until, now + TIMINGS.rateLimitMax),
            reason: pause.reason === '5xx' ? '5xx' : '429',
          }
        : null,
    block:
      Number.isFinite(block.until) && typeof block.salt === 'string' && HEX.test(block.salt)
        ? {
            // An expired block is kept (its count spaces the next tries) but no longer waits.
            until: Math.min(block.until, now + TIMINGS.authBackoff.at(-1)),
            failures: Math.min(failures, 100),
            salt: block.salt,
            refused:
              typeof block.refused === 'string' && HEX.test(block.refused) ? block.refused : null,
          }
        : null,
    mower:
      typeof mower.address === 'string' &&
      mower.address.length > 0 &&
      mower.address.length <= 300 &&
      idOf(mower.id) === mower.id
        ? { address: mower.address, id: mower.id }
        : null,
    // The serial read with cmd=version at an address whose status has no id.
    serial:
      place(serial) && idOf(serial.id) === serial.id
        ? { address: serial.address, id: serial.id }
        : null,
    // The summary of the last good read (shown "connected" while the first read after a restart waits).
    lastGood:
      place(good) && Number.isFinite(good.at) && cleanText(summary.en) && cleanText(summary.fr)
        ? {
            address: good.address,
            at: Math.min(good.at, now),
            summary: { en: cleanText(summary.en), fr: cleanText(summary.fr) },
          }
        : null,
    // A time in the future (a clock set back) counts as now: never a longer wait than the interval.
    lastAttemptAt: Number.isFinite(data.lastAttemptAt) ? Math.min(data.lastAttemptAt, now) : null,
  };
}
