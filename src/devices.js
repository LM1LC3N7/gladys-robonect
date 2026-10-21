// -----------------------------------------------------------------------------
// The mower -> one Gladys device and its states (pure).
//
// `ext:<selector>:robonect:<id>`: one device per Robonect module, keyed by
// the `id` of its status answer (lower case), never by its IP address (it may
// change). The feature roles (the last part of their external ids) are
// published forever: never rename them. Every role is always built, so a
// republished device never loses a feature.
//
// The state uses Gladys' `vacuum-cleaner` category (like LM1LC3N7/
// gladys-automower and gladys-bosch-indego): its card labels a robot that
// runs, docks and charges, and offers a "Return to dock" button (the `dock`
// feature, protective). No switch, no writable binary, no run mode select:
// a "turn everything on/off" (Google Home, Alexa, HomeKit, MCP, `switch.*`
// scenes) never reaches the start. Start, pause and back to the base are
// three `button/push` features; the start refuses unless the configuration
// allows it (src/app.js).
//
// Categories and units are those the core lists
// (DEVICE_FEATURE_UNITS_BY_CATEGORY): % on battery, humidity-sensor and
// maintenance; °C on temperature-sensor; m on distance-sensor; minutes and
// hours on duration. The Wi-Fi signal (dBm) has no unit in the core: an
// `unknown` sensor whose name says "dBm".
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { DOCK_STATE, FEATURES, STATUS } from './constants.js';
import {
  FEATURE_NAMES,
  MODE_NAMES,
  NONE,
  NO_TIMER,
  OFFLINE,
  UNKNOWN_MODE,
  statusText,
  word,
} from './i18n.js';

const sensor = (definition) => ({
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...definition,
});
const text = sensor({ category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0, keep_history: false });
const binary = sensor({ category: C.UNKNOWN, type: T.SENSOR.BINARY, min: 0, max: 1 });
const button = {
  category: C.BUTTON,
  type: T.BUTTON.PUSH,
  min: 0,
  max: 1,
  read_only: false,
  has_feedback: false,
  keep_history: false,
};

/** The features, by role, in display order. */
export const DEFINITIONS = {
  [FEATURES.STATE]: sensor({
    category: C.VACUUM_CLEANER,
    type: T.VACUUM_CLEANER.STATE,
    min: 0,
    max: 6,
  }),
  [FEATURES.DOCK]: {
    category: C.VACUUM_CLEANER,
    type: T.VACUUM_CLEANER.DOCK,
    min: 0,
    max: 1,
    read_only: false,
    has_feedback: false,
    keep_history: false,
  },
  [FEATURES.STATUS]: text,
  [FEATURES.STATUS_CODE]: sensor({ category: C.UNKNOWN, type: T.SENSOR.INTEGER, min: 0, max: 99 }),
  [FEATURES.MODE]: text,
  [FEATURES.STOPPED]: binary,
  [FEATURES.BATTERY]: sensor({
    category: C.BATTERY,
    type: T.BATTERY.INTEGER,
    unit: U.PERCENT,
    min: 0,
    max: 100,
  }),
  [FEATURES.CHARGING]: sensor({ category: C.BATTERY, type: T.BATTERY.CHARGING, min: 0, max: 1 }),
  [FEATURES.ERROR]: binary,
  [FEATURES.ERROR_CODE]: sensor({
    category: C.UNKNOWN,
    type: T.SENSOR.INTEGER,
    min: 0,
    max: 10_000,
  }),
  [FEATURES.ERROR_TEXT]: text,
  [FEATURES.STATUS_DURATION]: sensor({
    category: C.DURATION,
    type: T.DURATION.INTEGER,
    unit: U.MINUTES,
    min: 0,
    max: 10_000_000,
  }),
  [FEATURES.MOWING_HOURS]: sensor({
    category: C.DURATION,
    type: T.DURATION.INTEGER,
    unit: U.HOURS,
    min: 0,
    max: 10_000_000,
  }),
  [FEATURES.DISTANCE]: sensor({
    category: C.DISTANCE_SENSOR,
    type: T.SENSOR.INTEGER,
    unit: U.M,
    min: 0,
    max: 100_000,
  }),
  [FEATURES.BLADES]: sensor({
    category: C.MAINTENANCE,
    type: T.MAINTENANCE.LIFE_REMAINING,
    unit: U.PERCENT,
    min: 0,
    max: 100,
  }),
  [FEATURES.WIFI]: sensor({ category: C.UNKNOWN, type: T.SENSOR.INTEGER, min: -150, max: 0 }),
  [FEATURES.TEMPERATURE]: sensor({
    category: C.TEMPERATURE_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: U.CELSIUS,
    min: -40,
    max: 100,
  }),
  [FEATURES.HUMIDITY]: sensor({
    category: C.HUMIDITY_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: U.PERCENT,
    min: 0,
    max: 100,
  }),
  [FEATURES.NEXT_START]: text,
  [FEATURES.CONNECTED]: binary,
  [FEATURES.START]: button,
  [FEATURES.PAUSE]: button,
  [FEATURES.HOME]: button,
};

export const ROLES = Object.keys(DEFINITIONS);
/** The writable roles and the command each one sends. */
export const COMMAND_OF = {
  [FEATURES.START]: 'start',
  [FEATURES.PAUSE]: 'pause',
  [FEATURES.HOME]: 'home',
  [FEATURES.DOCK]: 'home',
};

export const mowerIds = (gladys, id) => gladys.externalIds('robonect', id);

const ID = '[0-9a-z](?:[0-9a-z_.-]{0,62}[0-9a-z])?';

/** The id and the role of one of our feature external ids, else undefined. */
export function parseFeatureId(externalId) {
  if (typeof externalId !== 'string') {
    return undefined;
  }
  const match = new RegExp(`:robonect:(${ID}):([a-z0-9-]+)$`).exec(externalId);
  return match && ROLES.includes(match[2]) ? { id: match[1], role: match[2] } : undefined;
}

/** The id of one of our device external ids, else undefined. */
export function parseDeviceId(externalId) {
  const match = new RegExp(`:robonect:(${ID})$`).exec(String(externalId ?? ''));
  return match ? match[1] : undefined;
}

export const deviceName = (mower) => mower.name ?? `Robonect ${mower.id.slice(-6)}`;

/** The Gladys device of the mower. */
export function buildDevice(gladys, mower, { language }) {
  const ids = mowerIds(gladys, mower.id);
  return {
    name: deviceName(mower),
    external_id: ids.device,
    model: 'Robonect',
    should_poll: false,
    features: ROLES.map((role) => ({
      name: word(FEATURE_NAMES[role], language),
      external_id: ids.feature(role),
      ...DEFINITIONS[role],
    })),
    params: [{ name: 'robonect_id', value: mower.id }],
  };
}

/** The Gladys vacuum-cleaner state of a status (undefined: unknown). */
export function dockStateOf(mower) {
  const { code, stopped } = mower;
  if (stopped === true && [STATUS.MOWING, STATUS.SEARCHING_BASE, STATUS.SEARCHING].includes(code)) {
    return DOCK_STATE.PAUSED;
  }
  switch (code) {
    case STATUS.PARKED:
      return DOCK_STATE.PAUSED;
    case STATUS.MOWING:
      return DOCK_STATE.RUNNING;
    case STATUS.SEARCHING_BASE:
    case STATUS.SEARCHING:
      return DOCK_STATE.RETURNING;
    case STATUS.CHARGING:
      return DOCK_STATE.CHARGING;
    case STATUS.ERROR:
    case STATUS.LOOP_LOST:
      return DOCK_STATE.ERROR;
    case STATUS.OFF:
    case STATUS.GARAGE_DOOR:
      return DOCK_STATE.STOPPED;
    case STATUS.SLEEPING:
      return DOCK_STATE.DOCKED;
    default:
      return undefined;
  }
}

const flag = (value) => (value === undefined ? undefined : value ? 1 : 0);

/** The next start of the timer, as the module's clock gives it ("2026-10-21 14:00"). */
export function nextStartText(unix, language) {
  if (unix === undefined) {
    return word(NO_TIMER, language);
  }
  // The module gives its local time as if it were UTC: read back as UTC.
  return new Date(unix * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * The current values of the mower's device. Offline: only the status and
 * "reachable" (Gladys keeps the last value of the others).
 */
export function deviceStates(ids, mower, { online, language }) {
  const states = [];
  if (!online) {
    states.push({ role: FEATURES.STATUS, text: word(OFFLINE, language) });
    states.push({ role: FEATURES.CONNECTED, state: 0 });
  } else {
    // A value outside the bounds of its feature is dropped (Gladys keeps the last one).
    const add = (role, value) => {
      const { min, max } = DEFINITIONS[role];
      if (value !== undefined && Number.isFinite(value) && value >= min && value <= max) {
        states.push({ role, state: value });
      }
    };
    add(FEATURES.CONNECTED, 1);
    if (mower.code !== undefined) {
      states.push({ role: FEATURES.STATUS, text: word(statusText(mower), language) });
      add(FEATURES.STATUS_CODE, mower.code);
      add(FEATURES.STATE, dockStateOf(mower));
      add(FEATURES.CHARGING, mower.code === STATUS.CHARGING ? 1 : 0);
      const inError = mower.code === STATUS.ERROR || mower.code === STATUS.LOOP_LOST;
      add(FEATURES.ERROR, inError ? 1 : 0);
      add(FEATURES.ERROR_CODE, inError ? (mower.error?.code ?? mower.code) : 0);
      states.push({
        role: FEATURES.ERROR_TEXT,
        text: inError
          ? (mower.error?.message ?? word(statusText(mower), language))
          : word(NONE, language),
      });
    }
    if (mower.mode !== undefined) {
      states.push({
        role: FEATURES.MODE,
        text: word(MODE_NAMES[mower.mode] ?? UNKNOWN_MODE, language),
      });
    }
    add(FEATURES.STOPPED, flag(mower.stopped));
    add(FEATURES.BATTERY, mower.battery);
    if (mower.duration !== undefined)
      add(FEATURES.STATUS_DURATION, Math.floor(mower.duration / 60));
    add(FEATURES.MOWING_HOURS, mower.hours);
    add(FEATURES.DISTANCE, mower.distance);
    add(FEATURES.BLADES, mower.blades);
    add(FEATURES.WIFI, mower.wifi);
    if (mower.temperature !== undefined)
      add(FEATURES.TEMPERATURE, Math.round(mower.temperature * 10) / 10);
    if (mower.humidity !== undefined) add(FEATURES.HUMIDITY, Math.round(mower.humidity * 10) / 10);
    if (mower.code !== undefined) {
      states.push({ role: FEATURES.NEXT_START, text: nextStartText(mower.nextStart, language) });
    }
  }
  return states.map(({ role, ...value }) => ({
    device_feature_external_id: ids.feature(role),
    ...value,
  }));
}
