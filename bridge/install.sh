#!/bin/sh
# Installs the bridge as a launchd user agent (auto-starts at login, restarts if it dies).
set -e
cd "$(dirname "$0")"
mkdir -p ~/.tweet-qa ~/Library/LaunchAgents
# Which claude login the bridge uses: the installing shell's CLAUDE_CONFIG_DIR, else ~/.claude.
# USER is required too — claude finds its Keychain credentials by user, and launchd doesn't set it.
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
echo "claude config dir: $CFG"
sed "s|\$PWD|$(cd .. && pwd)|g; s|\$HOME|$HOME|g; s|\$USER|$(id -un)|g; s|\$CLAUDE_CONFIG_DIR|$CFG|g" com.clawd.tweetqa.plist > ~/Library/LaunchAgents/com.clawd.tweetqa.plist
launchctl bootout gui/$(id -u)/com.clawd.tweetqa 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.clawd.tweetqa.plist
sleep 1
curl -sf http://127.0.0.1:8793/health && echo && echo "bridge installed and running"
