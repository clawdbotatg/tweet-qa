// Functions injected into the active tab via chrome.scripting.executeScript.
// They must be self-contained (no closures over popup state), which is why the
// small `editableText` helper is repeated in both. They run in the extension's
// isolated world, which persists per frame, so readDraft can stash a handle to
// the chosen element on `window.__tweetqa` for writeDraft to use.
//
// Text of a contenteditable is NEVER read with innerText: Chrome emits "\n\n\n"
// for an empty line (`<div><br></div>`, and Draft.js's `<div><div><span><br>`),
// so a tweet with a blank line came back with two, the model preserved them, and
// the "fix" doubled every gap (2026-09-12). `editableText` walks the DOM instead:
// one line per block, one per <br>, a trailing <br> closes its block's line.

// Finds the text to check. Priority (lower rank wins across frames):
//   0  X's tweet composer (focused one, else first non-empty)
//   1  selected text (in any element, editable or not)
//   2  the focused textarea / input / contenteditable, if it has text
//   3  the visible textarea / contenteditable with the most text
function readDraft() {
  const clean = (s) => String(s || '').replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  const editableText = (root) => {
    const lines = [];
    let cur = '', justBr = false, pushed = 0;
    const blocky = /^(block|flex|grid|list-item|table|table-row|table-cell|table-caption|flow-root)$/;
    const walk = (node, pre) => {
      if (node.nodeType === 3) { cur += pre ? node.data : node.data.replace(/[\t\n\r ]+/g, ' '); justBr = false; return; }
      if (node.nodeType !== 1) return;
      if (node.tagName === 'BR') { lines.push(cur); cur = ''; justBr = true; pushed++; return; }
      const st = getComputedStyle(node);
      if (st.display === 'none') return;
      const block = blocky.test(st.display);
      const mark = pushed;
      if (block) { if (cur.trim()) { lines.push(cur); pushed++; } cur = ''; }  // stray inter-block whitespace is layout, not a line
      for (const c of node.childNodes) walk(c, /^pre/.test(st.whiteSpace));
      // A block ends its line — unless a <br> just did, or the block only wrapped other blocks.
      if (block && !justBr && (cur !== '' || pushed === mark)) { lines.push(cur); cur = ''; pushed++; }
      justBr = false;
    };
    for (const c of root.childNodes) walk(c, /^pre/.test(getComputedStyle(root).whiteSpace));
    if (cur !== '' || !lines.length) lines.push(cur);
    return lines.join('\n');
  };
  const isTextInput = (el) => !!el && (el.tagName === 'TEXTAREA' ||
    (el.tagName === 'INPUT' && /^(text|search|url|email|tel|)$/i.test(el.type || '')));
  const textOf = (el) => clean(isTextInput(el) ? el.value : editableText(el));
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  // Outermost editable ancestor of a node (a text input, or the root of a contenteditable region).
  const editableRoot = (node) => {
    let el = node && (node.nodeType === 1 ? node : node.parentElement);
    let root = null;
    while (el) {
      if (isTextInput(el)) return el;
      if (el.isContentEditable) root = el;
      el = el.parentElement;
    }
    return root;
  };
  const done = (el, mode, source, text, extra) => {
    window.__tweetqa = { el, mode, ...(extra || {}) };
    return { text, source, writable: !!el, rank: { composer: 0, selection: 1, focused: 2, editable: 3 }[source] };
  };
  const active = document.activeElement;

  // 0. X's Draft.js composer.
  const boxes = [...document.querySelectorAll('[data-testid^="tweetTextarea_"][contenteditable="true"]')];
  const box = boxes.find((b) => b.contains(active)) || boxes.find((b) => textOf(b).trim());
  if (box) return done(box, 'all', 'composer', textOf(box));

  // 1. Selected text. In a textarea/input the DOM selection API is unreliable, so
  //    read selectionStart/End; elsewhere use the document selection.
  if (isTextInput(active) && active.selectionStart !== active.selectionEnd) {
    const [s, e] = [active.selectionStart, active.selectionEnd];
    const t = active.value.slice(s, e);
    if (t.trim()) return done(active, 'selection', 'selection', clean(t), { range: [s, e] });
  }
  const sel = window.getSelection();
  if (sel && sel.rangeCount && !sel.isCollapsed) {
    const t = sel.toString();
    if (t.trim()) {
      const range = sel.getRangeAt(0).cloneRange();
      const root = editableRoot(range.commonAncestorContainer);
      // Only writable when the whole selection sits inside one contenteditable.
      const el = root && !isTextInput(root) ? root : null;
      return done(el, 'selection', 'selection', clean(t), { range });
    }
  }

  // 2. Whatever text box has focus.
  const focused = editableRoot(active);
  if (focused && textOf(focused).trim()) return done(focused, 'all', 'focused', textOf(focused));

  // 3. Biggest visible text box on the page.
  const cands = [...document.querySelectorAll('textarea, input, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]')]
    .filter((el) => (isTextInput(el) || el.isContentEditable) && editableRoot(el) === el && visible(el) && textOf(el).trim());
  cands.sort((a, b) => textOf(b).length - textOf(a).length);
  if (cands[0]) return done(cands[0], 'all', 'editable', textOf(cands[0]));

  window.__tweetqa = null;
  return { error: 'Nothing to check here: no tweet composer, no selected text, and no text box with anything in it.', rank: 99 };
}

// Replaces the text found by readDraft (whole box, or just the selection) with newText.
// Async: executeScript awaits the returned promise. Rich editors (Draft.js on X) sync
// their selection from the DOM on a later task and re-render on another, so every step
// waits; a replacement is only ever attempted on a box that still reads as it did
// before, never piled onto a half-applied one (the 2026-09-12 "tweet inside a tweet").
async function writeDraft(newText) {
  const h = window.__tweetqa;
  if (!h || !h.el || !h.el.isConnected) return { error: 'Lost track of the text box. Check again first.' };
  const el = h.el;
  newText = String(newText).replace(/\r\n?/g, '\n');
  const clean = (s) => String(s || '').replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  const editableText = (root) => {
    const lines = [];
    let cur = '', justBr = false, pushed = 0;
    const blocky = /^(block|flex|grid|list-item|table|table-row|table-cell|table-caption|flow-root)$/;
    const walk = (node, pre) => {
      if (node.nodeType === 3) { cur += pre ? node.data : node.data.replace(/[\t\n\r ]+/g, ' '); justBr = false; return; }
      if (node.nodeType !== 1) return;
      if (node.tagName === 'BR') { lines.push(cur); cur = ''; justBr = true; pushed++; return; }
      const st = getComputedStyle(node);
      if (st.display === 'none') return;
      const block = blocky.test(st.display);
      const mark = pushed;
      if (block) { if (cur.trim()) { lines.push(cur); pushed++; } cur = ''; }  // stray inter-block whitespace is layout, not a line
      for (const c of node.childNodes) walk(c, /^pre/.test(st.whiteSpace));
      if (block && !justBr && (cur !== '' || pushed === mark)) { lines.push(cur); cur = ''; pushed++; }
      justBr = false;
    };
    for (const c of root.childNodes) walk(c, /^pre/.test(getComputedStyle(root).whiteSpace));
    if (cur !== '' || !lines.length) lines.push(cur);
    return lines.join('\n');
  };
  const isTextInput = el.tagName === 'TEXTAREA' || el.tagName === 'INPUT';
  const read = () => clean(isTextInput ? el.value : editableText(el));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Poll for the editor to re-render into the expected text (React commits on a later task).
  const settle = async (ok, ms = 1500) => {
    for (let t = 0; t < ms; t += 50) { if (ok()) return true; await sleep(50); }
    return ok();
  };

  const before = read();
  let expect = newText;             // what the box should read afterwards
  let bounds = [0, before.length];  // text-input span being replaced
  if (h.mode === 'selection' && isTextInput) {
    bounds = h.range;
    expect = before.slice(0, bounds[0]) + newText + before.slice(bounds[1]);
  } else if (h.mode === 'selection') {
    expect = null; // can't predict the exact text around a DOM range; verify by inclusion below
  }
  const good = () => {
    const got = read();
    return expect === null ? got.includes(newText.trim()) : got.trim() === expect.trim();
  };
  const untouched = () => read() === before;

  // Select what is being replaced, then give the editor a task to notice the new
  // selection (Draft.js reads it back on `selectionchange`, which is async).
  const select = async () => {
    el.focus();
    if (h.mode === 'selection' && isTextInput) el.setSelectionRange(bounds[0], bounds[1]);
    else if (h.mode === 'selection') { const s = window.getSelection(); s.removeAllRanges(); s.addRange(h.range); }
    else if (isTextInput) el.select();
    else document.execCommand('selectAll', false, null);
    await sleep(120);
  };

  await select();
  if (isTextInput) {
    // insertText goes through the browser's own input pipeline (React sees it).
    document.execCommand('insertText', false, newText);
    if (!good() && untouched()) {
      // React-safe fallback: native value setter + input event.
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, before.slice(0, bounds[0]) + newText + before.slice(bounds[1]));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (h.mode === 'selection') {
      h.range = [bounds[0], bounds[0] + newText.length];
      el.setSelectionRange(h.range[0], h.range[1]);
    }
    return { text: read(), applied: good() };
  }

  // Contenteditable. First a synthetic paste: rich editors (Draft.js, Lexical,
  // ProseMirror, Quill) take over paste and rebuild the selection from plain text
  // in one transaction, blocks and all. execCommand('insertText') with newlines is
  // what mangled X's composer: Draft.js took the whole thing as one block of soft
  // breaks and left the old blocks underneath. A plain contenteditable ignores an
  // untrusted paste (nothing happens, event not cancelled), so then — and only if
  // the box still reads exactly as before — fall back to insertText, which Chrome
  // itself turns into proper paragraphs there.
  const dt = new DataTransfer();
  dt.setData('text/plain', newText);
  const handled = !el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  if (await settle(good, handled ? 1500 : 300)) return { text: read(), applied: true };
  if (untouched()) {
    await select();
    document.execCommand('insertText', false, newText);
    await settle(good);
  }
  return { text: read(), applied: good() };
}
