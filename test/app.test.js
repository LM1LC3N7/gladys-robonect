// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and a fake Robonect module,
// with the exact wiring of the container (src/handlers.js) and a mocked clock.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { RobonectApp } from '../src/app.js';
import { DOCK_STATE, MINUTE, SECOND } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { memoryStore } from '../src/store.js';
import {
  HOST,
  ID,
  NOW,
  PASSWORD,
  USER,
  basic,
  fakeModule,
  settle,
} from './fixtures/fakeRobonect.js';

const CFG = { host: HOST, username: USER, password: PASSWORD };
const START_CFG = { ...CFG, allow_start: true };
const DEVICE = `ext:test-integration:robonect:${ID}`;
const feature = (role) => `${DEVICE}:${role}`;

async function setup(
  t,
  { config = CFG, server = fakeModule(), store = memoryStore(), create = true } = {},
) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: NOW });
  const gladys = createFakeGladys({ config });
  const logs = [];
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((l) => [
      l,
      (...a) => logs.push(`${l}: ${a.map((x) => (x instanceof Error ? x.message : x)).join(' ')}`),
    ]),
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
  const fire = (role, value = 1) => {
    const device = gladys.fake.devices.find((d) => d.external_id === DEVICE) ?? {
      external_id: DEVICE,
    };
    return gladys.fake.setValue(device, { external_id: feature(role) }, value);
  };
  const press = async (role, value = 1, wait = 5 * SECOND) => {
    const ack = fire(role, value);
    await advance(wait);
    return ack;
  };
  const state = (role) =>
    gladys.fake.states.findLast((s) => s.device_feature_external_id === feature(role));
  return { gladys, app, server, mower: server.mower, advance, logs, fire, press, store, state };
}

test('discovery: one device keyed by the module id, states published', async (t) => {
  const ctx = await setup(t);
  const [device] = ctx.gladys.fake.discoveredDevices;
  assert.equal(device.external_id, DEVICE);
  assert.equal(device.name, 'Robi');
  const types = device.features.map((f) => `${f.category}/${f.type}`);
  assert.ok(!types.some((t) => t.startsWith('switch/')), 'never a switch');
  for (const f of device.features.filter((f) => !f.read_only)) {
    assert.ok(
      (f.category === 'button' && f.type === 'push') ||
        (f.category === 'vacuum-cleaner' && f.type === 'dock'),
      `${f.external_id} is writable`,
    );
  }
  await ctx.advance(2 * SECOND);
  assert.equal(ctx.state('battery').state, 85);
  assert.equal(ctx.state('state').state, DOCK_STATE.CHARGING);
  assert.equal(ctx.state('status').text, 'En charge');
  assert.equal(ctx.state('charging').state, 1);
  assert.equal(ctx.state('connected').state, 1);
  assert.equal(ctx.gladys.fake.connectionStatus.connected, true);
  const badge = ctx.gladys.fake.transports.at(-1);
  assert.equal(badge.device_external_id ?? badge.external_id, DEVICE);
  assert.equal(badge.transport, DEVICE_TRANSPORTS.LOCAL);
});

test('the start is off by default: refused, nothing sent', async (t) => {
  const ctx = await setup(t);
  ctx.mower.status.status.stopped = true;
  const ack = await ctx.press('start');
  assert.equal(ack.success, false);
  assert.match(String(ack.error), /Autoriser le démarrage/);
  assert.deepEqual(ctx.server.commands(), []);
});

test('the start: decided on a fresh read, sent only when the mower is stopped', async (t) => {
  const ctx = await setup(t, { config: START_CFG });
  // Not stopped: nothing to lift, nothing sent, and never a success (review 1, M7).
  const first = await ctx.press('start');
  assert.equal(first.success, false);
  assert.match(String(first.error), /rien à lever/);
  assert.deepEqual(ctx.server.commands(), []);
  ctx.mower.status.status.stopped = true;
  const reads = ctx.server.reads();
  const second = await ctx.press('start');
  assert.equal(second.success, true);
  assert.deepEqual(ctx.server.commands(), ['start']);
  assert.ok(ctx.server.reads() > reads, 'a fresh read before');
  assert.equal(ctx.mower.status.status.stopped, false);
});

test('the start is refused on an error, a missing value, or another module', async (t) => {
  const ctx = await setup(t, { config: START_CFG });
  ctx.mower.status.status.stopped = true;
  ctx.mower.status.status.status = 7;
  assert.equal((await ctx.press('start')).success, false);
  ctx.mower.status.status.status = 1;
  delete ctx.mower.status.status.battery;
  assert.equal((await ctx.press('start')).success, false);
  ctx.mower.status.status.battery = 50;
  ctx.mower.status.id = 'ffff0000';
  const other = await ctx.press('start');
  assert.equal(other.success, false);
  assert.deepEqual(ctx.server.commands(), []);
});

test('the start: the option turned off during the fresh read refuses it', async (t) => {
  const ctx = await setup(t, { config: START_CFG });
  ctx.mower.status.status.stopped = true;
  ctx.mower.delays.status = 1000;
  const ack = ctx.fire('start');
  await ctx.advance(300);
  await ctx.gladys.fake.configUpdated({ ...START_CFG, allow_start: false });
  await ctx.advance(5 * SECOND);
  assert.equal((await ack).success, false);
  assert.deepEqual(ctx.server.commands(), []);
});

test('the start: a fresh read too slow refuses it unsent', async (t) => {
  const ctx = await setup(t, { config: START_CFG });
  ctx.mower.status.status.stopped = true;
  ctx.mower.delays.status = 2500;
  const ack = await ctx.press('start');
  assert.equal(ack.success, false);
  assert.deepEqual(ctx.server.commands(), []);
});

test('pause and back to the base: never held back by the option', async (t) => {
  const ctx = await setup(t);
  assert.equal((await ctx.press('pause')).success, true);
  assert.equal((await ctx.press('home')).success, true);
  assert.equal((await ctx.press('dock')).success, true);
  assert.deepEqual(ctx.server.commands(), ['stop', 'mode:home', 'mode:home']);
  assert.equal(ctx.mower.status.status.stopped, true);
  assert.equal(ctx.mower.status.status.mode, 2);
});

test('a pause cancels a start not sent yet', async (t) => {
  const ctx = await setup(t, { config: START_CFG });
  ctx.mower.status.status.stopped = true;
  ctx.mower.delays.status = 1000;
  const start = ctx.fire('start');
  await ctx.advance(200);
  const pause = ctx.fire('pause');
  await ctx.advance(6 * SECOND);
  assert.equal((await start).success, false);
  assert.equal((await pause).success, true);
  assert.deepEqual(ctx.server.commands(), ['stop']);
});

test('a pause during a 429 pause still goes (one request)', async (t) => {
  const ctx = await setup(t);
  ctx.mower.statuses.status = 429;
  ctx.mower.headers = { 'retry-after': '600' };
  await ctx.advance(61 * SECOND);
  assert.equal(ctx.gladys.fake.connectionStatus.connected, false);
  const reads = ctx.server.reads();
  assert.equal((await ctx.press('pause')).success, true);
  assert.deepEqual(ctx.server.commands(), ['stop']);
  assert.equal(ctx.server.reads(), reads, 'no read during the pause');
  assert.ok(ctx.store.data.pause.until > Date.now(), 'the pause is kept in /data');
});

test('a start sent without confirmation, then a pause: reaffirmed when the start lands late', async (t) => {
  const ctx = await setup(t, { config: START_CFG });
  ctx.mower.status.status.stopped = true;
  // The start lands after 6 s and is never answered in time.
  ctx.mower.answerAfter.start = 60_000;
  ctx.mower.applyAfter.start = 6000;
  const start = ctx.fire('start');
  await ctx.advance(5 * SECOND);
  const ack = await start;
  assert.equal(ack.success, false);
  assert.match(String(ack.error), /sans confirmation/);
  // Pause pressed before the start landed: the start lifts the stop after it.
  assert.equal((await ctx.press('pause', 1, 2 * SECOND)).success, true);
  await ctx.advance(60 * SECOND);
  const commands = ctx.server.commands();
  assert.equal(commands.filter((c) => c === 'stop').length >= 2, true, commands.join(','));
  assert.equal(ctx.mower.status.status.stopped, true, 'the mower ends stopped');
});

test('a pause that overtook a start in flight is sent again when the start settles', async (t) => {
  const ctx = await setup(t, { config: START_CFG });
  ctx.mower.status.status.stopped = true;
  // The start lands at 2.9 s and is answered at 3 s, after the pause.
  ctx.mower.applyAfter.start = 2900;
  ctx.mower.answerAfter.start = 3000;
  const start = ctx.fire('start');
  await ctx.advance(500);
  const pause = ctx.fire('pause');
  await ctx.advance(10 * SECOND);
  assert.equal((await start).success, true);
  assert.equal((await pause).success, true);
  assert.deepEqual(ctx.server.commands(), ['start', 'stop', 'stop']);
  assert.equal(ctx.mower.status.status.stopped, true, 'the mower ends stopped');
});

test('after a restart: no read sooner than the interval, the pause goes before the first read', async (t) => {
  const store = memoryStore({
    lastAttemptAt: NOW - 10 * SECOND,
    mower: { address: HOST, id: ID },
  });
  const ctx = await setup(t, { store, create: false });
  await ctx.gladys.fake.deviceCreated({ external_id: DEVICE, features: [] });
  ctx.gladys.fake.devices.push({ external_id: DEVICE, name: 'Robi', features: [] });
  assert.equal(ctx.server.reads(), 0, 'no read at the start');
  const pause = await ctx.press('pause', 1, 2 * SECOND);
  assert.equal(pause.success, true);
  assert.deepEqual(ctx.server.commands(), ['stop']);
  assert.equal(ctx.server.reads(), 0, 'one request, no read');
  const start = await ctx.press('start', 1, 2 * SECOND);
  assert.equal(start.success, false, 'the start waits for a read');
  await ctx.advance(2 * MINUTE);
  assert.ok(ctx.server.reads() >= 1);
});

test('no read sooner than the interval: test button, scan, reconnection, unchanged config', async (t) => {
  const ctx = await setup(t);
  const reads = ctx.server.reads();
  assert.equal(reads, 1);
  await ctx.gladys.fake.action('test_connection', {});
  await ctx.gladys.fake.scanRequest();
  await ctx.gladys.fake.configUpdated({ ...CFG });
  await ctx.app.connected({ ...CFG });
  await ctx.advance(30 * SECOND);
  assert.equal(ctx.server.reads(), reads);
  await ctx.advance(31 * SECOND);
  assert.equal(ctx.server.reads(), reads + 1, 'the next read at the interval');
});

test('refused credentials: block kept in /data, no secret stored; other credentials lift it after a restart', async (t) => {
  const server = fakeModule({ password: 'other' });
  const store = memoryStore();
  const ctx = await setup(t, { server, store });
  assert.equal(ctx.gladys.fake.connectionStatus.connected, false);
  const saved = JSON.stringify(store.data);
  assert.ok(store.data.block.until > Date.now());
  assert.ok(!saved.includes(PASSWORD), 'no password in /data');
  assert.ok(!saved.includes(basic(USER, PASSWORD).slice(6)), 'no encoded password in /data');
  await ctx.advance(5 * MINUTE);
  assert.equal(server.reads(), 1, 'no new try before 15 min');
  // The same refused credentials after a restart: still blocked.
  const again = new RobonectApp({
    gladys: ctx.gladys,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    transport: server.transport,
    now: () => Date.now(),
    store,
  });
  t.after(() => again.stop());
  await again.start(CFG);
  assert.equal(server.reads(), 1);
  // Other credentials: the block goes at once.
  server.mower.password = 'new one';
  await again.start({ ...CFG, password: 'new one' });
  assert.equal(store.data.block, null);
});

test('the password never appears in the logs', async (t) => {
  const server = fakeModule();
  const ctx = await setup(t, { config: START_CFG, server });
  ctx.mower.statuses.stop = 500;
  await ctx.press('pause');
  server.mower.password = 'changed';
  await ctx.advance(2 * MINUTE);
  const text = ctx.logs.join('\n');
  assert.ok(!text.includes(PASSWORD));
  assert.ok(!text.includes(basic(USER, PASSWORD).slice(6)));
});

test('another module at the address: the old device shown unreachable, commands refused', async (t) => {
  const ctx = await setup(t, { config: START_CFG });
  ctx.mower.status.id = 'beef0001';
  await ctx.advance(61 * SECOND);
  const badge = ctx.gladys.fake.transports.at(-1);
  assert.equal(badge.device_external_id ?? badge.external_id, DEVICE);
  assert.equal(badge.transport, 'unreachable');
  assert.match(JSON.stringify(ctx.gladys.fake.connectionStatus), /Plus lue/);
  const ack = await ctx.press('pause');
  assert.equal(ack.success, false);
  assert.deepEqual(ctx.server.commands(), []);
});

test('a late read of an old configuration publishes nothing', async (t) => {
  const server = fakeModule();
  const ctx = await setup(t, { server, create: false });
  server.mower.delays.status = 3000;
  server.mower.status.name = 'Late';
  // The next polling read starts at 60 s and answers at 63 s.
  await ctx.advance(60 * SECOND + 500);
  const reads = server.reads();
  const saved = ctx.gladys.fake.configUpdated({ ...CFG, host: '192.168.1.71' });
  server.mower.down = true;
  await ctx.advance(5 * SECOND);
  await saved;
  assert.ok(server.reads() >= reads);
  const published = JSON.stringify([
    ctx.gladys.fake.discoveredDevices,
    ctx.gladys.fake.connectionStatuses,
  ]);
  assert.doesNotMatch(published, /Late/);
});

test('a 5xx pauses the reads, kept in /data', async (t) => {
  const ctx = await setup(t);
  ctx.mower.statuses.status = 503;
  await ctx.advance(61 * SECOND);
  assert.equal(ctx.store.data.pause.reason, '5xx');
  const reads = ctx.server.reads();
  await ctx.advance(30 * SECOND);
  assert.equal(ctx.server.reads(), reads);
});

test('a button only accepts 1; read-only features refuse', async (t) => {
  const ctx = await setup(t);
  for (const value of [0, '', null, true, 'on', 2]) {
    assert.equal((await ctx.press('pause', value, 200)).success, false, String(value));
  }
  assert.equal((await ctx.press('battery', 1, 200)).success, false);
  assert.deepEqual(ctx.server.commands(), []);
});
