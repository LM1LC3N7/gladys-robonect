// -----------------------------------------------------------------------------
// The points of review 1 (I1, I2, M1-M9), one test each (or more), against the
// SDK's fake Gladys and the fake module, with the exact wiring of the
// container and a mocked clock.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { RobonectApp } from '../src/app.js';
import { HOUR, MINUTE, SECOND } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { memoryStore } from '../src/store.js';
import {
  HOST,
  ID,
  NOW,
  PASSWORD,
  USER,
  fakeModule,
  settle,
  statusBody,
  versionReads,
} from './fixtures/fakeRobonect.js';

const CFG = { host: HOST, username: USER, password: PASSWORD };
const START_CFG = { ...CFG, allow_start: true };
const deviceOf = (id) => `ext:test-integration:robonect:${id}`;
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

async function setup(
  t,
  { config = CFG, server = fakeModule(), store = memoryStore(), create = true } = {},
) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: NOW });
  const gladys = createFakeGladys({ config });
  const logs = [];
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((l) => [l, (...a) => logs.push(`${l}: ${a.join(' ')}`)]),
  );
  const app = new RobonectApp({
    gladys,
    logger,
    transport: server.transport,
    now: () => Date.now(),
    store,
  });
  registerHandlers(gladys, app, logger);
  await gladys.connect();
  await settle();
  t.after(() => app.stop());
  const advance = async (ms, step = 100) => {
    for (let e = 0; e < ms; e += step) {
      t.mock.timers.tick(Math.min(step, ms - e));
      await settle(5);
    }
  };
  if (create && gladys.fake.discoveredDevices.length > 0) {
    await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[0]);
    await settle();
  }
  const device = () => gladys.fake.discoveredDevices[0]?.external_id ?? deviceOf(ID);
  const fire = (role, value = 1) =>
    gladys.fake.setValue({ external_id: device() }, { external_id: `${device()}:${role}` }, value);
  const press = async (role, value = 1, wait = 5 * SECOND) => {
    const ack = fire(role, value);
    await advance(wait);
    return ack;
  };
  return { gladys, app, server, mower: server.mower, advance, logs, fire, press, store, device };
}

test('I1: the start only on statuses 1, 2, 3, 4, 5, 17, 18; 98, 99 and unknown codes refuse', async (t) => {
  const ctx = await setup(t, { config: START_CFG });
  ctx.mower.status.status.stopped = true;
  for (const code of [0, 6, 7, 8, 16, 42, 98, 99]) {
    ctx.mower.status.status.status = code;
    const ack = await ctx.press('start');
    assert.equal(ack.success, false, `status ${code}`);
  }
  assert.deepEqual(ctx.server.commands(), []);
  ctx.mower.status.status.status = 18;
  assert.equal((await ctx.press('start')).success, true);
  assert.deepEqual(ctx.server.commands(), ['start']);
  const constants = read('src/constants.js');
  assert.match(constants, /OFFLINE_NO_BIND: 98/);
  assert.match(constants, /UNKNOWN: 99/);
  assert.match(read('src/i18n.js'), /STATUS\.OFFLINE_NO_BIND\]/);
});

test('I2: an id given as a MAC keys the device without ":"', async (t) => {
  const server = fakeModule({ status: statusBody({ id: '00:1A:2B:3C:4D:5E' }) });
  const ctx = await setup(t, { server });
  assert.equal(ctx.gladys.fake.discoveredDevices[0].external_id, deviceOf('001a2b3c4d5e'));
});

test('I2: a status without id: the serial of cmd=version, read once, kept in /data', async (t) => {
  const body = statusBody();
  delete body.id;
  const server = fakeModule({ status: body, serial: 'RN-0042-77' });
  const ctx = await setup(t, { server, config: START_CFG });
  assert.equal(ctx.gladys.fake.discoveredDevices[0].external_id, deviceOf('rn004277'));
  assert.deepEqual(ctx.store.data.serial, { address: HOST, id: 'rn004277' });
  await ctx.advance(3 * MINUTE);
  assert.equal(versionReads(server), 1, 'read once, not at every poll');
  // Pause and home go; the start checks the serial again first.
  assert.equal((await ctx.press('pause')).success, true);
  ctx.mower.status.status.stopped = true;
  assert.equal((await ctx.press('start')).success, true);
  assert.equal(versionReads(server), 2, 'read again before the start');
  // Another module (another serial) at the address: the start refuses.
  ctx.mower.status.status.stopped = true;
  server.mower.serial = 'OTHER-1';
  assert.equal((await ctx.press('start')).success, false);
  assert.deepEqual(ctx.server.commands(), ['stop', 'start']);
  for (const lang of ['en', 'fr']) {
    assert.match(read(`docs/${lang}.md`), /json\?cmd=status/);
  }
});

test('M1: a pause still goes when the configuration is saved during its fresh read', async (t) => {
  const ctx = await setup(t);
  await ctx.advance(30 * SECOND);
  ctx.mower.delays.status = 1000;
  const ack = ctx.fire('pause');
  await ctx.advance(300);
  ctx.mower.password = 'new password';
  const saved = ctx.gladys.fake.configUpdated({ ...CFG, password: 'new password' });
  await ctx.advance(5 * SECOND);
  await saved;
  assert.equal((await ack).success, true);
  assert.ok(ctx.server.commands().includes('stop'));
});

test('M2: a scene pressing pause every second never reads at every press', async (t) => {
  const ctx = await setup(t);
  const reads = ctx.server.reads();
  for (let i = 0; i < 60; i += 1) {
    ctx.fire('pause');
    await ctx.advance(SECOND);
  }
  await ctx.advance(5 * SECOND);
  assert.equal(ctx.server.commands().length, 60);
  assert.ok(ctx.server.reads() - reads <= 10, `${ctx.server.reads() - reads} reads`);
});

test('M3: a block kept without credentials goes once credentials are typed', async (t) => {
  const store = memoryStore({
    block: { until: NOW + 6 * HOUR, failures: 3, salt: '0'.repeat(32), refused: null },
  });
  const ctx = await setup(t, { store });
  assert.equal(ctx.server.reads(), 1, 'read at once');
  assert.equal(ctx.store.data.block, null);
});

test('M4: https:// is refused with a fixed message, nothing sent', async (t) => {
  const ctx = await setup(t, { config: { ...CFG, host: `https://${HOST}` } });
  await ctx.advance(2 * MINUTE);
  assert.equal(ctx.server.requests.length, 0);
  const status = ctx.gladys.fake.connectionStatus;
  assert.equal(status.connected, false);
  assert.match(JSON.stringify(status), /HTTPS/);
});

test('M5: a clock set back never stops the reads for more than the interval', async (t) => {
  const ctx = await setup(t);
  const reads = ctx.server.reads();
  ctx.app.lastAttemptAt = Date.now() + 5 * HOUR;
  ctx.app.schedule();
  await ctx.advance(61 * SECOND);
  assert.ok(ctx.server.reads() > reads);
});

test('M6: a start that never left keeps the time of the last start', async (t) => {
  const ctx = await setup(t, { config: START_CFG });
  ctx.mower.status.status.stopped = true;
  ctx.mower.unreachable = { start: true };
  const before = ctx.app.lastStartAt;
  const ack = await ctx.press('start');
  assert.equal(ack.success, false);
  assert.match(String(ack.error), /non envoyée/);
  assert.equal(ctx.app.lastStartAt, before);
});

test('M7: "Start" with nothing to lift (mode Home) is never a success', async (t) => {
  const ctx = await setup(t, { config: START_CFG });
  ctx.mower.status.status.mode = 2;
  const ack = await ctx.press('start');
  assert.equal(ack.success, false);
  assert.match(String(ack.error), /Maison/);
  assert.deepEqual(ctx.server.commands(), []);
});

test('M8: the error code comes only from the error object, never the status code', async (t) => {
  const ctx = await setup(t);
  const code = () => ctx.gladys.fake.lastState(`${ctx.device()}:error-code`);
  ctx.mower.status.status.status = 7;
  await ctx.advance(61 * SECOND);
  assert.notEqual(code(), 7);
  ctx.mower.status.error = { error_code: 15, error_message: 'Lifted' };
  await ctx.advance(61 * SECOND);
  assert.equal(code(), 15);
});

test('M9: after a restart, connected from the last good read kept, before the next read', async (t) => {
  const store = memoryStore({
    lastAttemptAt: NOW - 5 * SECOND,
    mower: { address: HOST, id: ID },
    lastGood: {
      address: HOST,
      at: NOW - 5 * SECOND,
      summary: { en: 'Robi: Charging.', fr: 'Robi : En charge.' },
    },
  });
  const ctx = await setup(t, { store, create: false });
  assert.equal(ctx.server.reads(), 0);
  const status = ctx.gladys.fake.connectionStatus;
  assert.equal(status.connected, true);
  assert.match(JSON.stringify(status), /En charge|Charging/);
});

// --- Review 2 (R-A, R-B, R-C) -----------------------------------------------------

const noIdModule = (over = {}) => {
  const body = statusBody();
  delete body.id;
  return fakeModule({ status: body, serial: 'RN-0042-77', ...over });
};

test('R-A (R3): cmd=version failed: tried again after 15 min (never sooner), then the mower is added', async (t) => {
  const server = noIdModule({ versionFails: ['timeout'] });
  const ctx = await setup(t, { server, create: false });
  await ctx.advance(15 * SECOND);
  assert.equal(ctx.gladys.fake.discoveredDevices.length, 0);
  assert.match(
    JSON.stringify(ctx.gladys.fake.connectionStatus),
    /numéro de série n'a pas pu être lu/,
  );
  assert.doesNotMatch(JSON.stringify(ctx.gladys.fake.connectionStatus), /ticket/);
  await ctx.advance(10 * MINUTE);
  assert.equal(versionReads(server), 1, 'no new try before 15 min');
  await ctx.advance(6 * MINUTE);
  assert.equal(versionReads(server), 2, 'one new try after 15 min');
  assert.equal(ctx.gladys.fake.discoveredDevices[0].external_id, deviceOf('rn004277'));
});

test('R-A: failures spaced 15 min, 1 h, then 6 h', async (t) => {
  const server = noIdModule({ versionFails: [500, 500, 500, 500] });
  const ctx = await setup(t, { server, create: false });
  await ctx.advance(16 * MINUTE, 1000);
  assert.equal(versionReads(server), 2);
  await ctx.advance(50 * MINUTE, 1000);
  assert.equal(versionReads(server), 2, 'the second wait is 1 h');
  await ctx.advance(12 * MINUTE, 1000);
  assert.equal(versionReads(server), 3);
});

test('R-A (R9): a 429 on cmd=version pauses the reads, kept in /data', async (t) => {
  const server = noIdModule({ versionFails: [429], headers: { 'retry-after': '600' } });
  const ctx = await setup(t, { server, create: false });
  assert.ok(ctx.store.data.pause.until > Date.now());
  assert.equal(ctx.store.data.pause.reason, '429');
  const reads = server.reads();
  await ctx.advance(5 * MINUTE, 1000);
  assert.equal(server.reads(), reads, 'no read during the pause');
});

test('R-B (R2): another serial before a start: forgotten, the next read identifies again', async (t) => {
  const server = noIdModule();
  const ctx = await setup(t, { server, config: START_CFG });
  const first = deviceOf('rn004277');
  assert.equal(ctx.gladys.fake.discoveredDevices[0].external_id, first);
  server.mower.serial = 'OTHER-1';
  ctx.mower.status.status.stopped = true;
  ctx.mower.status.name = 'Other';
  assert.equal((await ctx.press('start')).success, false);
  assert.equal(ctx.store.data.serial, null, 'forgotten in /data');
  await ctx.advance(61 * SECOND);
  assert.equal(ctx.gladys.fake.discoveredDevices[0].external_id, deviceOf('other1'));
  const badge = ctx.gladys.fake.transports.at(-1);
  assert.equal(badge.device_external_id ?? badge.external_id, first);
  assert.equal(badge.transport, 'unreachable', 'the first device is no longer read');
  assert.deepEqual(ctx.server.commands(), []);
});

test('R-C (R4): one write to /data per read at most, at most once a minute', async (t) => {
  const store = memoryStore();
  const ctx = await setup(t, { store });
  const saves = store.saves;
  await ctx.advance(10 * MINUTE, 1000);
  assert.ok(store.saves - saves <= 10, `${store.saves - saves} writes in 10 min`);
  assert.ok(store.data.lastGood, 'the last good read is written');
});

// --- Review 3 (M-1) -----------------------------------------------------------------

test('M-1 (R11): the time of a read is saved before it; a stop during the read keeps it', async (t) => {
  const server = fakeModule();
  const store = memoryStore();
  const config = { ...CFG, poll_interval: 3600 };
  const ctx = await setup(t, { server, store, config });
  await ctx.advance(3600 * SECOND - 1000, 10_000);
  server.mower.delays.status = 5000;
  // The read at 3600 s is in flight when the container stops.
  await ctx.advance(3 * SECOND);
  const readAt = Date.now() - 2000;
  assert.equal(store.data.lastAttemptAt, readAt, 'saved before the answer');
  ctx.app.stop();
  const again = new RobonectApp({
    gladys: ctx.gladys,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    transport: server.transport,
    now: () => Date.now(),
    store,
  });
  t.after(() => again.stop());
  server.mower.delays.status = 0;
  const reads = server.reads();
  await again.start(config);
  await ctx.advance(3500 * SECOND, 10_000);
  assert.equal(server.reads(), reads, 'no read sooner than the interval');
  await ctx.advance(200 * SECOND, 10_000);
  assert.ok(server.reads() > reads);
});
