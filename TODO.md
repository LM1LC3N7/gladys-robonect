# TODO — Robonect v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm run audit`, `npx github:GladysAssistant/integration-store .`,
  then update README, `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- No forum topic of its own, no forum post from a module session: the batch
  reserved in /t/10385 (lot 12) gets one recap message there.
- The `gladys-assistant-integration` topic is added at the first real release only.

## Status

- [x] **Milestone 1 — core** (2026-10-21): one module by IP address, user
      name and password (HTTP Basic), one device per module id, status read
      every interval (never sooner, even after a restart), state on the
      vacuum-cleaner category, status, mode, battery, error, hours, Wi-Fi,
      blades, climate, next timer start; pause, back to the base (and the
      dock feature) never held back; start behind `allow_start` (off),
      decided on a fresh read; 429/5xx pauses and credential blocks
      persisted; test button; docs en/fr; cover. Tested against made-up
      answers only. The store validator was not run by the dev session (it
      needs the real terminal).
- [x] **Review 1 fixes** (2026-10-21): start on an allow list of statuses
      (I1), id rule without ":" and "-" and the cmd=version serial when the
      status has no id (I2), M1-M9 (see Decisions). Tests in
      `test/review1.test.js`.
- [x] **Review 2 fixes** (2026-10-21): cmd=version tried again, spaced and
      bounded (R-A), another serial before a start forgotten (R-B), one write
      to /data per read (R-C). Tests "Review 2" in `test/review1.test.js`.
- [ ] **Milestone 2 — real module**: run against a real Robonect (see "To
      check"), turn the answers (anonymized) into fixtures.
- [ ] **Milestone 3 — more**: mode select (Auto, Manual, End of day) behind
      the option, timers, GPS position, several modules, HTTPS with a pinned
      certificate, MQTT push instead of polling.

## To check on a real module

- That the status answer has a stable top-level `id` (ioBroker.robonect reads
  it; aiorobonect does not) and what it is (MAC, serial).
- That `cmd=stop` sets `status.stopped` to true at once, and `cmd=start`
  back to false; how long the module takes to answer over Wi-Fi (the start
  needs a fresh read within 2 s).
- Whether `cmd=mode&mode=home` drives a stopped (paused) mower home, or
  whether the stop must be lifted too (documented as unverified).
- Whether a sleeping module (status 17) answers `status` quickly, and
  whether a command wakes it.
- The time zone of `timer.next.unix` (Home Assistant reads it as local time
  written as UTC; so does this integration).

## Decisions

- **Version 0.1.0 set by hand** in `package.json`, `package-lock.json`, the
  manifest and `docker_image` (`ghcr.io/lm1lc3n7/gladys-robonect:0.1.0`); the
  first patch release gives 0.1.1.
- **Reference**: aiorobonect 1.3.1 (MIT, LICENSE file read; PyPI classifier
  says Apache) and the Home Assistant integration geertmeersman/robonect (MIT)
  for the field paths; ioBroker.robonect's mapping only confirmed the
  top-level `id` (nothing copied). Credited in `THIRD_PARTY_NOTICES.md`.
- **Distinct from gladys-automower** (Husqvarna cloud API, no module): said
  in the manifest, README and both docs.
- **Identity**: the `id` of the status answer, read at every poll and in the
  fresh read of every command. FROZEN RULE (it makes the external ids):
  trimmed, ":" and "-" removed (a MAC `00:1A:2B:3C:4D:5E` gives
  `001a2b3c4d5e`), lower case, 1-64 of [0-9a-z_.]. When the status has no
  id (openHAB's fixtures of 2017 firmwares have none), the `serial` of
  `cmd=version` (Home Assistant's identity) is read at the first read
  without id; when it fails it is tried again after 15 min, 1 h, then every
  6 h, never sooner than the interval (the test button allows one more try
  at its read); a 429 or a 5xx on it pauses every read like on the status
  (kept in /data); a 401 on it only spaces its tries (the status was just
  accepted with the same credentials: never a block nor a loop). The status
  then says "serial number unreadable (reason), next try in X, or Test the
  connection". Once read, it is kept in `/data` with the address, and read
  again before every start (which wakes the module anyway); never at every
  poll (`version` wakes a sleeping module). An answer without any id is
  never "another module". Without `id`, the identity is checked again only
  before a start (the reads attach the serial kept): when the start reads
  another serial, it is refused and the serial is forgotten in memory and in
  /data, so the next read identifies the module again (the first device is
  then "not read any more", never fed the other module's state past that
  read). Without any id: nothing is applied, the status says so and asks
  for an issue with the anonymized `/json?cmd=status`; the start refuses
  it, a protective command still goes.
- **Commands as buttons**: start, pause, home are `button/push`; the
  vacuum-cleaner `dock` feature (needed by the card's "Return to dock"
  button) only ever sends "home", which protects. No run-mode select, no
  switch: a "turn everything on" never starts the mower.
- **Start = `cmd=start`** (lifts the stop; the mower then follows its mode).
  It is not sent, and the ack is a failure ("nothing to lift", with the
  mode), when the fresh read shows the mower not stopped, unless a pause
  guard is active. Allow list of statuses: 1 parked, 2 mowing (stopped on
  the lawn), 3 and 5 searching, 4 charging, 17 sleeping, 18 garage door; any
  other code refuses (0, 7, 8, 16, 98 "offline, cannot bind", 99 unknown,
  undocumented codes); refused too on a missing status / stop flag /
  battery, on another id, during a 429/5xx pause or a credential block,
  before the first read after a restart, when another start is in flight,
  when a pause or a home arrived meanwhile, and after 3.5 s.
- **Pause and home are protective and not behind the option**: "never
  blocked" (lot brief). They go during a pause or a block (one request, no
  fresh read), before the first read (the id kept in `/data` with its
  address), and their fresh read never holds them back when it fails; only a
  read showing another id refuses them. No identity read when the module
  was read in the last 10 s (a scene pressing in a loop); a configuration
  saved during their fresh read never refuses them (the id kept for the
  address). Their ack waits 4.3 s at most, then
  "sent, without confirmation" while the request goes on (15 s at most).
- **Home does not lift the stop**: it never sends `start`, whatever the
  state, so a protective path never sends the sensitive command. Unverified
  whether a paused mower then drives home (docs say so).
- **Pause reaffirmation**: a pause sent while a start may still land (sent
  and unanswered, or accepted without a read showing it in the last two
  minutes) is sent again when that start settles, and by the reads of the
  next two minutes if the mower runs again (twice at most), unless a newer
  start left. A failed resend keeps the reaffirmation (the guard).
- **A start that never left** (late, unreachable) gives back the times of
  the last request and start, so it never cuts the reaffirmation of a pause.
- **Error code** only from the `error` object of the status (0 when no
  error); never the status code.
- **HTTPS refused**: an address typed with `https://` gives a fixed status
  and sends nothing (never quietly turned into clear HTTP).
- **A block kept without credentials** (`refused: null`) is lifted at the
  start once credentials are configured.
- **After a restart**, while the first read waits for the interval, the
  status says "connected" with the summary of the last good read kept in
  `/data` (same address, less than 2 h old, written at most once a minute);
  the wait in memory is capped at the interval (a clock set back).
- **One write to /data per read**: the time of the read (at most once a
  minute), the last good read, the id read, the block lifted are set in
  memory and written together at the end of the read; a pause or a block
  already written in the read covers them.
- **Deadline before writing**: `src/robonect/http.js` opens the TCP
  connection first and writes the request only if the deadline has not
  passed, so a slow connection never sends a start late.
- **Never a read sooner than the interval**: the time of the last read is
  kept in `/data`, written at most once a minute; after a restart the first
  read waits for `last + 1 min + interval` (capped at the interval). A new
  address or new credentials read at once. The test button shows the last
  read when it is more recent than the interval. Follow-up reads after a
  command (10 s, 40 s) are the only exception.
- **Refused credentials**: block 15 min, 1 h, 6 h in `/data` with a salted
  SHA-256 fingerprint of the refused credentials only (erased at the first
  accepted read), so other credentials lift it after a restart; a 401/403
  on a command never blocks the reads.
- **HTTP only**: aiorobonect falls back to HTTPS; not kept (no certificate
  pinning in v1). The password travels in clear on the LAN, said in the
  docs.
- **Units**: only those of `DEVICE_FEATURE_UNITS_BY_CATEGORY`: battery %,
  duration minutes/hours, distance-sensor m, maintenance %, temperature °C,
  humidity %. The Wi-Fi signal (dBm) is an `unknown` sensor, its unit in its
  name.
- **No scene trigger, no widget, no energy** in v1.
