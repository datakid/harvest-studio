import { state } from '../store.js';
import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { filesFromDrop, parseUrls } from '../inputs.js';
import { addFromFiles, addFromUrls } from '../actions/add.js';

export let overlayDepth = 0;

export const dropOverlay = (on) => {
  let el = document.getElementById('drop-overlay');
  if (on && !el) {
    el = h('div', { id: 'drop-overlay', class: 'drop-overlay', role: 'presentation' }, h('div', null, icon('upload', { size: 34 }), h('strong', null, t('dropOverlay'))));
    document.body.append(el);
  }
  if (!on && el) el.remove();
};

export const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');

export const installDnd = () => {
document.addEventListener('dragenter', (e) => {
  if (state.stage !== 'work' || !hasFiles(e)) return;
  e.preventDefault();
  overlayDepth += 1;
  dropOverlay(true);
});
document.addEventListener('dragover', (e) => {
  if (state.stage !== 'work' || !hasFiles(e)) return;
  e.preventDefault();
});
document.addEventListener('dragleave', (e) => {
  if (state.stage !== 'work') return;
  overlayDepth = Math.max(0, overlayDepth - 1);
  if (!overlayDepth || !e.relatedTarget) {
    overlayDepth = 0;
    dropOverlay(false);
  }
});
document.addEventListener('drop', async (e) => {
  if (state.stage !== 'work') return;
  e.preventDefault();
  overlayDepth = 0;
  dropOverlay(false);
  if (!hasFiles(e)) return;
  await addFromFiles(await filesFromDrop(e.dataTransfer));
});
document.addEventListener('paste', (e) => {
  if (state.stage !== 'work') return;
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;
  const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
  if (!parseUrls(text).length) return;
  e.preventDefault();
  addFromUrls(text);
});
};
