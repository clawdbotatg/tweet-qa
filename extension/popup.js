const BRIDGE = 'http://127.0.0.1:8793';
const $status = document.getElementById('status');
const $detail = document.getElementById('detail');
const $engine = document.getElementById('engine');
const NAMES = { claude: 'Fable', codex: 'GPT' };

let engine = 'claude';
let tab, draft, verdict;

function setStatus(cls, html) { $status.className = cls; $status.innerHTML = html; }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function paintEngine() { for (const b of $engine.querySelectorAll('button')) b.classList.toggle('on', b.dataset.e === engine); }

async function inject(func, args = []) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args });
  return r && r.result;
}

async function run() {
  verdict = null; $detail.innerHTML = '';
  setStatus('working', '<span class="spin"></span>Reading the page…');
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/^https:\/\/(x|twitter)\.com\//.test(tab.url || '')) {
      return setStatus('err', 'Open a tweet draft on x.com first.');
    }
    draft = await inject(readDraft);
    if (!draft || draft.error) return setStatus('err', esc(draft?.error || 'Could not read the tweet.'));
  } catch (e) {
    return setStatus('err', 'Could not read the page: ' + esc(e.message));
  }

  setStatus('working', `<span class="spin"></span>Asking ${NAMES[engine]} for glaring problems…`);
  $detail.innerHTML = `<pre>${esc(draft.text)}</pre>`;
  let res;
  try {
    const r = await fetch(BRIDGE + '/check', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine, text: draft.text }),
    });
    res = await r.json();
    if (!r.ok || res.error) throw new Error(res.error || `bridge HTTP ${r.status}`);
  } catch (e) {
    const hint = /Failed to fetch/.test(e.message) ? 'Bridge not running? Start it: <code>python3 bridge/bridge.py</code>' : esc(e.message);
    return setStatus('err', '⚠️ ' + hint);
  }
  verdict = res;
  const who = `<div class="dim">${esc(NAMES[engine])} · ${esc(res.model || '')}</div>`;
  if (res.ok) {
    setStatus('good', '✅ No glaring problems. Send it.' + who);
    $detail.innerHTML = `<div class="row"><button class="btn ghost" id="again">Check again</button></div>`;
  } else {
    const items = res.issues.map((i) => `<li>${esc(i)}</li>`).join('');
    setStatus('bad', `❌ ${res.issues.length} glaring problem${res.issues.length === 1 ? '' : 's'}<ul>${items}</ul>` + who);
    $detail.innerHTML = (res.suggested ? `<pre>${esc(res.suggested)}</pre>` : '') +
      `<div class="row">
        <button class="btn ghost" id="again">Check again</button>
        ${res.suggested ? '<button class="btn primary" id="apply">Apply fix</button>' : ''}
       </div>`;
    document.getElementById('apply')?.addEventListener('click', apply);
  }
  document.getElementById('again')?.addEventListener('click', run);
}

async function apply() {
  const btn = document.getElementById('apply');
  btn.disabled = true; btn.textContent = 'Applying…';
  try {
    const r = await inject(writeDraft, [draft.index, verdict.suggested]);
    if (r?.error) throw new Error(r.error);
    if (r.applied) {
      setStatus('good', '✅ Tweet updated on the page.');
      $detail.innerHTML = `<pre>${esc(r.text)}</pre><div class="row"><button class="btn ghost" id="again">Check again</button></div>`;
      document.getElementById('again').addEventListener('click', run);
    } else {
      setStatus('err', 'Tried to update but the box reads differently. Copy the fix manually.');
      $detail.innerHTML = `<pre>${esc(verdict.suggested)}</pre><div class="row"><button class="btn primary" id="copy">Copy fix</button></div>`;
      document.getElementById('copy').addEventListener('click', () => navigator.clipboard.writeText(verdict.suggested));
    }
  } catch (e) {
    setStatus('err', 'Apply failed: ' + esc(e.message));
    btn.disabled = false; btn.textContent = 'Apply fix';
  }
}

$engine.addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b || b.dataset.e === engine) return;
  engine = b.dataset.e; paintEngine();
  await chrome.storage.local.set({ engine });
  run();
});

(async () => {
  const st = await chrome.storage.local.get('engine');
  if (st.engine === 'codex' || st.engine === 'claude') engine = st.engine;
  paintEngine();
  run();
})();
