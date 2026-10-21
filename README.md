# gladys-robonect

[Gladys Assistant](https://gladysassistant.com) external integration for
**robotic lawn mowers fitted with a Robonect module** (Husqvarna Automower,
Gardena, Flymo, McCulloch), through the local JSON API of the module: state,
mode, battery, error, mowing hours, Wi-Fi signal, blades, next timer start;
pause and back to the base always available; start behind an off-by-default
option. **Never tested with a real device. Not affiliated with Robonect.**

Not to be confused with
[gladys-automower](https://github.com/LM1LC3N7/gladys-automower), which uses
the Husqvarna cloud and needs no module: this one talks to the Robonect board
inside the mower, on the local network only.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (RobonectApp)
                                  ├─ src/robonect/client.js  JSON API, parsing (own fields, exact types)
                                  ├─ src/robonect/http.js    the only network access (node:net + node:http, bounded)
                                  ├─ src/devices.js          the device and its states (pure)
                                  ├─ src/publisher.js        states within 300/min
                                  └─ src/store.js            /data/robonect-state.json (no secret)
```

- **Credentials**: the user name and password of the module, in HTTP Basic
  authentication over plain HTTP (aiorobonect's fallback to HTTPS is not
  kept: it would send the password to an unchecked certificate). Refused
  credentials block the tries for 15 min, 1 h, then 6 h, kept in `/data`
  with only a salted fingerprint of the refused credentials (erased at the
  first accepted read), so other credentials lift the block after a restart.
- **Reads**: `GET /json?cmd=status` (the command that never wakes a sleeping
  module) every 60 s (30 s – 1 h), never sooner than the interval after the
  last one: the time is kept in `/data` (written at most once a minute), so
  a restart, a reconnection to Gladys, the test button, a Discovery scan or a
  configuration saved unchanged never read earlier. Failures retried after
  1, 2, 5, 15 min; 429 and 5xx pause, kept in `/data`. An answer for an old
  configuration publishes nothing.
- **Device**: `ext:<selector>:robonect:<id>` (the `id` of the status answer,
  lower case), never the IP address, checked at every read and before every
  command. The state uses the core's `vacuum-cleaner` category (like
  gladys-automower and gladys-bosch-indego), with its `dock` feature.
- **Commands**: three `button/push` features, never a switch nor a writable
  binary. **Start** (`cmd=start`, lifts the stop) is off by default
  (`allow_start`), checked again right before sending, decided on a fresh
  read only (refused on an error, a missing value or another module), sent
  within 3.5 s of the click (the deadline is checked once the TCP connection
  is up, before writing) or refused unsent, answered by 4.3 s. **Pause**
  (`cmd=stop`) and **Back to the base** (`cmd=mode&mode=home`, also the
  `dock` feature) are never held back (option, start in flight, pause,
  block, failed read, no read yet after a restart: the id is kept in
  `/data`), outside any queue, and cancel a start not sent yet; a pause that
  overtook a start already sent is sent again when it settles, and
  reaffirmed twice at most by the reads of the next two minutes. "Sent,
  without confirmation" whenever a command may have reached the module.
- **Hostile answers**: 32 KB at most, copied into one buffer, only own fields
  read with their exact type, no answer text in the logs.

## Credits

The commands, fields and status codes are ported from
[aiorobonect](https://github.com/geertmeersman/aiorobonect) and the
[Robonect integration for Home Assistant](https://github.com/geertmeersman/robonect)
(Geert Meersman, MIT). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Modelled on the sibling integrations
[gladys-peblar](https://github.com/LM1LC3N7/gladys-peblar) (local HTTP,
guarded commands) and
[gladys-bosch-indego](https://github.com/LM1LC3N7/gladys-bosch-indego)
(mower on the vacuum-cleaner category).

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit                                   # npm audit --omit=dev
npm run cover                                   # cover.png, plain Node
npx github:GladysAssistant/integration-store .  # store admission checks
```

Tests never touch the network: the module is a fake behind the injected
transport, Gladys is the SDK's fake; `test/client.test.js` runs the real
transport against a loopback server.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0 (`LICENSE`). The ported logic comes from MIT projects, credited in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) (also shipped in the Docker
image).
