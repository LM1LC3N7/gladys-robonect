// -----------------------------------------------------------------------------
// A fake Robonect module behind the transport the integration is given: the
// status answer shaped like the paths aiorobonect and the Home Assistant
// integration read (values made up, never captured from a real module), the
// Basic authentication checked, and the start / stop / mode commands, which
// change the mower like they are expected to. Records every request. No
// network. Delays use setTimeout, so the mocked clock drives them.
// -----------------------------------------------------------------------------

import { RobonectError, ERROR_KINDS } from '../../src/robonect/http.js';

export const HOST = '192.168.1.70';
export const USER = 'admin';
export const PASSWORD = 'correct horse';
export const ID = 'a1b2c3d4e5';
export const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);

/** Charging at the base, mode Auto, not stopped. */
export const statusBody = (over = {}) => ({
  successful: true,
  name: 'Robi',
  id: 'A1B2C3D4E5',
  status: {
    status: 4,
    stopped: false,
    duration: 1800,
    mode: 0,
    battery: 85,
    hours: 1234,
    distance: 0,
    ...(over.status ?? {}),
  },
  timer: { status: 2, next: { date: '21.10.26', time: '14:00:00', unix: 1_792_591_200 } },
  blades: { quality: 72, hours: 120, days: 30 },
  wlan: { signal: -61 },
  health: { temperature: 21, humidity: 48 },
  clock: { date: '21.10.26', time: '12:00:00', unix: 1_792_584_000 },
  ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'status')),
});

const answer = (status, body = '', headers = {}) => ({
  status,
  headers,
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const basic = (user, password) =>
  `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

/**
 * The module. The test may set: `down` (nothing answers), `silent`
 * (connected, no answer), `delays` (ms, by command), `statuses` (HTTP status
 * by command), `refuse` (commands answered successful:false), `applies`
 * (false: commands change nothing), `applyAfter` (ms, by command: lands later),
 * `answerAfter` (ms, by command), `body` (raw status answer).
 */
export function fakeModule(over = {}) {
  const mower = {
    user: USER,
    password: PASSWORD,
    status: statusBody(),
    delays: {},
    statuses: {},
    headers: {},
    applyAfter: {},
    answerAfter: {},
    refuse: false,
    applies: true,
    ...over,
  };
  const apply = (cmd) => {
    if (!mower.applies) return;
    const s = mower.status.status;
    if (cmd === 'start') s.stopped = false;
    if (cmd === 'stop') s.stopped = true;
    if (cmd === 'mode') s.mode = 2;
  };
  const server = {
    mower,
    requests: [],
    commands: () =>
      server.requests
        .map((r) => /cmd=([a-z]+)(?:&mode=([a-z]+))?/.exec(r.path))
        .filter((m) => m && m[1] !== 'status')
        .map((m) => (m[2] ? `${m[1]}:${m[2]}` : m[1])),
    reads: () => server.requests.filter((r) => r.path === '/json?cmd=status').length,
    async transport(request) {
      const { path, headers = {}, timeoutMs, startBy = Infinity, now = Date.now } = request;
      server.requests.push(request);
      if (mower.down) {
        throw new RobonectError(ERROR_KINDS.UNREACHABLE, 'Unreachable: ECONNREFUSED');
      }
      const cmd = /cmd=([a-z]+)/.exec(path)?.[1];
      if (now() > startBy) {
        throw new RobonectError(ERROR_KINDS.LATE, 'Too late to send');
      }
      if (cmd !== 'status') {
        const answerAfter = mower.answerAfter[cmd] ?? 0;
        const applyAfter = mower.applyAfter[cmd] ?? 0;
        const authorized = headers.Authorization === basic(mower.user, mower.password);
        if (authorized && !mower.refuse && !mower.statuses[cmd]) {
          if (applyAfter > 0) setTimeout(() => apply(cmd), applyAfter);
          else apply(cmd);
        }
        if (answerAfter >= timeoutMs || mower.silent) {
          await wait(timeoutMs);
          throw new RobonectError(ERROR_KINDS.TIMEOUT, 'Connected but silent: timeout');
        }
        if (answerAfter) await wait(answerAfter);
        if (mower.statuses[cmd]) return answer(mower.statuses[cmd], 'error', mower.headers);
        if (!authorized) return answer(401, 'Unauthorized');
        return answer(
          200,
          mower.refuse
            ? { successful: false, error_code: 7, error_message: 'Not possible' }
            : { successful: true },
        );
      }
      const delay = mower.delays.status ?? 0;
      if (mower.silent || delay >= timeoutMs) {
        await wait(timeoutMs);
        throw new RobonectError(ERROR_KINDS.TIMEOUT, 'Connected but silent: timeout');
      }
      if (delay) await wait(delay);
      if (mower.statuses.status) return answer(mower.statuses.status, 'error', mower.headers);
      if (headers.Authorization !== basic(mower.user, mower.password)) {
        return answer(401, 'Unauthorized');
      }
      return answer(200, mower.body ?? mower.status);
    },
  };
  return server;
}

export const settle = async (rounds = 20) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
