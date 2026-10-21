// -----------------------------------------------------------------------------
// The Robonect JSON API, ported from aiorobonect 1.3.1 (MIT,
// geertmeersman/aiorobonect) and the field paths of the Robonect integration
// for Home Assistant (MIT, geertmeersman/robonect): `/json?cmd=<command>`
// with HTTP Basic authentication. Only plain HTTP: aiorobonect's fallback to
// HTTPS (which would send the password to a certificate nobody checked) is
// not kept. Reads are never retried here (the app spaces its new tries); a
// command is never retried at all (it may have reached the module).
//
// The answers come from the network: only own fields of plain objects are
// read, each with its exact type (a missing or mistyped value is undefined,
// never a default, so that a command is refused rather than decided on a
// guess). JSON.parse keeps `__proto__` as a plain own key: it never reaches a
// prototype, and it is never read.
// -----------------------------------------------------------------------------

import { LIMITS, PATHS } from '../constants.js';
import { ERROR_KINDS, RobonectError, request as httpRequest } from './http.js';

const own = (object, key) =>
  object !== null && typeof object === 'object' && Object.hasOwn(object, key)
    ? object[key]
    : undefined;
const plain = (data) => data !== null && typeof data === 'object' && !Array.isArray(data);
const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const integer = (value) => (Number.isInteger(value) ? value : undefined);
const bool = (value) => (typeof value === 'boolean' ? value : undefined);

/** A short text from the module, without control characters, else undefined. */
export function text(value) {
  if (typeof value !== 'string') {
    return undefined;
  }
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  return clean === '' ? undefined : clean.slice(0, LIMITS.textLength);
}

/** The id of the module (`id` of the status answer), lower case, else undefined. */
export function idOf(value) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const id = value.trim().toLowerCase();
  return /^[0-9a-z](?:[0-9a-z_.-]{0,62}[0-9a-z])?$/.test(id) ? id : undefined;
}

const notObject = () => new RobonectError(ERROR_KINDS.PROTOCOL, 'Not a JSON object');

/** An integer within bounds, else undefined. */
const bounded = (value, min, max) => {
  const n = integer(value);
  return n !== undefined && n >= min && n <= max ? n : undefined;
};

/**
 * GET /json?cmd=status -> what the integration uses. `successful: false`
 * (or missing) is a protocol error: the answer is not a status.
 */
export function parseStatus(data) {
  if (!plain(data)) {
    throw notObject();
  }
  if (own(data, 'successful') !== true) {
    throw new RobonectError(ERROR_KINDS.PROTOCOL, 'Not a successful status');
  }
  const status = plain(own(data, 'status')) ? own(data, 'status') : {};
  const error = own(data, 'error');
  const timer = own(data, 'timer');
  const next = own(timer, 'next');
  const errorCode = bounded(own(error, 'error_code'), 0, 10_000);
  return {
    id: idOf(own(data, 'id')),
    name: text(own(data, 'name')),
    code: bounded(own(status, 'status'), 0, 99),
    stopped: bool(own(status, 'stopped')),
    mode: bounded(own(status, 'mode'), 0, 99),
    battery: bounded(own(status, 'battery'), 0, 100),
    /** Seconds in the current status. */
    duration: bounded(own(status, 'duration'), 0, 100_000_000),
    hours: bounded(own(status, 'hours'), 0, 10_000_000),
    distance: bounded(own(status, 'distance'), 0, 100_000),
    blades: bounded(own(own(data, 'blades'), 'quality'), 0, 100),
    wifi: bounded(own(own(data, 'wlan'), 'signal'), -150, 0),
    temperature: number(own(own(data, 'health'), 'temperature')),
    humidity: number(own(own(data, 'health'), 'humidity')),
    /** The next start of the timer (unix seconds of the module's clock), else undefined. */
    nextStart: bounded(own(next, 'unix'), 1, 4_102_444_800),
    /** The error in force (`error` object of the status), else undefined. */
    error:
      errorCode !== undefined
        ? { code: errorCode, message: text(own(error, 'error_message')) }
        : undefined,
  };
}

/** Retry-After (seconds or an HTTP date) in ms, else undefined. */
export function retryAfterOf(header, now = Date.now()) {
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  if (/^\s*\d{1,9}\s*$/.test(value)) {
    return Number(value) * 1000;
  }
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/** The error of a non-2xx answer (the body is never kept: it may echo a secret). */
function statusError(response, now) {
  const status = response.status;
  if (status === 429) {
    return new RobonectError(ERROR_KINDS.RATE_LIMITED, 'HTTP 429', {
      status,
      retryAfter: retryAfterOf(response.headers?.['retry-after'], now),
    });
  }
  if (status === 401 || status === 403) {
    return new RobonectError(ERROR_KINDS.AUTH, `HTTP ${status}`, { status });
  }
  return new RobonectError(ERROR_KINDS.HTTP, `HTTP ${status}`, { status });
}

/** The reason of an error for a log or a message: its kind and status, never the answer. */
export function errorReason(err) {
  if (
    err?.kind === ERROR_KINDS.HTTP ||
    err?.kind === ERROR_KINDS.RATE_LIMITED ||
    err?.kind === ERROR_KINDS.AUTH
  ) {
    return `HTTP ${err.status}`;
  }
  if (err?.kind === ERROR_KINDS.REFUSED) {
    return `code ${err.code ?? '?'}`;
  }
  return typeof err?.kind === 'string' ? err.kind : 'error';
}

function json(response) {
  try {
    return JSON.parse(response.body);
  } catch {
    throw new RobonectError(ERROR_KINDS.PROTOCOL, 'Not JSON');
  }
}

/** The Basic authorization header of `auth` (never logged), or no header. */
export const authHeaders = (auth) =>
  auth
    ? {
        Authorization: `Basic ${Buffer.from(`${auth.user}:${auth.password}`, 'latin1').toString('base64')}`,
      }
    : {};

export class RobonectClient {
  constructor({ transport = httpRequest, now = Date.now } = {}) {
    this.transport = transport;
    this.now = now;
  }

  async get(address, auth, path, { timeoutMs, startBy = Infinity }) {
    const response = await this.transport({
      host: address.host,
      port: address.port,
      path,
      headers: authHeaders(auth),
      timeoutMs,
      startBy,
      now: this.now,
    });
    if (response.status < 200 || response.status > 299) {
      throw statusError(response, this.now());
    }
    return json(response);
  }

  /** The status of the mower. */
  async status(address, auth, { timeoutMs }) {
    return parseStatus(await this.get(address, auth, PATHS.status, { timeoutMs }));
  }

  /**
   * One command (`start`, `stop` or `home`), never retried. `startBy`:
   * refused unsent (LATE) when the request could not be written by then.
   * The module answers `{ successful: true }`, or `false` with an error code
   * (REFUSED: it received the command and refused it).
   */
  async command(address, auth, name, { timeoutMs, startBy }) {
    const path = PATHS[name];
    if (!path || name === 'status') {
      throw Object.assign(new Error('Unknown command'), { notSent: true });
    }
    if (this.now() > startBy) {
      throw new RobonectError(ERROR_KINDS.LATE, 'Too late to send');
    }
    const data = await this.get(address, auth, path, { timeoutMs, startBy });
    if (!plain(data) || typeof own(data, 'successful') !== 'boolean') {
      throw new RobonectError(ERROR_KINDS.PROTOCOL, 'No outcome in the answer');
    }
    if (own(data, 'successful') !== true) {
      throw new RobonectError(ERROR_KINDS.REFUSED, 'Refused by the module', {
        code: bounded(own(data, 'error_code'), 0, 10_000),
        message: text(own(data, 'error_message')),
      });
    }
  }
}
