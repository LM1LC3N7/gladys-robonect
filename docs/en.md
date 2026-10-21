# Robonect for Gladys

This integration shows a **robotic mower fitted with a Robonect module**
(Husqvarna Automower, Gardena, Flymo, McCulloch) in Gladys, through the local
JSON API of the module, without any cloud. **Never tested with a real
device.** Not affiliated with Robonect, Husqvarna, Gardena nor Flymo.

> **This is not the gladys-automower integration.** gladys-automower goes
> through the Husqvarna cloud (Husqvarna account, connected Automower
> robots). This one talks directly to the Robonect module, a board added
> inside the mower, on your local network. If your mower has no Robonect
> module, it is of no use to you.

## What you get

One mower in the Discovery tab, with:

- **Mower state** (Gladys' "robot vacuum" card: mowing, paused, returning to
  the base, charging, docked, error, stopped) and a **Return to the base**
  button on that card;
- **Status** as text ("Mowing", "Charging", "Mowing (stopped)"...), status
  code, **mode** (Auto, Manual, Home, End of day...), stopped (paused);
- **battery**, charging;
- **error in progress**, error code and text;
- time in the status, **mowing hours**, distance from the base, blade
  quality, Wi-Fi signal (dBm), temperature and humidity inside the mower,
  next start of the timer, module reachable;
- three buttons: **Pause** (stop where it is), **Back to the base** and
  **Start** (lift the stop).

## Setup

1. Give the Robonect module a **fixed IP address** in your router.
2. In Gladys, open the Robonect integration and enter the IP address of the
   module, its **user name** and **password** (those of its web interface).
   Leave both empty only if the module has no login.
3. Save, then add the mower from the **Discovery** tab.

The password is kept by Gladys in its database, never shown again, sent only
to the module. It travels **in clear** (HTTP Basic authentication, over
HTTP) on your local network: that is how the module works. It is never
written to the logs nor to `/data`.

The module is read every 60 s (30 s to 1 h), **never more often**, even after
a restart of the integration, a reconnection to Gladys, the "Test the
connection" button or a Discovery scan. Only the `status` command, which
does not wake a sleeping module, is sent for these reads.

## The commands

- **Pause** (stop where it is, Robonect's `stop` command) and **Back to the
  base** ("Home" mode) are **always available**: never held back by the
  option, a start in progress, a pause of the integration (HTTP 429 or 5xx)
  or refused credentials, and possible right after a restart, before the
  first read. They cancel a start not sent yet.
- **Start** is **off by default**. Turn on "Allow the start from Gladys" to
  use it. It lifts the stop of the mower, which then mows **according to its
  mode** (Auto: following its timer; Home: it stays at the base). Before
  sending, the integration reads the mower again and refuses if the module
  does not answer fast enough, a value is missing, another module answers at
  this address, the mower is not stopped (nothing to lift: the answer is a
  failure, nothing is sent), or its status is not one of: parked, mowing
  (stopped), looking for its base, charging, searching, sleeping, waiting
  for the garage door. Any other status (error, off, offline, unknown...)
  refuses. **Check that
  nobody, child or pet, is on the lawn.**
- No command is a switch: a "turn everything on/off" (voice assistants,
  scenes) can never start the mower.
- If the module does not answer in time, the answer is "Command sent,
  without confirmation": check the state a few seconds later. A pause sent
  while a start could still land is sent again if the mower runs again
  (twice at most, within two minutes).
- Back to the base changes the mode; if the mower was paused (stopped), it
  may stay where it is until the stop is lifted: to be checked on a real
  module.

## Troubleshooting

- "No answer": check the address, and that the module is on the Wi-Fi (it
  may be out of range at the far end of the garden). New tries 1 to 15
  minutes apart.
- "Credentials refused": fix the user name or the password and save.
  Otherwise, new try after 15 min, 1 h, then every 6 h, even after a
  restart.
- **The mower does not show up in Discovery** ("without a valid id"): the
  integration identifies the module by the `id` field of its `status`
  answer (":" and "-" removed, for a MAC address for instance), otherwise,
  by the serial number of `cmd=version` (tried again after 15 min, 1 h,
  then every 6 h when unreadable, or with the "Test the connection" button). If that is not enough, open
  an issue on the GitHub repository with the anonymized answer of
  `http://<module>/json?cmd=status`.
- `https://` in the address is refused: this version speaks plain HTTP only
  (the password travels in clear on the local network); enter the address
  without `https://`.
- "Not read any more": another module answers at this address (IP address
  given to another device), or the mower was removed.

## Limits

- One mower per integration; HTTP only (no HTTPS).
- No timers, mode choice, GPS nor MQTT in this version.
- Never tested with a real device: the fields come from the aiorobonect
  library and the Robonect integration for Home Assistant.
