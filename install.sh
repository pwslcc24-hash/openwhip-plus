#!/bin/bash
# OpenWhip (Porter's version) one-step setup. Run:  bash install.sh
set -e
cd "$(dirname "$0")"
DIR="$(pwd)"

if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo "Node.js is needed first. Install it from https://nodejs.org (the LTS button), then run this again."
  exit 1
fi

if [ -z "$SKIP_NPM" ]; then
  echo "Installing (takes a minute)..."
  npm install --no-audit --no-fund
fi
chmod +x hooks/whip-hook.sh start.sh

echo "Hooking into Claude Code..."
DIR="$DIR" node -e '
const fs = require("fs"), os = require("os"), path = require("path");
const f = path.join(os.homedir(), ".claude", "settings.json");
fs.mkdirSync(path.dirname(f), { recursive: true });
let s = {};
if (fs.existsSync(f)) { fs.copyFileSync(f, f + ".bak-openwhip"); s = JSON.parse(fs.readFileSync(f, "utf8") || "{}"); }
s.hooks = s.hooks || {};
const add = (event, arg) => {
  const cmd = "\"" + process.env.DIR + "/hooks/whip-hook.sh\" " + arg;
  const list = s.hooks[event] = s.hooks[event] || [];
  if (JSON.stringify(list).includes(cmd)) return;
  list.push({ hooks: [{ type: "command", command: cmd }] });
};
add("UserPromptSubmit", "start");
add("Stop", "stop");
fs.writeFileSync(f, JSON.stringify(s, null, 2));
'

echo "Starting the whip..."
nohup ./start.sh >/dev/null 2>&1 &
echo
echo "Done! Look for the whip icon in your menu bar."
echo "Start a NEW Claude Code session so it picks up the hook."
echo "If Claude takes longer than 45 seconds on something, the stickman shows up."
echo "To start it again later: bash \"$DIR/start.sh\""
