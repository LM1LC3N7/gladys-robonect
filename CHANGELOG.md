# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Robotic mowers fitted with a Robonect module, read over the local JSON API
  of the module (no cloud), with its user name and password (HTTP Basic, plain
  HTTP on the LAN): one device keyed by the id of the module. Distinct from
  gladys-automower (Husqvarna cloud).
- Mower state (vacuum-cleaner category, with its "Return to dock" button),
  status, status code, mode, stopped, battery, charging, error in progress,
  error code and text, time in the status, mowing hours, distance from the
  base, blade quality, Wi-Fi signal, temperature and humidity, next timer
  start, module reachable.
- Pause and back to the base buttons, never held back (option, start in
  flight, 429/5xx pause, refused credentials, before the first read after a
  restart); a start button off by default ("Allow the start from Gladys"),
  decided on a fresh read, checked again right before sending, refused after
  3.5 s; "sent, without confirmation" when a command may have reached the
  module; a pause reaffirmed if a late start lands after it.
- Reads every 60 s (configurable), never sooner than the interval after the
  last one, even after a restart; failures retried after 1 to 15 minutes; 429
  and 5xx pause, refused credentials block (15 min, 1 h, 6 h), all kept in
  `/data` without any secret.
- "Test the connection" button; documentation in English and French;
  `LICENSE` and `THIRD_PARTY_NOTICES.md` shipped in the image.
