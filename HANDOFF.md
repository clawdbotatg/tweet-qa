# HANDOFF — tweet-qa

Last updated 2026-09-11 by Claude (Fable 5.1) in a harness session.

## State

- **Shipped to GitHub:** everything (`main` = origin/main after the 0.2.0 commit).
  Remote: https://github.com/clawdbotatg/tweet-qa (public; gitleaks clean, no
  secrets exist in this project by design).
- **Local-only, on clawd's Mac:**
  - Bridge running as launchd agent `com.clawd.tweetqa` (plist installed to
    `~/Library/LaunchAgents/`, log at `~/.tweet-qa/bridge.log`), listening on
    `127.0.0.1:8793`. Reinstall/restart with `sh bridge/install.sh`.
    Reinstalled 2026-09-11 with the login failover below. (A 09-09 note claimed the
    bridge had been installed under a different macOS user; `/Users` has only `clawd`,
    so the "Bridge not running" seen then was something else — most likely the
    installer's bootout/bootstrap restart race, which shows up in `bridge.log` as
    "Address already in use" tracebacks and self-heals via KeepAlive.)
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

## 0.2.0 (2026-09-08, second session): generic detection

Austin tweets from **Media Studio** (`studio.x.com/producer/...`), whose composer
is a plain `<textarea class="... FormTextarea" placeholder="What's happening?">`
with no `data-testid`, so 0.1.0 said "no composer". `page.js` now runs a priority
chain — X composer → selected text → focused text box → biggest visible text box
(ranks 0–3) — and `popup.js` runs it in **all frames** (falls back to the main
frame if Chrome refuses) and keeps the lowest rank. The x.com URL gate is gone;
any http(s)/file page is fair game. `readDraft` stashes the element (+ range for
selections) on `window.__tweetqa` in the frame's isolated world; `writeDraft(text)`
reads it back, so no more index passing. Selections inside a text box are replaced
in place; selections in plain page text are read-only (popup shows **Copy fix**).
Verified: detection on the live Media Studio tab (read-only, via the clawd-browser
bridge on port 8765); write paths on a scratch `about:blank` tab (textarea span,
whole textarea, contenteditable span, biggest-box fallback, composer precedence).
**Not** verified end to end through the actual popup click — Austin still has to
load/reload the unpacked extension (manifest version bumped, so a reload at
`chrome://extensions` is required if it was already loaded).

## 0.2.1 (2026-09-11): "claude exited 1:" fixed

The popup showed `claude exited 1:` with nothing after the colon. Two causes, both in
how the launchd agent runs `claude`:

1. **launchd sets no `USER`**, and claude looks up its keychain login by `$USER`, so
   every config dir reported "Not logged in · Please run /login". The plist now sets
   `USER` (`install.sh` substitutes it). Symptom to remember: `claude auth status`
   says logged in from a shell but not from launchd.
2. With `USER` set, claude's default `~/.claude` login **is** found, but that account
   has hit its monthly spend limit. The bridge now resolves an ordered list of logged-in
   config dirs (`TWEET_QA_CLAUDE_CONFIG_DIR` → `~/.clawd-accounts/*` → `~/.claude`) via
   `claude auth status`, and on a limit/login wall fails over to the next one and stays
   there. It logs the list and every failover to `bridge.log`.

The error message was blank because claude puts the reason in the JSON `result` on
stdout and leaves stderr empty; `run_claude` now surfaces stdout first.

## Gotchas

- **launchd env (2026-09-09).** `claude -p` under launchd said "Not logged in" even
  though it works from a shell. Two vars are needed and the plist now sets both:
  `USER` (claude finds its Keychain credentials by user; launchd doesn't set it) and
  a login dir (this Mac's logins live in `~/.clawd-accounts/<name>`, not `~/.claude`).
  Since 09-11 the dir is no longer a hard pin: `install.sh` passes the installing
  shell's `CLAUDE_CONFIG_DIR` (if any) as `TWEET_QA_CLAUDE_CONFIG_DIR`, the first
  login to try; the bridge then fails over as described in 0.2.1. Note the 09-09
  fix never reached the running process: this checkout was still at 0.2.0 on disk
  (launchd runs `bridge.py` straight from the working tree), which is why the popup
  kept showing the blank "claude exited 1:" — **after `git pull`, rerun
  `sh bridge/install.sh`**, or the box keeps serving the old file.
- The bridge scrubs `ANTHROPIC_BASE_URL` too: a harness shell points it at a
  per-session tee proxy, and `bridge.py --once` from such a shell would route
  through it.

- Port 8791 was taken by an unrelated Python process on this Mac, hence **8793**.
  The port is hardcoded in three places: `bridge/bridge.py`, `extension/manifest.json`
  (`host_permissions`), `extension/popup.js`.
- Chrome kills popup scripts when the popup closes → a check in flight is lost.
  If that annoys Austin, move the fetch into a service worker and have the popup
  poll `chrome.storage` (not done; "very very simple" was the brief).
- x.com/compose/post has two composer boxes — the second is the hidden inline
  home composer. Focused-or-first-non-empty selection handles it.
- "Biggest text box" fallback (rank 3) is a guess; on a page with a large unrelated
  editor it could pick the wrong thing. The popup always shows the text it read and
  its source, so a wrong pick is visible; selecting the draft overrides it (rank 1).
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
