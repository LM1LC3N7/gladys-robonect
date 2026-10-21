// -----------------------------------------------------------------------------
// The Robonect client: strict parsing of hostile answers, the command
// outcomes, and the HTTP transport against a real local server (deadline
// checked once connected, bounded answer, the password never in an error).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { RobonectClient, authHeaders, idOf, parseStatus, text } from '../src/robonect/client.js';
import { ERROR_KINDS, request } from '../src/robonect/http.js';
import { statusBody } from './fixtures/fakeRobonect.js';

test('parseStatus reads the fields the integration uses', () => {
  const s = parseStatus(statusBody({ error: { error_code: 15, error_message: 'Lifted' } }));
  assert.equal(s.id, 'a1b2c3d4e5');
  assert.equal(s.name, 'Robi');
  assert.equal(s.code, 4);
  assert.equal(s.stopped, false);
  assert.equal(s.mode, 0);
  assert.equal(s.battery, 85);
  assert.equal(s.wifi, -61);
  assert.equal(s.blades, 72);
  assert.deepEqual(s.error, { code: 15, message: 'Lifted' });
});

test('parseStatus: a mistyped or missing value is undefined, never a default', () => {
  const s = parseStatus({
    successful: true,
    id: 42,
    status: { status: '2', stopped: 'false', battery: 101, mode: null },
  });
  assert.equal(s.id, undefined);
  assert.equal(s.code, undefined);
  assert.equal(s.stopped, undefined);
  assert.equal(s.battery, undefined);
  assert.equal(s.mode, undefined);
  assert.throws(() => parseStatus({ successful: false }), { kind: ERROR_KINDS.PROTOCOL });
  assert.throws(() => parseStatus([]), { kind: ERROR_KINDS.PROTOCOL });
});

test('parseStatus never reads through a prototype', () => {
  const hostile = JSON.parse(
    '{"successful":true,"__proto__":{"id":"evil"},"status":{"__proto__":{"stopped":false}}}',
  );
  const s = parseStatus(hostile);
  assert.equal(s.id, undefined);
  assert.equal(s.stopped, undefined);
  assert.equal({}.id, undefined, 'Object.prototype untouched');
});

test('texts and ids are bounded and cleaned', () => {
  assert.equal(text('a\u0000b\u0007c'), 'abc');
  assert.equal(text('x'.repeat(500)).length, 80);
  assert.equal(idOf(' AB-12 '), 'ab-12');
  assert.equal(idOf('a/b'), undefined);
  assert.equal(idOf('x'.repeat(65)), undefined);
});

test('command: successful false is a refusal, never a success', async () => {
  const client = new RobonectClient({
    transport: async () => ({
      status: 200,
      headers: {},
      body: '{"successful":false,"error_code":3,"error_message":"No"}',
    }),
  });
  await assert.rejects(
    client.command({ host: 'h', port: 80 }, undefined, 'start', {
      timeoutMs: 1000,
      startBy: Infinity,
    }),
    { kind: ERROR_KINDS.REFUSED, code: 3 },
  );
  await assert.rejects(
    client.command({ host: 'h', port: 80 }, undefined, 'status', { timeoutMs: 1, startBy: 0 }),
    (err) => err.notSent === true,
  );
});

test('the Basic header carries the credentials, an error never does', async () => {
  const auth = { user: 'admin', password: 's3cret pass' };
  const header = authHeaders(auth).Authorization;
  assert.equal(header, `Basic ${Buffer.from('admin:s3cret pass').toString('base64')}`);
  const client = new RobonectClient({
    transport: async () => ({ status: 401, headers: {}, body: 's3cret pass' }),
  });
  const err = await client
    .status({ host: 'h', port: 80 }, auth, { timeoutMs: 1000 })
    .catch((e) => e);
  assert.equal(err.kind, ERROR_KINDS.AUTH);
  assert.doesNotMatch(`${err.message} ${JSON.stringify(err)}`, /s3cret|YWRtaW4/);
});

/** A local TCP server that records what it receives and answers with `reply`. */
async function server(t, reply) {
  const received = [];
  const srv = createServer((socket) => {
    let data = '';
    socket.on('data', (chunk) => {
      data += chunk;
      if (data.includes('\r\n\r\n')) {
        received.push(data);
        reply(socket);
      }
    });
    socket.on('error', () => {});
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => srv.close());
  return { port: srv.address().port, received };
}

test('http: a deadline passed once connected writes nothing (LATE)', async (t) => {
  const s = await server(t, (socket) => socket.end('HTTP/1.1 200 OK\r\n\r\n{}'));
  const err = await request({
    host: '127.0.0.1',
    port: s.port,
    path: '/json?cmd=start',
    timeoutMs: 2000,
    startBy: 1000,
    // Checked once connected: too late by then.
    now: () => 2000,
  }).catch((e) => e);
  assert.equal(err.kind, ERROR_KINDS.LATE);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(s.received.length, 0, 'nothing reached the server');
});

test('http: an answer is read once, bounded in size', async (t) => {
  const ok = await server(t, (socket) =>
    socket.end('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{"successful":true}'),
  );
  const res = await request({ host: '127.0.0.1', port: ok.port, path: '/json?cmd=status' });
  assert.equal(res.status, 200);
  assert.equal(res.body, '{"successful":true}');
  assert.match(ok.received[0], /^GET \/json\?cmd=status HTTP\/1\.1/);
  const big = await server(t, (socket) => {
    socket.write('HTTP/1.1 200 OK\r\n\r\n');
    socket.end('x'.repeat(100 * 1024));
  });
  const err = await request({ host: '127.0.0.1', port: big.port, path: '/' }).catch((e) => e);
  assert.equal(err.kind, ERROR_KINDS.PROTOCOL);
});

test('http: silent after the request is a timeout (may have been received)', async (t) => {
  const s = await server(t, () => {});
  const err = await request({
    host: '127.0.0.1',
    port: s.port,
    path: '/json?cmd=stop',
    timeoutMs: 300,
  }).catch((e) => e);
  assert.equal(err.kind, ERROR_KINDS.TIMEOUT);
});

test('http: nothing listening is unreachable (nothing sent)', async () => {
  const closed = createServer();
  await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const free = closed.address().port;
  await new Promise((resolve) => closed.close(resolve));
  const err = await request({ host: '127.0.0.1', port: free, path: '/', timeoutMs: 2000 }).catch(
    (e) => e,
  );
  assert.equal(err.kind, ERROR_KINDS.UNREACHABLE);
});
