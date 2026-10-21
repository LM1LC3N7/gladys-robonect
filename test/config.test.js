// -----------------------------------------------------------------------------
// The configuration, the persisted state and the publisher budget.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseAddress, refusedFingerprint, usable } from '../src/config.js';
import { HOUR, MINUTE } from '../src/constants.js';
import { StatePublisher } from '../src/publisher.js';
import { normalizeMemory } from '../src/store.js';

test('addresses: IPv4 or host name, optional port; a pasted URL is reduced', () => {
  assert.deepEqual(parseAddress('192.168.1.70'), { host: '192.168.1.70', port: 80 });
  assert.deepEqual(parseAddress('http://robonect.local:8080/json'), {
    host: 'robonect.local',
    port: 8080,
  });
  assert.equal(parseAddress('999.1.1.1'), undefined);
  assert.equal(parseAddress('a b'), undefined);
});

test('credentials: both or neither; never in the address', () => {
  const full = normalizeConfig({ host: '1.2.3.4', username: 'admin', password: 'pw' });
  assert.deepEqual(full.auth, { user: 'admin', password: 'pw' });
  assert.ok(usable(full));
  const none = normalizeConfig({ host: '1.2.3.4' });
  assert.equal(none.auth, undefined);
  assert.ok(usable(none));
  const half = normalizeConfig({ host: '1.2.3.4', password: 'pw' });
  assert.equal(half.authMissing, true);
  assert.ok(!usable(half));
  const colon = normalizeConfig({ host: '1.2.3.4', username: 'a:b', password: 'pw' });
  assert.ok(!usable(colon));
  const inHost = normalizeConfig({ host: 'http://admin:pw@1.2.3.4' });
  assert.equal(inHost.credentialsInHost, true);
  assert.equal(inHost.address, undefined);
  assert.equal(inHost.invalidHost, undefined, 'never shown back');
});

test('the start is allowed only by true', () => {
  for (const value of [undefined, null, 'yes', 1, 'on', false, 'false']) {
    assert.equal(normalizeConfig({ allow_start: value }).allowStart, false, String(value));
  }
  assert.equal(normalizeConfig({ allow_start: true }).allowStart, true);
  assert.equal(normalizeConfig({ allow_start: 'true' }).allowStart, true);
});

test('the interval is bounded', () => {
  assert.equal(normalizeConfig({ poll_interval: 1 }).pollInterval, 30);
  assert.equal(normalizeConfig({ poll_interval: 99999 }).pollInterval, 3600);
  assert.equal(normalizeConfig({ poll_interval: '' }).pollInterval, 60);
});

test('the refused fingerprint: salted, never the password itself', () => {
  const config = normalizeConfig({ host: '1.2.3.4', username: 'admin', password: 'pw' });
  const a = refusedFingerprint(config, '0'.repeat(32));
  const b = refusedFingerprint(config, '1'.repeat(32));
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
  assert.ok(!a.includes('pw'));
});

test('the persisted state is repaired and bounded', () => {
  const now = Date.UTC(2026, 9, 21);
  const memory = normalizeMemory(
    {
      pause: { until: now + 100 * HOUR, reason: 'x' },
      block: { until: now + 100 * HOUR, failures: -3, salt: 'zz' },
      mower: { address: '1.2.3.4', id: 'BAD ID' },
      lastAttemptAt: now + HOUR,
    },
    now,
  );
  assert.equal(memory.pause.until, now + 6 * HOUR);
  assert.equal(memory.pause.reason, '429');
  assert.equal(memory.block, null, 'a block without a valid salt is dropped');
  assert.equal(memory.mower, null);
  assert.equal(memory.lastAttemptAt, now);
  assert.deepEqual(normalizeMemory('garbage', now), {
    pause: null,
    block: null,
    mower: null,
    lastAttemptAt: null,
  });
});

test('the publisher never exceeds 300 states a minute, even with concurrent flushes', async () => {
  let now = 0;
  const sent = [];
  const gladys = {
    publishChangedStates: async (batch) => {
      sent.push(...batch);
      await new Promise((resolve) => setImmediate(resolve));
      return { count: batch.length };
    },
  };
  const publisher = new StatePublisher({ gladys, logger: console, now: () => now });
  for (let i = 0; i < 1000; i += 1) {
    publisher.push(`f${i}`, { state: i });
  }
  await Promise.all([publisher.flush(), publisher.flush(), publisher.flush()]);
  for (let i = 0; i < 5; i += 1) {
    await publisher.flush();
  }
  assert.equal(sent.length, 300);
  now += MINUTE;
  await publisher.flush();
  assert.equal(sent.length, 400);
});
