// -----------------------------------------------------------------------------
// Robonect constants, feature roles, limits and timings.
//
// A Robonect module (Robonect Hx / H30x, fitted inside a Husqvarna, Gardena,
// Flymo or McCulloch robotic mower) serves a JSON API on its own HTTP server,
// as aiorobonect (MIT, geertmeersman/aiorobonect 1.3.1, the library of the
// Robonect integration for Home Assistant) calls it:
//   GET /json?cmd=status              state, mode, battery, hours, Wi-Fi...
//   GET /json?cmd=start               lifts the stop: the mower follows its mode
//   GET /json?cmd=stop                stops the mower where it is (pause)
//   GET /json?cmd=mode&mode=home      sends the mower back to its base and keeps it there
// with HTTP Basic authentication (the user and password of the module). The
// `status` command is the one that never wakes a sleeping module; it is the
// only one the polling sends.
// -----------------------------------------------------------------------------

export const DEFAULT_PORT = 80;

export const PATHS = {
  status: '/json?cmd=status',
  /** Read once when the status has no id: its `serial` identifies the module (as Home Assistant does). */
  version: '/json?cmd=version',
  start: '/json?cmd=start',
  /** The pause of this integration: Robonect's stop. */
  pause: '/json?cmd=stop',
  home: '/json?cmd=mode&mode=home',
};

/** `status.status` of the module (aiorobonect / Home Assistant's mapping). */
export const STATUS = {
  DETECTING: 0,
  PARKED: 1,
  MOWING: 2,
  SEARCHING_BASE: 3,
  CHARGING: 4,
  SEARCHING: 5,
  ERROR: 7,
  LOOP_LOST: 8,
  OFF: 16,
  SLEEPING: 17,
  GARAGE_DOOR: 18,
  /** "Offline, cannot bind" (Home Assistant): the module no longer talks to the mower. */
  OFFLINE_NO_BIND: 98,
  UNKNOWN: 99,
};

/**
 * The only statuses a start may lift the stop on (an allow list: any other
 * code, unknown or undocumented, refuses). 2: stopped on the lawn.
 */
export const START_ALLOWED = new Set([
  STATUS.PARKED,
  STATUS.MOWING,
  STATUS.SEARCHING_BASE,
  STATUS.CHARGING,
  STATUS.SEARCHING,
  STATUS.SLEEPING,
  STATUS.GARAGE_DOOR,
]);

/** `status.mode` of the module. */
export const MODE = {
  AUTO: 0,
  MANUAL: 1,
  HOME: 2,
  DEMO: 3,
  END_OF_DAY: 98,
  JOB: 99,
};

/** VACUUM_CLEANER_STATE of the core (server/utils/constants.js). */
export const DOCK_STATE = {
  STOPPED: 0,
  RUNNING: 1,
  PAUSED: 2,
  ERROR: 3,
  RETURNING: 4,
  CHARGING: 5,
  DOCKED: 6,
};

/** Feature roles (the last part of the feature external ids): frozen forever. */
export const FEATURES = {
  STATE: 'state',
  DOCK: 'dock',
  STATUS: 'status',
  STATUS_CODE: 'status-code',
  MODE: 'mode',
  STOPPED: 'stopped',
  BATTERY: 'battery',
  CHARGING: 'charging',
  ERROR: 'error',
  ERROR_CODE: 'error-code',
  ERROR_TEXT: 'error-text',
  STATUS_DURATION: 'status-duration',
  MOWING_HOURS: 'mowing-hours',
  DISTANCE: 'distance',
  BLADES: 'blades-quality',
  WIFI: 'wifi-signal',
  TEMPERATURE: 'temperature',
  HUMIDITY: 'humidity',
  NEXT_START: 'next-start',
  CONNECTED: 'connected',
  START: 'start',
  PAUSE: 'pause',
  HOME: 'home',
};

/** The commands: only START is sensitive (off by default); the others protect. */
export const COMMANDS = {
  START: 'start',
  PAUSE: 'pause',
  HOME: 'home',
};

export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
};

/** The value a `button/push` feature sends (BUTTON_PUSH.PRESSED of the core). */
export const PRESSED = 1;

/** The poll interval of the configuration, in seconds. */
export const POLL_INTERVAL = {
  min: 30,
  max: 3600,
  default: 60,
};

export const LIMITS = {
  /** Gladys: 300 states per minute, for the whole integration. */
  statesPerMinute: 300,
  statesPerRequest: 100,
  /** A status answer is about 600 bytes. */
  responseBytes: 32 * 1024,
  /** Longest text kept from an answer (name, error message). */
  textLength: 80,
  /** User name and password of the module: printable ASCII, bounded. */
  secretMax: 128,
  userMax: 64,
};

export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

export const TIMINGS = {
  /** One read of the polling (the module answers over the Wi-Fi of the garden: slow). */
  readTimeout: 10 * SECOND,
  /** Failed reads: 1, 2, 5, then 15 minutes, never shorter than the interval. */
  backoff: [MINUTE, 2 * MINUTE, 5 * MINUTE, 15 * MINUTE],
  /** 429: Retry-After bounded to 1 min .. 6 h, 5 min without. A 5xx pauses as a failed read. */
  rateLimitMin: MINUTE,
  rateLimitMax: 6 * HOUR,
  rateLimitDefault: 5 * MINUTE,
  /** User or password refused: new tries 15 min, 1 h, then every 6 h (kept in /data). */
  authBackoff: [15 * MINUTE, HOUR, 6 * HOUR],
  /** The time of the last read is written to /data at most this often. */
  attemptWriteEvery: MINUTE,
  /** The publisher sends what is pending every second; unchanged states again every 30 min. */
  flushInterval: SECOND,
  stateHeartbeat: 30 * MINUTE,
  /**
   * Commands (Gladys waits 5 s for the ack): a start must leave by 3.5 s
   * after the click, or it is refused unsent; every answer is awaited until
   * 4.3 s, after which the command is "sent, without confirmation".
   */
  commandSendBy: 3_500,
  commandAnswerBy: 4_300,
  /** The fresh read of a command: 2 s at most, and 0.3 s left to send after it. */
  commandReadMax: 2_000,
  commandMinRead: 300,
  commandMinSend: 300,
  /** A pause or a home skips its identity read when the module was read this recently. */
  protectReadFresh: 10 * SECOND,
  /** After a restart, the last good read kept in /data shows "connected" while waiting. */
  lastGoodMax: 2 * HOUR,
  /** A protective command keeps going after the ack, this long at most. */
  protectTimeout: 15 * SECOND,
  /** Reads after a command, spaced: its effect, then a check. */
  followUps: [10 * SECOND, 40 * SECOND],
  /** A command not seen yet keeps its guard this long. */
  guard: 2 * MINUTE,
  /** A pause sent again at most this often while a start may still land after it. */
  pauseReasserts: 2,
};
