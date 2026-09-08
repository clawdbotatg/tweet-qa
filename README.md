# tweet-qa

One-click "is there anything glaringly wrong with this tweet?" Chrome extension.

Draft a tweet on x.com (or Media Studio, or anywhere), click the extension icon, and it asks **Fable** (Claude,
via the `claude` CLI) or **GPT** (via the `codex` CLI) whether the tweet has any
glaring content / spelling / grammar problems. It is told *not* to nitpick style.
If there are problems it shows a minimally edited version and an **Apply fix**
button that rewrites the draft in the composer on the page.

Both engines run through their CLIs, so this bills your subscriptions, not an API key.

## Parts

- `extension/` — Manifest V3 Chrome extension. Popup does all the work: finds the
  text (see below), POSTs to the bridge, shows the verdict, and on Apply replaces
  the text in place with `execCommand('insertText')` (React-safe fallbacks for
  textareas, synthetic paste for rich editors).
- `bridge/bridge.py` — stdlib-only localhost HTTP server on **127.0.0.1:8793**.
  `POST /check {"engine":"claude"|"codex","text":...}` shells out to
  `claude -p --model claude-fable-5-1` or `codex exec` (codex's default model,
  currently gpt-6-astra) and returns `{ok, issues, suggested, engine, model}`.
  Must run on the same machine as Chrome.

## Setup

1. Bridge, as a launchd user agent (auto-starts at login, restarts on crash):
   ```sh
   sh bridge/install.sh
   ```
   Or just run it in a terminal: `python3 bridge/bridge.py`. Logs: `~/.tweet-qa/bridge.log`.
2. Extension: `chrome://extensions` → Developer mode → **Load unpacked** → pick the
   `extension/` folder. Pin the icon.
3. Draft a tweet on x.com, click the icon. Toggle Fable / GPT in the popup header
   (the choice is remembered).

## Knobs (env vars for the bridge)

| var | default | |
|---|---|---|
| `TWEET_QA_PORT` | `8793` | also change in `extension/manifest.json` + `popup.js` |
| `TWEET_QA_CLAUDE_MODEL` | `claude-fable-5-1` | |
| `TWEET_QA_CODEX_MODEL` | *(codex default)* | pass to force a specific GPT |
| `TWEET_QA_TIMEOUT` | `150` | seconds per check |

The prompt lives at the top of `bridge/bridge.py`; that's where to tune what counts as "glaring".

Smoke test without the browser:
```sh
printf 'we are goign to devcon' | python3 bridge/bridge.py --once claude
```

## What it checks

The popup looks for text in this order, in every frame of the tab, and takes the
first hit (the status line says which one it used):

1. **X's tweet composer** (`[data-testid^="tweetTextarea_"]`) — the focused box,
   else the first non-empty one.
2. **Selected text** — anywhere on the page. If the selection is inside a text
   box only that span gets replaced on Apply; if it's in plain page text you get
   a **Copy fix** button instead.
3. **The focused text box** (textarea, input, or contenteditable) if it has text.
4. **The biggest visible text box** on the page.

So in Media Studio (a plain textarea, no `data-testid`) it just works, and on any
odd UI you can select the draft and click the icon.

## Notes

- Keep the popup open until the verdict lands; closing it cancels the check
  (Chrome kills popup scripts on close).
- If a check finds several composer boxes (a thread), it checks the focused one,
  else the first non-empty one.
- The Apply path was verified against X's Draft.js composer on 2026-09-08, and
  the textarea / selection / contenteditable paths against a scratch page the
  same day (detection also verified read-only on a live Media Studio draft).
