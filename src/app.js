// -----------------------------------------------------------------------------
// The integration: the Robonect module typed in the configuration (one IP
// address, the user name and password of the module), one read of its status
// every poll interval, its Gladys device and states, the transport badge, the
// "Test the connection" button, and the three commands. index.js only wires
// the SDK handlers to it (src/handlers.js).
//
// Reads follow the rules learnt on the previous modules:
//   - never sooner than the interval after the last one: not for the test
//     button, a Discovery scan, a reconnection to Gladys, a configuration
//     saved unchanged, nor a restart of the container (the time of the last
//     read is kept in /data, written at most once a minute); a reconnection
//     during a read joins it;
//   - an answer that arrives for an old configuration (generation) publishes
//     nothing and sets no status; the id of the module is checked at every
//     read (an address may be handed to another module by DHCP);
//   - refused credentials: a block kept in /data, new tries 15 min, 1 h, then
//     every 6 h; 429/5xx: a bounded pause kept in /data.
//
// Commands:
//   - START (lifts the stop) is sensitive: refused unless "Allow the start"
//     is on, checked on arrival and again right before sending; decided on a
//     fresh read only (never on the state in memory), refused when a value it
//     needs is missing or the read shows another module; sent within 3.5 s of
//     the click or refused unsent; answered by 4.3 s; one at a time, never
//     retried; "sent, without confirmation" whenever it may have reached the
//     module;
//   - PAUSE (stop where it is) and HOME (back to the base) protect: never held
//     back, outside any queue: not by the option, a start in flight, a 429/5xx
//     pause, a block or a failed fresh read (one request then), and possible
//     before the first read after a restart (the id kept in /data). They
//     cancel a start not sent yet; a pause sent while a start may still land
//     is sent again when that start settles, and reaffirmed (twice at most)
//     by the reads of the next two minutes if the mower runs again;
//   - the ack never waits for a publication to Gladys.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import {
  addressKey,
  credentialsKey,
  normalizeConfig,
  refusedFingerprint,
  usable,
} from './config.js';
import { COMMANDS, PRESSED, SECOND, START_ALLOWED, TIMINGS } from './constants.js';
import {
  COMMAND_OF,
  buildDevice,
  deviceStates,
  mowerIds,
  parseDeviceId,
  parseFeatureId,
} from './devices.js';
import { ERRORS, MODE_NAMES, T, UNKNOWN_MODE, age, statusText, summaryOf, word } from './i18n.js';
import { RobonectClient, errorReason } from './robonect/client.js';
import { ERROR_KINDS } from './robonect/http.js';
import { StatePublisher } from './publisher.js';
import { fileStore, normalizeMemory } from './store.js';

const both = (en, fr) => ({ en, fr });
const join = (a, b) => both(`${a.en} ${b.en}`, `${a.fr} ${b.fr}`);

const freshMower = () => ({
  id: undefined,
  /** When a polling or command read last gave the id; -Infinity: kept in /data, not read since the start. */
  readAt: -Infinity,
  data: undefined,
  online: undefined,
  failures: 0,
  wait: undefined,
  error: undefined,
  timer: undefined,
  running: undefined,
  followUps: new Set(),
});

export class RobonectApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'robonect' }),
    transport,
    now = Date.now,
    timers = globalThis,
    store = fileStore(),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.store = store;
    this.client = new RobonectClient({ transport, now });
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
    this.config = normalizeConfig();
    this.memory = normalizeMemory(null, now());
    this.mower = freshMower();
    this.generation = 0;
    this.started = false;
    this.pausedUntil = 0;
    /** The time of the last read sent to the module (exact; /data keeps it within a minute). */
    this.lastAttemptAt = -Infinity;
    this.lastStatus = undefined;
    this.published = undefined;
    this.badge = undefined;
    /** When the last request that writes left (a read begun before it is quarantined). */
    this.lastSentAt = -Infinity;
    /** When the last start left. */
    this.lastStartAt = -Infinity;
    /** Until then, a start sent without confirmation may still land. */
    this.unconfirmedStartUntil = -Infinity;
    /** The start in flight: { seq, sentAt, answered, promise }. */
    this.startEntry = undefined;
    /** Counts the protective commands: a start that sees it change gives way. */
    this.protectSeq = 0;
    /** A pause to reaffirm while a start may land after it: { sentAt, until, reasserts }. */
    this.pauseGuard = undefined;
  }

  // --- Lifecycle -------------------------------------------------------------

  /**
   * `fresh`: started for a new address or new credentials while running (a
   * read may go at once); otherwise (container start) the first read waits
   * for the interval after the last read kept in /data.
   */
  async start(raw = {}, { fresh = false } = {}) {
    this.stop();
    await this.mower.running;
    const generation = this.generation;
    this.config = normalizeConfig(raw);
    this.memory = normalizeMemory(await this.store.load().catch(() => null), this.now());
    if (generation !== this.generation) {
      return;
    }
    if (this.memory.pause) {
      this.pausedUntil = Math.max(this.pausedUntil, this.memory.pause.until);
    }
    // Other credentials than the ones refused (changed while the container was down): no wait.
    const block = this.memory.block;
    // A block kept without credentials (refused: null) goes too once some are typed.
    if (
      block &&
      (block.refused
        ? block.refused !== refusedFingerprint(this.config, block.salt)
        : Boolean(this.config.auth))
    ) {
      this.memory.block = null;
      await this.saveMemory();
    }
    this.mower = freshMower();
    // The mower last read at this address: the protective commands go before any read.
    const kept = this.memory.mower;
    if (this.config.address && kept?.address === addressKey(this.config.address)) {
      this.mower.id = kept.id;
    }
    // The serial read once (cmd=version) for a module whose status has no id.
    const serial = this.memory.serial;
    this.serialId =
      this.config.address && serial?.address === addressKey(this.config.address)
        ? serial.id
        : undefined;
    this.versionTried = false;
    this.published = undefined;
    this.badge = undefined;
    this.lastStatus = undefined;
    this.publisher.start();
    if (!usable(this.config)) {
      // The devices already created are shown unreachable.
      await this.publishAll();
      return;
    }
    await this.setStatus(false, this.status()[1]);
    const wait = fresh ? 0 : this.firstWait();
    if (wait > 0) {
      this.schedule(wait);
      await this.publishAll();
      return;
    }
    await this.tick();
  }

  /** The wait before the first read after a container start, from the time kept in /data. */
  firstWait() {
    const stored = this.memory.lastAttemptAt;
    if (stored === null) {
      return 0;
    }
    this.lastAttemptAt = Math.max(this.lastAttemptAt, stored);
    // A read may have left up to a minute after the time kept (written at most once a minute).
    const due = stored + TIMINGS.attemptWriteEvery + this.interval;
    return Math.min(this.interval, Math.max(0, due - this.now()));
  }

  stop() {
    this.generation += 1;
    this.clearTimer();
    for (const handle of this.mower.followUps) {
      this.timers.clearTimeout(handle);
    }
    this.mower.followUps.clear();
    this.publisher.stop();
  }

  clearTimer() {
    if (this.mower.timer) {
      this.timers.clearTimeout(this.mower.timer);
      this.mower.timer = undefined;
    }
  }

  /**
   * Connected to Gladys. The first time, start; after a reconnection, resend
   * what Gladys keeps in memory only (status, Discovery list, badge) and the
   * last states, without reading the module. Pauses and blocks stay.
   */
  async connected(raw = {}) {
    if (!this.started) {
      this.started = true;
      await this.start(raw);
      return;
    }
    await this.liftBlockOnNewCredentials(raw);
    if (this.needsRestart(raw)) {
      await this.start(raw, { fresh: true });
      return;
    }
    const previous = this.config;
    this.config = normalizeConfig(raw);
    this.published = undefined;
    this.badge = undefined;
    this.lastStatus = undefined;
    this.rescheduleOnNewInterval(previous);
    await this.publishAll();
  }

  /** Only a new address or new credentials restart (an interval only reschedules). */
  needsRestart(raw) {
    const next = normalizeConfig(raw);
    return (
      JSON.stringify(next.address ?? null) !== JSON.stringify(this.config.address ?? null) ||
      next.invalidHost !== this.config.invalidHost ||
      next.credentialsInHost !== this.config.credentialsInHost ||
      next.httpsAsked !== this.config.httpsAsked ||
      next.authMissing !== this.config.authMissing ||
      next.badUser !== this.config.badUser ||
      next.badSecret !== this.config.badSecret ||
      credentialsKey(next) !== credentialsKey(this.config)
    );
  }

  /** New credentials saved lift a block at once. */
  async liftBlockOnNewCredentials(raw) {
    if (credentialsKey(normalizeConfig(raw)) !== credentialsKey(this.config) && this.memory.block) {
      this.memory.block = null;
      await this.saveMemory();
    }
  }

  /** A new interval: the next read follows it, counted from the last read. */
  rescheduleOnNewInterval(previous) {
    const m = this.mower;
    if (
      this.config.pollInterval !== previous.pollInterval &&
      usable(this.config) &&
      !m.running &&
      m.online !== false &&
      m.timer
    ) {
      this.schedule();
    }
  }

  async configUpdated(raw = {}) {
    await this.liftBlockOnNewCredentials(raw);
    if (this.needsRestart(raw)) {
      await this.start(raw, { fresh: true });
      return;
    }
    const previous = this.config;
    this.config = normalizeConfig(raw);
    this.rescheduleOnNewInterval(previous);
    if (this.config.allowStart !== previous.allowStart) {
      this.logger.info(`Robonect start ${this.config.allowStart ? 'allowed' : 'disabled'}`);
    }
    if (this.config.language !== previous.language) {
      await this.publishAll();
    }
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  async saveMemory() {
    await this.store
      .save(this.memory)
      .catch((err) => this.logger.warn(`Saving the state to /data failed: ${err.message}`));
  }

  // --- Credentials -----------------------------------------------------------

  get blocked() {
    return Boolean(this.memory.block) && this.now() < this.memory.block.until;
  }

  /** The user name or the password refused: tries spaced (15 min, 1 h, 6 h), kept in /data. */
  async authFailed() {
    const failures = (this.memory.block?.failures ?? 0) + 1;
    const wait = TIMINGS.authBackoff[Math.min(failures - 1, TIMINGS.authBackoff.length - 1)];
    const salt = this.memory.block?.salt ?? randomBytes(16).toString('hex');
    this.memory.block = {
      until: this.now() + wait,
      failures,
      salt,
      refused: this.config.auth ? refusedFingerprint(this.config, salt) : null,
    };
    await this.saveMemory();
    this.logger.warn(
      `Robonect: user name or password refused; next try in ${Math.round(wait / 60000)} min`,
    );
  }

  // --- Polling ---------------------------------------------------------------

  get interval() {
    return this.config.pollInterval * SECOND;
  }

  get paused() {
    return this.now() < this.pausedUntil;
  }

  /** The earliest time the next polling read may go: the interval after the last one. */
  get due() {
    return this.lastAttemptAt + this.interval;
  }

  /**
   * The next read: after a pause or a block, after its backoff, else the
   * interval; never sooner than the interval after the last read.
   */
  schedule(delay) {
    const m = this.mower;
    this.clearTimer();
    let wait;
    if (this.paused) {
      wait = this.pausedUntil - this.now();
    } else if (this.blocked) {
      wait = this.memory.block.until - this.now();
    } else {
      wait = delay ?? (m.online === false ? m.wait : this.interval);
    }
    // Capped at the interval: a clock set back never stops the reads.
    wait = Math.max(wait ?? this.interval, Math.min(this.interval, this.due - this.now()), 0);
    const generation = this.generation;
    m.timer = this.timers.setTimeout(() => {
      m.timer = undefined;
      if (generation === this.generation) {
        this.tick().catch(() => this.logger.error('Robonect refresh failed'));
      }
    }, wait);
  }

  /** One read at a time: a tick during a read joins it. */
  tick() {
    const m = this.mower;
    if (!m.running) {
      m.running = this.run().finally(() => {
        m.running = undefined;
      });
    }
    return m.running;
  }

  /** Keeps the time of this read; in /data at most once a minute. */
  async noteAttempt() {
    const now = this.now();
    this.lastAttemptAt = now;
    const stored = this.memory.lastAttemptAt;
    if (stored === null || now - stored >= TIMINGS.attemptWriteEvery) {
      this.memory.lastAttemptAt = now;
      await this.saveMemory();
    }
  }

  async run() {
    const generation = this.generation;
    if (this.paused || this.blocked) {
      await this.publishAll();
      this.schedule();
      return;
    }
    let delay;
    const startedAt = this.now();
    await this.noteAttempt();
    if (generation !== this.generation) {
      return;
    }
    try {
      const read = await this.client.status(this.config.address, this.config.auth, {
        timeoutMs: TIMINGS.readTimeout,
      });
      if (generation !== this.generation) {
        return;
      }
      const status = await this.identify(read, generation);
      if (generation !== this.generation) {
        return;
      }
      if (startedAt <= this.lastSentAt) {
        // Begun before a command left: it may show the state before it.
        this.logger.debug('Robonect: read begun before a command, not applied');
      } else {
        this.applyRead(status);
        await this.saveMowerId();
        await this.saveLastGood();
        if (this.memory.block) {
          // Accepted: the fingerprint of the refused credentials goes with the block.
          this.memory.block = null;
          await this.saveMemory();
        }
      }
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      delay = await this.failed(err);
      if (generation !== this.generation) {
        return;
      }
    }
    await this.publishAll();
    if (generation === this.generation) {
      this.schedule(delay);
    }
  }

  /**
   * The id of a status without one: the serial read with cmd=version, once
   * per start (and again after the test button), kept in /data with the
   * address. A status without id is never "another module".
   */
  async identify(status, generation) {
    if (status.id) {
      return status;
    }
    if (!this.serialId && !this.versionTried) {
      this.versionTried = true;
      try {
        const id = await this.client.version(this.config.address, this.config.auth, {
          timeoutMs: TIMINGS.readTimeout,
        });
        if (generation !== this.generation) {
          return status;
        }
        if (id) {
          this.serialId = id;
          this.memory.serial = { address: addressKey(this.config.address), id };
          await this.saveMemory();
        }
      } catch (err) {
        this.logger.warn(`Robonect: no id in the status, version unreadable (${errorReason(err)})`);
      }
    }
    return this.withSerial(status);
  }

  /** A status without id, given the serial kept (not checked by this read), else as is. */
  withSerial(status) {
    return !status.id && this.serialId
      ? { ...status, id: this.serialId, idFromSerial: true }
      : status;
  }

  /** The summary of a good read, kept in /data at most once a minute (shown after a restart). */
  async saveLastGood() {
    const m = this.mower;
    const kept = this.memory.lastGood;
    if (!m.data || !this.config.address) {
      return;
    }
    if (kept && this.now() - kept.at < TIMINGS.attemptWriteEvery) {
      return;
    }
    this.memory.lastGood = {
      address: addressKey(this.config.address),
      at: this.now(),
      summary: summaryOf(m.data),
    };
    await this.saveMemory();
  }

  /** A status read: the mower as read (its id checked), and the pause it may reaffirm. */
  applyRead(status, { fromCommand = false } = {}) {
    const m = this.mower;
    m.online = true;
    m.failures = 0;
    m.wait = undefined;
    if (!status.id) {
      // Unreadable: never "another module", but nothing is applied.
      m.error = 'no_id';
      return;
    }
    m.error = undefined;
    if (m.id && m.id !== status.id) {
      this.logger.warn('Robonect: another module answers at this address');
      this.pauseGuard = undefined;
    }
    m.id = status.id;
    m.readAt = this.now();
    m.data = status;
    this.observe(status, { fromCommand });
  }

  /** Keeps in /data the id read at this address, when it changed. */
  async saveMowerId() {
    const m = this.mower;
    if (!m.id || m.readAt === -Infinity || !this.config.address) {
      return;
    }
    const address = addressKey(this.config.address);
    const kept = this.memory.mower;
    if (kept?.address === address && kept.id === m.id) {
      return;
    }
    this.memory.mower = { address, id: m.id };
    await this.saveMemory();
  }

  /** A failed read: the delay before the next one. */
  async failed(err) {
    const m = this.mower;
    const reason = errorReason(err);
    if (err.kind === ERROR_KINDS.AUTH) {
      m.online = false;
      m.error = 'auth';
      await this.authFailed();
      return undefined;
    }
    if (err.kind === ERROR_KINDS.RATE_LIMITED) {
      // The module answers: it stays online, the status shows the pause.
      await this.pause(err);
      this.logger.warn(`Robonect: ${reason}, pause`);
      return undefined;
    }
    const wait = Math.max(
      this.interval,
      TIMINGS.backoff[Math.min(m.failures, TIMINGS.backoff.length - 1)],
    );
    m.failures += 1;
    m.online = false;
    m.wait = wait;
    m.error = reason;
    if (err.kind === ERROR_KINDS.HTTP && err.status >= 500) {
      this.pausedUntil = Math.max(this.pausedUntil, this.now() + wait);
      this.memory.pause = { until: this.pausedUntil, reason: '5xx' };
      await this.saveMemory();
    }
    this.logger.warn(`Robonect: ${reason}; next try in ${Math.round(wait / 1000)} s`);
    return wait;
  }

  /** A 429: a bounded pause kept in /data (the protective commands still go). */
  async pause(err) {
    const wait = Math.min(
      TIMINGS.rateLimitMax,
      Math.max(TIMINGS.rateLimitMin, err.retryAfter ?? TIMINGS.rateLimitDefault),
    );
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + wait);
    this.memory.pause = { until: this.pausedUntil, reason: '429' };
    await this.saveMemory();
  }

  pauseMessage() {
    if (!this.paused) {
      return undefined;
    }
    const wait = age(this.pausedUntil - this.now());
    return this.memory.pause?.reason === '5xx' ? T.serverError(wait) : T.rateLimited(wait);
  }

  /** `[connected, message, plain]`; `plain`: the summary without "Connected". */
  status() {
    const m = this.mower;
    const c = this.config;
    if (!c.address) {
      if (c.httpsAsked) {
        return [false, T.https];
      }
      if (c.credentialsInHost) {
        return [false, T.hostCredentials];
      }
      return [false, c.invalidHost ? T.invalidHost(c.invalidHost) : T.noHost];
    }
    if (c.badUser || c.badSecret) {
      return [false, T.badSecret];
    }
    if (c.authMissing) {
      return [false, T.authMissing];
    }
    const pause = this.pauseMessage();
    if (pause) {
      return [false, pause];
    }
    if (this.blocked) {
      return [false, T.refused(age(this.memory.block.until - this.now()))];
    }
    if (m.online === false) {
      const wait = age(m.wait ?? this.interval);
      return [
        false,
        m.error === ERROR_KINDS.UNREACHABLE || m.error === ERROR_KINDS.TIMEOUT
          ? T.unreachable(addressKey(c.address), wait)
          : T.failing(m.error ?? 'error', wait),
      ];
    }
    if (m.online === undefined) {
      const good = this.memory.lastGood;
      if (
        m.timer &&
        good?.address === addressKey(c.address) &&
        this.now() - good.at < TIMINGS.lastGoodMax
      ) {
        // After a restart: the last good read kept in /data, until the next read.
        return [
          true,
          join(T.connected(good.summary), T.lastRead(age(this.now() - good.at))),
          good.summary,
        ];
      }
      return [false, m.timer ? T.waiting(age(Math.max(0, this.due - this.now()))) : T.connecting];
    }
    if (m.error === 'no_id' || !m.data) {
      return [false, join(T.noId, T.noIdHelp)];
    }
    const summary = summaryOf({ ...m.data, name: m.data.name });
    return [true, T.connected(summary), summary];
  }

  /** The connection status of the configuration screen. */
  async updateStatus() {
    const [connected, message, plain] = this.status();
    const orphans = this.mower.id !== undefined ? this.orphans() : [];
    if (orphans.length === 0) {
      await this.setStatus(connected, message);
      return;
    }
    const names = orphans
      .map((id) => {
        const device = (this.gladys.devices ?? []).find(
          (d) => d.external_id === mowerIds(this.gladys, id).device,
        );
        return typeof device?.name === 'string' && device.name !== ''
          ? `${device.name.slice(0, 60)} (${id})`
          : id;
      })
      .join(', ');
    await this.setStatus(false, join(plain ?? message, T.otherMower(names)));
  }

  // --- Gladys ----------------------------------------------------------------

  /** The mower read with a valid id, else undefined. */
  known() {
    const m = this.mower;
    return m.id && m.data ? m : undefined;
  }

  /** The id kept in /data, not read since the start, while it cannot be read: shown offline. */
  keptOffline() {
    const m = this.mower;
    if (!m.id || m.data) {
      return undefined;
    }
    const reading = m.online === undefined && !this.paused && !this.blocked && usable(this.config);
    return reading ? undefined : m.id;
  }

  /** The ids of the devices created in Gladys that are not the mower read (empty during a first read). */
  orphans() {
    const m = this.mower;
    if (m.online === undefined && !this.blocked && !this.paused && usable(this.config)) {
      return [];
    }
    const ids = [];
    for (const device of this.gladys.devices ?? []) {
      const id = parseDeviceId(device?.external_id);
      if (id && id !== m.id && mowerIds(this.gladys, id).device === device.external_id) {
        ids.push(id);
      }
    }
    return ids;
  }

  async publishAll() {
    const generation = this.generation;
    await this.publishDevices();
    if (generation !== this.generation) {
      return;
    }
    this.queueStates();
    await this.flush();
    if (generation !== this.generation) {
      return;
    }
    await this.publishBadge();
    if (generation !== this.generation) {
      return;
    }
    await this.updateStatus();
  }

  async flush() {
    await this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
  }

  async publishDevices() {
    const m = this.known();
    if (!m) {
      return;
    }
    const devices = [
      buildDevice(this.gladys, { id: m.id, name: m.data.name }, { language: this.config.language }),
    ];
    const json = JSON.stringify(devices);
    if (json === this.published) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.published = json;
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  createdFeatures() {
    return new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  queueStates(created = this.createdFeatures()) {
    const push = (id, data, online) => {
      const states = deviceStates(mowerIds(this.gladys, id), data, {
        online,
        language: this.config.language,
      });
      for (const { device_feature_external_id: featureId, ...value } of states) {
        if (created.has(featureId)) {
          this.publisher.push(featureId, value);
        }
      }
    };
    const m = this.known();
    if (m) {
      push(m.id, m.data, m.online !== false && !this.blocked);
    } else if (this.keptOffline()) {
      push(this.keptOffline(), {}, false);
    }
    for (const id of this.orphans()) {
      push(id, {}, false);
    }
  }

  async publishBadge() {
    const created = new Set((this.gladys.devices ?? []).map((d) => d.external_id));
    const entries = [];
    const m = this.known();
    const offlineId = this.keptOffline();
    if (m && created.has(mowerIds(this.gladys, m.id).device)) {
      entries.push({
        external_id: mowerIds(this.gladys, m.id).device,
        transport:
          m.online === false || this.blocked
            ? DEVICE_TRANSPORTS.UNREACHABLE
            : DEVICE_TRANSPORTS.LOCAL,
      });
    } else if (offlineId && created.has(mowerIds(this.gladys, offlineId).device)) {
      entries.push({
        external_id: mowerIds(this.gladys, offlineId).device,
        transport: DEVICE_TRANSPORTS.UNREACHABLE,
      });
    }
    for (const id of this.orphans()) {
      entries.push({
        external_id: mowerIds(this.gladys, id).device,
        transport: DEVICE_TRANSPORTS.UNREACHABLE,
      });
    }
    const json = JSON.stringify(entries);
    if (entries.length === 0 || json === this.badge) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      this.badge = json;
    } catch (err) {
      this.logger.warn(`Transport badge failed: ${err.message}`);
    }
  }

  /** A device was created (or updated): send its last values at once. */
  async deviceCreated(device) {
    this.badge = undefined;
    const created = this.createdFeatures();
    for (const f of device?.features ?? []) {
      created.add(f.external_id);
    }
    this.queueStates(created);
    await this.flush();
    await this.publishBadge();
  }

  async deviceDeleted(device) {
    this.badge = undefined;
    if (typeof device?.external_id === 'string') {
      this.publisher.forget(device.external_id);
    }
  }

  /** The Discovery tab asks for a scan: the device of the last read, sent again (no read). */
  async scan() {
    this.published = undefined;
    await this.publishDevices();
  }

  // --- Configuration button ------------------------------------------------------

  /** A read now, unless the last one is more recent than the interval (then its result). */
  async testConnection() {
    if (!usable(this.config) || this.paused || this.blocked) {
      return this.status()[1];
    }
    const m = this.mower;
    if (!this.serialId) {
      this.versionTried = false;
    }
    const current = () => JSON.parse(this.lastStatus ?? '[false,null]')[1] ?? this.status()[1];
    if (m.running) {
      await m.running;
      return current();
    }
    if (this.now() < this.due) {
      const last = current();
      const waited = T.waiting(age(this.due - this.now()));
      return Number.isFinite(this.lastAttemptAt) && m.online !== undefined
        ? join(join(last, T.lastRead(age(this.now() - this.lastAttemptAt))), waited)
        : waited;
    }
    this.clearTimer();
    await this.tick();
    return current();
  }

  // --- Commands --------------------------------------------------------------------

  refusal(text) {
    return new Error(word(text, this.config.language));
  }

  async setValue(_device, feature, value) {
    // The deadlines count from the arrival of the command, before any wait.
    const received = this.now();
    const target = parseFeatureId(feature?.external_id);
    const command = target ? COMMAND_OF[target.role] : undefined;
    if (!command) {
      throw this.refusal(ERRORS.readOnly);
    }
    // Strictly 1: null, '', true, 0 or "on" never press a button.
    if (value !== PRESSED && value !== String(PRESSED)) {
      throw this.refusal(ERRORS.badButton);
    }
    if (command === COMMANDS.START) {
      return this.startCommand(target.id, received);
    }
    return this.protect(target.id, command, received);
  }

  /**
   * Whether a command for `id` goes to the module at the address: the one
   * read (or kept in /data). A protective command also goes when no mower is
   * known since the start (no id kept) to a device created in Gladys.
   */
  addressed(id, protective) {
    const m = this.mower;
    if (m.id !== undefined) {
      return m.id === id;
    }
    return (
      protective &&
      m.readAt === -Infinity &&
      Boolean(this.config.address) &&
      (this.gladys.devices ?? []).some((d) => d.external_id === mowerIds(this.gladys, id).device)
    );
  }

  /** The fresh read of a command, within `budget` ms; applied when no command left meanwhile. */
  async freshRead(budget) {
    const readStart = this.now();
    const generation = this.generation;
    const status = this.withSerial(
      await this.client.status(this.config.address, this.config.auth, { timeoutMs: budget }),
    );
    if (generation === this.generation && readStart > this.lastSentAt && status.id) {
      if (status.id === this.mower.id || this.mower.id === undefined) {
        this.applyRead(status, { fromCommand: true });
        // Shown in the background: the ack never waits for Gladys.
        this.publishAll().catch((err) => this.logger.warn(`Publishing failed: ${err.message}`));
      }
    }
    return status;
  }

  /** The checks of a start, on the latest configuration (on arrival, and right before sending). */
  checkStart(generation, id, entry) {
    if (!this.config.allowStart) {
      throw this.refusal(ERRORS.startDisabled);
    }
    if (generation !== this.generation || !this.addressed(id, false)) {
      throw this.refusal(ERRORS.unknownMower);
    }
    if (this.mower.readAt === -Infinity) {
      throw this.refusal(ERRORS.notReadYet);
    }
    if (this.paused) {
      const wait = age(this.pausedUntil - this.now());
      throw this.refusal(
        this.memory.pause?.reason === '5xx' ? ERRORS.serverPaused(wait) : ERRORS.paused(wait),
      );
    }
    if (this.blocked) {
      throw this.refusal(ERRORS.blocked);
    }
    if (entry && entry.seq !== this.protectSeq) {
      throw this.refusal(ERRORS.protectMeanwhile);
    }
  }

  async startCommand(id, received) {
    const generation = this.generation;
    this.checkStart(generation, id);
    if (this.startEntry) {
      throw this.refusal(ERRORS.stillRunning);
    }
    const entry = { seq: this.protectSeq, sentAt: undefined, answered: false, promise: undefined };
    this.startEntry = entry;
    entry.promise = this.sendStart(id, received, generation, entry);
    try {
      return await entry.promise;
    } finally {
      entry.answered = true;
      if (this.startEntry === entry) {
        this.startEntry = undefined;
      }
    }
  }

  async sendStart(id, received, generation, entry) {
    const sendBy = received + TIMINGS.commandSendBy;
    const budget = Math.min(TIMINGS.commandReadMax, sendBy - TIMINGS.commandMinSend - this.now());
    if (budget < TIMINGS.commandMinRead) {
      throw this.refusal(ERRORS.tooSlow);
    }
    let fresh;
    try {
      fresh = await this.freshRead(budget);
    } catch (err) {
      if (err.kind === ERROR_KINDS.RATE_LIMITED) {
        await this.pause(err);
        this.updateStatus().catch(() => {});
      }
      throw this.refusal(ERRORS.unknownState(errorReason(err)));
    }
    if (generation !== this.generation) {
      throw this.refusal(ERRORS.unknownMower);
    }
    if (fresh.id === undefined) {
      throw this.refusal(ERRORS.missing);
    }
    if (fresh.id !== id) {
      throw this.refusal(ERRORS.otherModule);
    }
    if (fresh.idFromSerial) {
      // No id in the status: the serial is read again (the start wakes the module anyway).
      const left = Math.min(TIMINGS.commandReadMax, sendBy - TIMINGS.commandMinSend - this.now());
      if (left < TIMINGS.commandMinRead) {
        throw this.refusal(ERRORS.tooSlow);
      }
      let serial;
      try {
        serial = await this.client.version(this.config.address, this.config.auth, {
          timeoutMs: left,
        });
      } catch (err) {
        throw this.refusal(ERRORS.unknownState(errorReason(err)));
      }
      if (serial === undefined) {
        throw this.refusal(ERRORS.missing);
      }
      if (serial !== id) {
        throw this.refusal(ERRORS.otherModule);
      }
    }
    if (fresh.code === undefined || fresh.stopped === undefined || fresh.battery === undefined) {
      throw this.refusal(ERRORS.missing);
    }
    if (!START_ALLOWED.has(fresh.code)) {
      throw this.refusal(ERRORS.cannotStart(statusText(fresh)));
    }
    if (fresh.stopped === false && !this.pauseGuardActive()) {
      // No stop to lift: the mower already follows its mode. Nothing sent, never "success".
      this.logger.info('Robonect: start not sent (the mower is not stopped)');
      throw this.refusal(ERRORS.notStopped(MODE_NAMES[fresh.mode] ?? UNKNOWN_MODE));
    }
    // The option may have been turned off, or a pause pressed, during the read.
    this.checkStart(generation, id, entry);
    if (this.now() > sendBy) {
      throw this.refusal(ERRORS.tooSlow);
    }
    const timeoutMs = Math.max(200, received + TIMINGS.commandAnswerBy - this.now());
    const previous = { sentAt: this.lastSentAt, startAt: this.lastStartAt };
    this.lastSentAt = this.now();
    this.lastStartAt = this.now();
    entry.sentAt = this.now();
    this.logger.info('Robonect: start (lift the stop)');
    try {
      await this.client.command(this.config.address, this.config.auth, COMMANDS.START, {
        startBy: sendBy,
        timeoutMs,
      });
    } catch (err) {
      const reason = errorReason(err);
      this.logger.warn(`Robonect: start failed (${reason})`);
      if (err.kind === ERROR_KINDS.LATE || err.kind === ERROR_KINDS.UNREACHABLE || err.notSent) {
        // Nothing left: the times of the last request and start are as before.
        entry.sentAt = undefined;
        this.lastSentAt = previous.sentAt;
        this.lastStartAt = previous.startAt;
        throw this.refusal(err.kind === ERROR_KINDS.LATE ? ERRORS.tooSlow : ERRORS.notSent(reason));
      }
      if (err.kind === ERROR_KINDS.RATE_LIMITED) {
        await this.pause(err);
        this.updateStatus().catch(() => {});
        throw this.refusal(ERRORS.refused(reason));
      }
      if (
        err.kind === ERROR_KINDS.AUTH ||
        err.kind === ERROR_KINDS.REFUSED ||
        (err.kind === ERROR_KINDS.HTTP && err.status < 500)
      ) {
        // Received and refused. A 401/403 here never blocks the reads.
        this.followUp();
        throw this.refusal(ERRORS.refused(reason));
      }
      // A 5xx, a silence, a broken answer: it may have reached the module.
      this.unconfirmedStartUntil = this.now() + TIMINGS.guard;
      this.followUp();
      throw this.refusal(ERRORS.sentUnconfirmed(reason));
    }
    // Accepted; confirmed only by a read showing the stop lifted.
    this.unconfirmedStartUntil = this.now() + TIMINGS.guard;
    this.followUp();
  }

  /** A start may still land: in flight (sent, not answered), or sent without a read showing it. */
  get startMayLand() {
    return (
      (this.startEntry?.sentAt !== undefined && !this.startEntry.answered) ||
      this.now() < this.unconfirmedStartUntil
    );
  }

  pauseGuardActive() {
    if (this.pauseGuard && this.now() >= this.pauseGuard.until) {
      this.pauseGuard = undefined;
    }
    return Boolean(this.pauseGuard);
  }

  /**
   * PAUSE or HOME: never held back. One request during a pause, a block or
   * before the first read; otherwise a fresh read first (identity), which
   * never holds it back when it fails.
   */
  async protect(id, command, received) {
    if (!this.addressed(id, true)) {
      throw this.refusal(ERRORS.unknownMower);
    }
    // A start not sent yet gives way.
    this.protectSeq += 1;
    const sendBy = received + TIMINGS.commandSendBy;
    const budget = Math.min(TIMINGS.commandReadMax, sendBy - TIMINGS.commandMinSend - this.now());
    const recent = this.now() - this.mower.readAt < TIMINGS.protectReadFresh;
    const oneRequest = this.paused || this.blocked || this.mower.readAt === -Infinity || recent;
    if (!oneRequest && budget >= TIMINGS.commandMinRead) {
      try {
        const fresh = await this.freshRead(budget);
        if (fresh.id !== undefined && fresh.id !== id) {
          throw this.refusal(ERRORS.otherModule);
        }
      } catch (err) {
        if (!err.kind) {
          throw err;
        }
        if (err.kind === ERROR_KINDS.RATE_LIMITED) {
          await this.pause(err);
          this.updateStatus().catch(() => {});
        }
        this.logger.warn(`Robonect: ${command} sent without a fresh read (${errorReason(err)})`);
      }
    }
    if (!this.addressed(id, true)) {
      throw this.refusal(ERRORS.unknownMower);
    }
    const overtaken = this.startEntry;
    const sentAt = this.now();
    this.lastSentAt = sentAt;
    if (command === COMMANDS.PAUSE && this.startMayLand) {
      this.pauseGuard = { sentAt, until: sentAt + TIMINGS.guard, reasserts: 0 };
    }
    this.logger.info(`Robonect: ${command}`);
    const sending = this.client.command(this.config.address, this.config.auth, command, {
      startBy: Infinity,
      timeoutMs: TIMINGS.protectTimeout,
    });
    if (command === COMMANDS.PAUSE && overtaken?.sentAt !== undefined) {
      this.pauseAgain(overtaken, sentAt);
    }
    const answerIn = Math.max(0, received + TIMINGS.commandAnswerBy - this.now());
    let late;
    const outcome = await new Promise((resolve) => {
      late = this.timers.setTimeout(() => resolve({ late: true }), answerIn);
      sending.then(
        () => resolve({ ok: true }),
        (err) => resolve({ err }),
      );
    });
    this.timers.clearTimeout(late);
    this.followUp();
    if (outcome.late) {
      // Still going after the ack (bounded by its own timeout): logged when it ends.
      sending.catch((err) =>
        this.logger.warn(`Robonect: ${command} failed after the ack (${errorReason(err)})`),
      );
      throw this.refusal(
        ERRORS.sentUnconfirmed(
          word(both('no answer yet', 'pas encore de réponse'), this.config.language),
        ),
      );
    }
    if (outcome.err) {
      const err = outcome.err;
      const reason = errorReason(err);
      this.logger.warn(`Robonect: ${command} failed (${reason})`);
      if (err.kind === ERROR_KINDS.UNREACHABLE || err.kind === ERROR_KINDS.LATE || err.notSent) {
        throw this.refusal(ERRORS.notSent(reason));
      }
      if (err.kind === ERROR_KINDS.RATE_LIMITED) {
        await this.pause(err);
        this.updateStatus().catch(() => {});
        throw this.refusal(ERRORS.refused(reason));
      }
      if (
        err.kind === ERROR_KINDS.AUTH ||
        err.kind === ERROR_KINDS.REFUSED ||
        (err.kind === ERROR_KINDS.HTTP && err.status < 500)
      ) {
        throw this.refusal(ERRORS.refused(reason));
      }
      throw this.refusal(ERRORS.sentUnconfirmed(reason));
    }
  }

  /**
   * A pause that overtook a start already sent: sent once more when that
   * start settles (no read, no option check: it repeats a pause decided).
   * A failure keeps the reaffirmation by the reads (the guard).
   */
  pauseAgain(startEntry, pauseAt) {
    const id = this.mower.id;
    startEntry.promise
      .catch(() => {})
      .then(async () => {
        if (this.lastStartAt > pauseAt || this.mower.id !== id) {
          return;
        }
        this.logger.warn('Robonect: pause sent again after the start in flight');
        this.lastSentAt = this.now();
        await this.client.command(this.config.address, this.config.auth, COMMANDS.PAUSE, {
          startBy: Infinity,
          timeoutMs: TIMINGS.protectTimeout,
        });
      })
      .catch((err) => {
        this.logger.warn(`Robonect: pause again failed (${errorReason(err)})`);
        if (!this.pauseGuardActive()) {
          this.pauseGuard = { sentAt: pauseAt, until: this.now() + TIMINGS.guard, reasserts: 0 };
        }
        this.followUp();
      })
      .catch(() => {});
  }

  /** A read through the guards: a start confirmed; a pause reaffirmed if a late start landed. */
  observe(status, { fromCommand = false } = {}) {
    if (status.stopped === false && this.now() < this.unconfirmedStartUntil) {
      // The stop is lifted: the start cannot land any more.
      this.unconfirmedStartUntil = -Infinity;
    }
    if (!this.pauseGuardActive() || status.stopped !== false) {
      return;
    }
    const guard = this.pauseGuard;
    const startInFlight = this.startEntry?.sentAt !== undefined && !this.startEntry.answered;
    if (
      !fromCommand &&
      this.lastStartAt <= guard.sentAt &&
      !startInFlight &&
      guard.reasserts < TIMINGS.pauseReasserts
    ) {
      guard.reasserts += 1;
      this.logger.warn('Robonect: the mower runs again after a pause, pause sent again');
      this.lastSentAt = this.now();
      this.client
        .command(this.config.address, this.config.auth, COMMANDS.PAUSE, {
          startBy: Infinity,
          timeoutMs: TIMINGS.protectTimeout,
        })
        .then(() => this.followUp())
        .catch((err) =>
          this.logger.warn(`Robonect: pause reaffirmed failed (${errorReason(err)})`),
        );
    }
  }

  /**
   * Spaced reads after a command: its effect, then a check. One series
   * pending at a time (a scene pressing in a loop never multiplies them).
   */
  followUp() {
    const generation = this.generation;
    const m = this.mower;
    for (const handle of m.followUps) {
      this.timers.clearTimeout(handle);
    }
    m.followUps.clear();
    for (const delay of TIMINGS.followUps) {
      const handle = this.timers.setTimeout(() => {
        m.followUps.delete(handle);
        if (generation === this.generation && !this.paused && !this.blocked) {
          Promise.resolve(m.running)
            .then(() => this.tick())
            .catch(() => this.logger.error('Robonect refresh failed'));
        }
      }, delay);
      m.followUps.add(handle);
    }
  }
}
