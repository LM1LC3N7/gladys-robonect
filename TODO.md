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
  fresh read of every command (no extra request: `version`, which carries a
  serial, wakes the module). An answer without a valid id is never "another
  module": nothing is applied, the status says so; the start refuses it, a
  protective command still goes.
- **Commands as buttons**: start, pause, home are `button/push`; the
  vacuum-cleaner `dock` feature (needed by the card's "Return to dock"
  button) only ever sends "home", which protects. No run-mode select, no
  switch: a "turn everything on" never starts the mower.
- **Start = `cmd=start`** (lifts the stop; the mower then follows its mode).
  It is not sent when the fresh read shows the mower not stopped (nothing to
  lift), unless a pause guard is active. Refused on status 0 (detecting), 7
  (error), 8 (loop lost), 16 (off), on a missing status / stop flag /
  battery, on another id, during a 429/5xx pause or a credential block,
  before the first read after a restart, when another start is in flight,
  when a pause or a home arrived meanwhile, and after 3.5 s.
- **Pause and home are protective and not behind the option**: "never
  blocked" (lot brief). They go during a pause or a block (one request, no
  fresh read), before the first read (the id kept in `/data` with its
  address), and their fresh read never holds them back when it fails; only a
  read showing another id refuses them. Their ack waits 4.3 s at most, then
  "sent, without confirmation" while the request goes on (15 s at most).
- **Home does not lift the stop**: it never sends `start`, whatever the
  state, so a protective path never sends the sensitive command. Unverified
  whether a paused mower then drives home (docs say so).
- **Pause reaffirmation**: a pause sent while a start may still land (sent
  and unanswered, or accepted without a read showing it in the last two
  minutes) is sent again when that start settles, and by the reads of the
  next two minutes if the mower runs again (twice at most), unless a newer
  start left. A failed resend keeps the reaffirmation (the guard).
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
