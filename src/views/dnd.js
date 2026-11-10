import { state } from '../store.js';
import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { filesFromDrop, parseUrls, isImageFile } from '../inputs.js';
import { addFromFiles, addFromUrls } from '../actions/add.js';
import { addFiles } from '../actions/harvest.js';
import { replaceImage } from '../actions/records.js';

let depth = 0;

const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');

const overlay = (text) => {
  let el = document.getElementById('drop-overlay');
  if (text && !el) {
    el = h('div', { id: 'drop-overlay', class: 'drop-overlay', role: 'presentation' }, h('div', null, icon('upload', { size: 32 }), h('strong', null, text)));
    document.body.append(el);
  } else if (text && el) el.querySelector('strong').textContent = text;
  if (!text && el) el.remove();
  document.body.dataset.dragging = String(!!text);
};

const label = (e) => (state.stage === 'work' && e.target.closest && e.target.closest('#inspector') && state.sel.size === 1 ? t('dropReplace') : t('dropOverlay'));

export const installDnd = () => {
  document.addEventListener('dragenter', (e) => {
    if (state.stage === 'busy' || !hasFiles(e)) return;
    e.preventDefault();
    depth += 1;
    overlay(label(e));
  });
  document.addEventListener('dragover', (e) => {
    if (state.stage === 'busy' || !hasFiles(e)) return;
    e.preventDefault();
    if (document.getElementById('drop-overlay')) overlay(label(e));
  });
  document.addEventListener('dragleave', (e) => {
    if (state.stage === 'busy') return;
    depth = Math.max(0, depth - 1);
    if (!depth || !e.relatedTarget) {
      depth = 0;
      overlay(null);
    }
  });
  document.addEventListener('drop', async (e) => {
    if (state.stage === 'busy') return;
    e.preventDefault();
    depth = 0;
    const replacing = state.stage === 'work' && e.target.closest && e.target.closest('#inspector') && state.sel.size === 1;
    overlay(null);
    if (!hasFiles(e)) return;
    const files = await filesFromDrop(e.dataTransfer);
    if (state.stage === 'intake') await addFiles(files);
    else if (replacing && files.length === 1 && isImageFile(files[0])) await replaceImage(state.records.get([...state.sel][0]), files[0]);
    else await addFromFiles(files);
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
