#!/bin/sh
# Installs the bridge as a launchd user agent (auto-starts at login, restarts if it dies).
set -e
cd "$(dirname "$0")"
mkdir -p ~/.tweet-qa ~/Library/LaunchAgents
# USER is required — claude finds its Keychain credentials by user, and launchd doesn't set it.
# CLAUDE_CONFIG_DIR from the installing shell (if any) becomes the first login the bridge tries;
# the bridge auto-discovers logged-in dirs under ~/.clawd-accounts/* and ~/.claude and fails over
# to the next one when a login is walled (spend/usage limit, logged out).
CFG="${CLAUDE_CONFIG_DIR:-}"
echo "claude config dir pin: ${CFG:-(none, auto-discover)}"
sed "s|\$PWD|$(cd .. && pwd)|g; s|\$HOME|$HOME|g; s|\$USER|$(id -un)|g; s|\$CLAUDE_CONFIG_DIR|$CFG|g" com.clawd.tweetqa.plist > ~/Library/LaunchAgents/com.clawd.tweetqa.plist
launchctl bootout gui/$(id -u)/com.clawd.tweetqa 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.clawd.tweetqa.plist
sleep 1
curl -sf http://127.0.0.1:8793/health && echo && echo "bridge installed and running"
