# HANDOFF — tweet-qa

Last updated 2026-09-08 by Claude (Fable 5.1) in a harness session.

## State

- **Shipped to GitHub:** everything. `main` @ `45ad13b` = origin/main, tree clean.
  Remote: https://github.com/clawdbotatg/tweet-qa (public; gitleaks clean, no
  secrets exist in this project by design).
- **Local-only, on clawd's Mac:**
  - Bridge running as launchd agent `com.clawd.tweetqa` (plist installed to
    `~/Library/LaunchAgents/`, log at `~/.tweet-qa/bridge.log`), listening on
    `127.0.0.1:8793`. Reinstall/restart with `sh bridge/install.sh`.
  - The Chrome extension has **NOT** been loaded into Chrome yet. Austin has to:
    `chrome://extensions` → Developer mode → Load unpacked →
    `/Users/clawd/clawd-harness/projects/tweet-qa/extension`, then pin it.

## What was built (one session, from an empty repo)

- `extension/` — MV3 popup-only extension. On open: reads the X composer via
  `chrome.scripting.executeScript` (functions in `page.js`, selector
  `[data-testid^="tweetTextarea_"][contenteditable="true"]`), POSTs to the bridge,
  renders verdict; **Apply fix** does focus → `execCommand('selectAll')` →
  `execCommand('insertText')` and verifies by reading the box back.
- `bridge/bridge.py` — stdlib HTTP server. `claude` path: `claude -p --model
  claude-fable-5-1 --output-format json --tools "" --no-session-persistence`, prompt
  on stdin, cwd `~/.tweet-qa/work` (empty dir so no CLAUDE.md leaks in), env
  scrubbed of `CLAUDECODE`/`CLAUDE_CODE_*`/`ANTHROPIC_API_KEY`. `codex` path:
  `codex exec --skip-git-repo-check --ephemeral -s read-only -o <file> -`, no `-m`
  so it uses codex's default (gpt-6-astra as of today).
- Verified: both engines return correct JSON; read + Apply exercised against X's
  real Draft.js composer in Chrome (@austingriffith account, test draft cleared,
  Post never touched).

## Gotchas

- Port 8791 was taken by an unrelated Python process on this Mac, hence **8793**.
  The port is hardcoded in three places: `bridge/bridge.py`, `extension/manifest.json`
  (`host_permissions`), `extension/popup.js`.
- Chrome kills popup scripts when the popup closes → a check in flight is lost.
  If that annoys Austin, move the fetch into a service worker and have the popup
  poll `chrome.storage` (not done; "very very simple" was the brief).
- `readDraft` reports `count: 2` on x.com/compose/post — the second box is the
  hidden inline home composer. Focused-or-first-non-empty selection handles it.
- Codex prints a harmless "clamping SessionEnd hook timeout" warning to stderr.
- Calibration difference observed: Fable let a lowercase casual "its" slide, GPT
  flagged it. The prompt (top of `bridge.py`) is the only place to tune that.
- Bridge must run on the same machine as the Chrome that has the extension.

## Next steps

1. Austin loads the unpacked extension (path above) and tries it on a real draft.
2. If verdicts feel too strict/lenient, edit `PROMPT` in `bridge/bridge.py`; the
   launchd agent does **not** auto-reload — rerun `sh bridge/install.sh`.
3. Optional follow-ups only if asked: background service worker for popup-close
   resilience; thread (multi-box) support; a "suggest improvements" button.
