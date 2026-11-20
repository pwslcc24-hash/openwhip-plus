#!/bin/bash
# Claude Code hook. "start" (prompt submitted) begins a timer; "stop" (Claude done) ends the scene.
# After DELAY seconds of work the stickman appears. The file gets the elapsed seconds every REPEAT
# seconds so the app can escalate (helpers, then planes) the longer Claude takes.
DELAY=${WHIP_DELAY:-45}
REPEAT=${WHIP_REPEAT:-15}
DIR="$HOME/.badclaude"; mkdir -p "$DIR"
PIDF="$DIR/timer.pid"
kill_timer() { [ -f "$PIDF" ] && pkill -P "$(cat "$PIDF")" 2>/dev/null; [ -f "$PIDF" ] && kill "$(cat "$PIDF")" 2>/dev/null; rm -f "$PIDF"; }
cat >/dev/null  # drain hook JSON
kill_timer
if [ "$1" = "start" ]; then
  START=$(date +%s)
  ( sleep "$DELAY"; while true; do echo $(( $(date +%s) - START )) > "$DIR/whip"; sleep "$REPEAT"; done ) >/dev/null 2>&1 &
  echo $! > "$PIDF"
else
  echo stop > "$DIR/whip"
fi
exit 0
