# HANDOFF — tweet-qa

Last updated 2026-09-09 by Claude (Fable 5.1) in a harness session.

## State

- **Shipped to GitHub:** everything (`main` = origin/main after the 0.2.0 commit).
  Remote: https://github.com/clawdbotatg/tweet-qa (public; gitleaks clean, no
  secrets exist in this project by design).
- **Local-only, on clawd's Mac:**
  - Bridge running as launchd agent `com.clawd.tweetqa` (plist installed to
    `~/Library/LaunchAgents/`, log at `~/.tweet-qa/bridge.log`), listening on
    `127.0.0.1:8793`. Reinstall/restart with `sh bridge/install.sh`.
    **Installed for the `austingriffith` user on 2026-09-09** (the 09-08 install was
    under a different user account, so Chrome's popup saw "Bridge not running").
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

## Gotchas

- **launchd env (2026-09-09).** `claude -p` under launchd said "Not logged in" even
  though it works from a shell. Two vars are needed and the plist now sets both:
  `USER` (claude finds its Keychain credentials by user; launchd doesn't set it) and
  `CLAUDE_CONFIG_DIR` (this Mac's logins live in `~/.clawd-accounts/<name>`, not
  `~/.claude`). `install.sh` bakes in the installing shell's `CLAUDE_CONFIG_DIR`
  (falls back to `~/.claude`) and prints which one — currently `ef`. To switch
  accounts: `CLAUDE_CONFIG_DIR=~/.clawd-accounts/<name> sh bridge/install.sh`.
  Working accounts at install time: clawd, ef, sub4 (others: expired OAuth or spend
  limit). Symptom in the popup was "claude exited 1:" with nothing after the colon;
  the bridge now reports claude's own message ("Not logged in", "OAuth session
  expired", spend limit) instead.
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
