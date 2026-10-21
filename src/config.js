// -----------------------------------------------------------------------------
// The configuration: the manifest `config_schema` values, normalized so the
// rest of the code never deals with strings typed in a form. The password of
// the module is kept here in memory only: never logged, never written to
// /data, never put in a status or an error.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { DEFAULT_PORT, LIMITS, POLL_INTERVAL } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULT_CONFIG = {
  host: '',
  username: '',
  password: '',
  allow_start: false,
  poll_interval: POLL_INTERVAL.default,
  language: 'fr',
};

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * The address of the module typed by the user: an IPv4 address or a host
 * name, with an optional port (a pasted URL is reduced to its host and port).
 * @returns {{ host: string, port: number } | undefined} undefined when invalid or empty.
 */
export function parseAddress(raw) {
  const text = String(raw ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/[/?#].*$/, '')
    .toLowerCase();
  if (text === '' || text.length > 260) {
    return undefined;
  }
  const match = /^([^:]+)(?::(\d{1,5}))?$/.exec(text);
  if (!match) {
    return undefined;
  }
  const host = match[1];
  const port = match[2] === undefined ? DEFAULT_PORT : Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || host.length > 253) {
    return undefined;
  }
  if (isIP(host) === 4) {
    return { host, port };
  }
  if (/^[\d.]+$/.test(host)) {
    return undefined;
  }
  return host.split('.').every((label) => LABEL.test(label)) ? { host, port } : undefined;
}

export const addressKey = ({ host, port }) => (port === DEFAULT_PORT ? host : `${host}:${port}`);

/** Only `true` (or the text "true") allows: anything else, missing included, refuses. */
const strictTrue = (value) => value === true || value === 'true';

/** Printable ASCII, bounded; `undefined` when refused, '' when empty. */
function ascii(value, max) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  // The password is kept as typed (a space may be part of it), the user trimmed by the caller.
  if (value.length > max || !/^[\x20-\x7e]*$/.test(value)) {
    return undefined;
  }
  return value;
}

export function normalizeConfig(raw = {}) {
  const c = { ...DEFAULT_CONFIG };
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (Object.hasOwn(DEFAULT_CONFIG, key) && value != null) {
      c[key] = value;
    }
  }
  const typed = String(c.host ?? '').trim();
  // A pasted URL with `user:password@`: never parsed, never shown (it may hold a password).
  const credentialsInHost = typed.includes('@');
  // HTTPS asked: refused (v1 speaks plain HTTP), never quietly turned into clear text.
  const httpsAsked = /^https:\/\//i.test(typed);
  const address = credentialsInHost || httpsAsked ? undefined : parseAddress(typed);
  const user = ascii(
    typeof c.username === 'string' ? c.username.trim() : c.username,
    LIMITS.userMax,
  );
  const password = ascii(c.password, LIMITS.secretMax);
  // Basic authentication cannot carry a ":" in the user name.
  const badUser = user === undefined || (user ?? '').includes(':');
  const badSecret = password === undefined;
  let auth;
  let authMissing = false;
  if (!badUser && !badSecret) {
    if (user !== '' && password !== '') {
      auth = { user, password };
    } else if (user !== '' || password !== '') {
      // One without the other: never sent half.
      authMissing = true;
    }
  }
  const interval = Number(c.poll_interval);
  return {
    address,
    /** The text typed when it is not an address (shown in the status, cut); never with an `@`. */
    invalidHost:
      typed !== '' && !address && !credentialsInHost && !httpsAsked
        ? typed.slice(0, 100)
        : undefined,
    /** Credentials typed in the address field: a fixed message, the text never shown. */
    credentialsInHost,
    /** `https://` typed: a fixed message, nothing sent. */
    httpsAsked,
    /** `{ user, password }`, or undefined: no authentication (a module set without one). */
    auth,
    authMissing,
    badUser,
    badSecret,
    allowStart: strictTrue(c.allow_start),
    pollInterval:
      Number.isFinite(interval) && String(c.poll_interval).trim() !== ''
        ? Math.min(POLL_INTERVAL.max, Math.max(POLL_INTERVAL.min, Math.round(interval)))
        : POLL_INTERVAL.default,
    language: c.language === 'en' ? 'en' : 'fr',
  };
}

/** Whether the configuration can be used to read the module. */
export const usable = (config) =>
  Boolean(config.address) && !config.authMissing && !config.badUser && !config.badSecret;

/**
 * What identifies the credentials in memory, to tell a change (compared,
 * never logged, never stored).
 */
export const credentialsKey = (config) =>
  config.auth ? JSON.stringify([config.auth.user, config.auth.password]) : '';

/**
 * The fingerprint of credentials REFUSED by the module, with the salt kept
 * beside it in /data: after a restart, a block is lifted at once when other
 * credentials are configured. Only ever computed for credentials the module
 * refused, and erased at the first accepted read: the good password never
 * leaves memory in any form.
 */
export const refusedFingerprint = (config, salt) =>
  createHash('sha256')
    .update(`robonect-refused\0${salt}\0${credentialsKey(config)}`)
    .digest('hex');
