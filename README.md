# OpenWhip Plus

A little widget that whips Claude when he's slow. Built on top of [OpenWhip](https://github.com/GitFrog1111/OpenWhip) by GitFrog1111 (MIT).

## What it does

- **Auto-whip.** A Claude Code hook starts a timer when you send a prompt. If Claude is still working after **45 seconds**, a stickman shows up and starts whipping.
- **It escalates the longer Claude takes:**
  - 45s: the stickman appears
  - 90s: reinforcements arrive
  - 180s: planes
  - 300s+: airstrike and the MEGA attack
- **It stops** the moment Claude finishes.
- **Manual whip.** Click the menu bar icon to whip him yourself. It sends Ctrl-C and one of 5 encouraging messages.

## Install (Mac)

Needs [Node.js](https://nodejs.org) (the LTS version).

```bash
git clone https://github.com/pwslcc24-hash/openwhip-plus.git
cd openwhip-plus
bash install.sh
```

Then start a **new** Claude Code session. The installer adds two hooks to `~/.claude/settings.json` (it saves a backup first) and launches the whip. To start it again later: `bash start.sh`.

Prefer to let Claude do it? Paste this into Claude Code:

> Clone https://github.com/pwslcc24-hash/openwhip-plus, cd into it, run `bash install.sh`, and tell me when the whip is running. Then remind me to start a new Claude Code session.

## Tweaks

Set these before a session to change the timing:

- `WHIP_DELAY` (default `45`): seconds before the stickman appears
- `WHIP_REPEAT` (default `15`): seconds between escalation pings

## Credits

Original OpenWhip by [GitFrog1111](https://github.com/GitFrog1111/OpenWhip). The stickman scene, escalation, and one-step installer are added here. MIT licensed.
