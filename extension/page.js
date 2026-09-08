// Functions injected into the X/Twitter tab via chrome.scripting.executeScript.
// They must be self-contained (no closures over popup state).

function readDraft() {
  const boxes = [...document.querySelectorAll('[data-testid^="tweetTextarea_"][contenteditable="true"]')];
  if (!boxes.length) return { error: 'No tweet composer found on this page.' };
  const text = (el) => (el.innerText || el.textContent || '').replace(/ /g, ' ').replace(/\n+$/, '');
  let box = boxes.find((b) => b.contains(document.activeElement)) || boxes.find((b) => text(b).trim());
  if (!box) return { error: 'The tweet box is empty.' };
  const i = boxes.indexOf(box);
  return { text: text(box), index: i, count: boxes.length };
}

function writeDraft(index, newText) {
  const boxes = [...document.querySelectorAll('[data-testid^="tweetTextarea_"][contenteditable="true"]')];
  const box = boxes[index] || boxes[0];
  if (!box) return { error: 'Tweet composer disappeared.' };
  box.focus();
  document.execCommand('selectAll', false, null);
  const ok = document.execCommand('insertText', false, newText);
  if (!ok) {
    // Fallback: synthetic paste, which Draft.js also honors.
    const dt = new DataTransfer();
    dt.setData('text/plain', newText);
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }
  const got = (box.innerText || box.textContent || '').replace(/ /g, ' ').replace(/\n+$/, '');
  return { text: got, applied: got.trim() === newText.trim() };
}
