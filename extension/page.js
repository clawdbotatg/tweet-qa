// Functions injected into the active tab via chrome.scripting.executeScript.
// They must be self-contained (no closures over popup state). They run in the
// extension's isolated world, which persists per frame, so readDraft can stash a
// handle to the chosen element on `window.__tweetqa` for writeDraft to use.

// Finds the text to check. Priority (lower rank wins across frames):
//   0  X's tweet composer (focused one, else first non-empty)
//   1  selected text (in any element, editable or not)
//   2  the focused textarea / input / contenteditable, if it has text
//   3  the visible textarea / contenteditable with the most text
function readDraft() {
  const clean = (s) => String(s || '').replace(/ /g, ' ').replace(/\n+$/, '');
  const isTextInput = (el) => !!el && (el.tagName === 'TEXTAREA' ||
    (el.tagName === 'INPUT' && /^(text|search|url|email|tel|)$/i.test(el.type || '')));
  const textOf = (el) => clean(isTextInput(el) ? el.value : (el.innerText || el.textContent));
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
function writeDraft(newText) {
  const h = window.__tweetqa;
  if (!h || !h.el || !h.el.isConnected) return { error: 'Lost track of the text box. Check again first.' };
  const el = h.el;
  const clean = (s) => String(s || '').replace(/ /g, ' ').replace(/\n+$/, '');
  const isTextInput = el.tagName === 'TEXTAREA' || el.tagName === 'INPUT';
  const read = () => clean(isTextInput ? el.value : (el.innerText || el.textContent));

  const before = read();
  let expect = newText;             // what the box should read afterwards
  let bounds = [0, before.length];  // text-input span being replaced
  el.focus();
  if (h.mode === 'selection') {
    if (isTextInput) {
      bounds = h.range;
      el.setSelectionRange(bounds[0], bounds[1]);
      expect = before.slice(0, bounds[0]) + newText + before.slice(bounds[1]);
    } else {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(h.range);
      expect = null; // can't predict the exact text around a DOM range; verify by inclusion below
    }
  } else if (isTextInput) {
    el.select();
  } else {
    document.execCommand('selectAll', false, null);
  }

  const good = () => {
    const got = read();
    return expect === null ? got.includes(newText.trim()) : got.trim() === expect.trim();
  };

  // Preferred: insertText goes through the editor's own input pipeline (Draft.js, React, plain).
  document.execCommand('insertText', false, newText);
  if (!good()) {
    if (isTextInput) {
      // React-safe fallback: native value setter + input event.
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, before.slice(0, bounds[0]) + newText + before.slice(bounds[1]));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // Synthetic paste, which Draft.js and most rich editors honor.
      const dt = new DataTransfer();
      dt.setData('text/plain', newText);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }
  }
  if (h.mode === 'selection' && isTextInput) {
    h.range = [bounds[0], bounds[0] + newText.length];
    el.setSelectionRange(h.range[0], h.range[1]);
  }
  return { text: read(), applied: good() };
}
