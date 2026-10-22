// -----------------------------------------------------------------------------
// One plain HTTP/1.1 GET to the module (node:net + node:http, no keep-alive,
// no redirect followed, bounded time and size). The TCP connection is opened
// first; only once it is up, and only if the deadline of a command
// (`startBy`) has not passed meanwhile, is the request written: a slow
// connection never lets a command leave late.
//
// Every failure becomes a RobonectError whose kind says whether the request
// may have reached the module: 'unreachable' / 'late' (nothing written) or
// 'timeout' (written, then silent or cut: it may have been received). The
// Authorization header is never logged, never put in an error.
//
// The answer is copied into one buffer of at most LIMITS.responseBytes,
// allocated once: no per-chunk buffer kept, no concatenation.
// -----------------------------------------------------------------------------

import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { LIMITS } from '../constants.js';

/** The kinds of failure the rest of the code tells apart. */
export const ERROR_KINDS = Object.freeze({
  /** Nothing accepted the connection. Nothing was sent. */
  UNREACHABLE: 'unreachable',
  /** Written, then silent or cut: the request may have been received. */
  TIMEOUT: 'timeout',
  /** An HTTP status other than 2xx (`status` holds it). */
  HTTP: 'http',
  /** 401 or 403: the user or the password refused (`status` holds it). */
  AUTH: 'auth',
  /** 429 (`retryAfter` in ms when the module gave one). */
  RATE_LIMITED: 'rate_limited',
  /** Too large, not JSON, not the expected shape. */
  PROTOCOL: 'protocol',
  /** The deadline of a command passed before its request was written: nothing was sent. */
  LATE: 'late',
  /** The module answered `successful: false` (`code` holds its error code). */
  REFUSED: 'refused',
});

export class RobonectError extends Error {
  constructor(kind, message, details = {}) {
    super(message);
    this.name = 'RobonectError';
    this.kind = kind;
    for (const [key, value] of Object.entries(details)) {
      this[key] = value;
    }
  }
}

/**
 * @param {{ host: string, port: number, path: string, headers?: object,
 *   timeoutMs?: number, startBy?: number, now?: () => number }} options
 * @returns {Promise<{ status: number, headers: object, body: string }>}
 */
export function request({
  host,
  port,
  path,
  headers = {},
  timeoutMs = 5000,
  startBy = Infinity,
  now = Date.now,
}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let written = false;
    let req;
    const socket = connect({ host, port });
    const finish = (fn, value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn(value);
      }
    };
    const fail = (kind, message) => {
      req?.destroy();
      socket.destroy();
      finish(reject, new RobonectError(kind, message));
    };
    const lost = (err) =>
      written
        ? fail(ERROR_KINDS.TIMEOUT, `Connection lost: ${err?.code ?? 'error'}`)
        : fail(ERROR_KINDS.UNREACHABLE, `Unreachable: ${err?.code ?? 'error'}`);
    // A plain (ref'd) timer: the exchange keeps the process alive until it ends.
    const timer = setTimeout(
      () =>
        written
          ? fail(ERROR_KINDS.TIMEOUT, 'Connected but silent: timeout')
          : fail(ERROR_KINDS.UNREACHABLE, 'Unreachable: timeout'),
      timeoutMs,
    );
    socket.on('error', lost);
    socket.once('connect', () => {
      if (settled) {
        return;
      }
      if (now() > startBy) {
        // Connected too late for a command: nothing is written.
        fail(ERROR_KINDS.LATE, 'Too late to send');
        return;
      }
      written = true;
      req = httpRequest(
        {
          host,
          port,
          method: 'GET',
          path,
          // No `agent`: with `agent: false` Node ignores createConnection and
          // opens a second connection, on which the deadline was never checked.
          createConnection: () => socket,
          headers: { Connection: 'close', Accept: 'application/json', ...headers },
        },
        (res) => {
          let body;
          let size = 0;
          res.on('data', (chunk) => {
            if (settled) {
              return;
            }
            if (size + chunk.length > LIMITS.responseBytes) {
              fail(ERROR_KINDS.PROTOCOL, 'Answer too large');
              return;
            }
            body ??= Buffer.allocUnsafe(LIMITS.responseBytes);
            chunk.copy(body, size);
            size += chunk.length;
          });
          res.on('end', () => {
            socket.destroy();
            finish(resolve, {
              status: res.statusCode ?? 0,
              headers: res.headers ?? {},
              body: body ? body.toString('utf8', 0, size) : '',
            });
          });
          res.on('error', lost);
        },
      );
      req.on('error', lost);
      req.end();
    });
  });
}
