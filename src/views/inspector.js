import { state, history, emit, on } from '../store.js';
import { h, clear, icon } from '../dom.js';
import { t } from '../i18n.js';
import { setManualColour } from '../colour.js';
import { adjustPanel } from '../adjust-panel.js';
import { toast } from '../ui/toast.js';
import { tile, trioEl } from '../ui/tile.js';
import { pinnable, pinnedHref, statusKey } from '../model.js';
import { applyColours } from '../actions/colour.js';
import { scheduleSave } from '../actions/project.js';
import { copyPin, pinAttempt, reharvest, removeTile, replaceImage, retryLive, unpin } from '../actions/records.js';
import { adjustCommit, adjustLive } from '../actions/adjust.js';
import { colourPanel } from './colour-panel.js';

export const adjustSection = () => {
  const rec = state.records.get(state.selected);
  if (!rec || !rec.hasImage) return null;
  return adjustPanel({ rec, target: state.target, live: (next) => adjustLive(rec.key, next), commit: (next) => adjustCommit(rec.key, next), copied: () => toast(t('copied')) });
};

export const renderAdjust = () => {
  const old = document.getElementById('adjust-panel');
  const next = adjustSection();
  if (old && next) old.replaceWith(next);
  else if (old) old.remove();
  else if (next) {
    const el = document.getElementById('inspector');
    if (el) el.append(next);
  }
};

export const refreshHistoryButtons = () => {
  for (const [id, on] of [['undo-btn', history.canUndo()], ['redo-btn', history.canRedo()]]) {
    const b = document.getElementById(id);
    if (b) b.disabled = !on;
  }
};

export const selectedPanel = () => {
  const rec = state.records.get(state.selected);
  if (!rec) return h('section', { class: 'panel' }, h('h2', null, t('icon')), h('p', { class: 'hint-text' }, t('noSelection')));
  const item = state.items.get(rec.key) || {};
  const panel = h('section', { class: 'panel' }, h('h2', null, t('icon')));
  panel.append(h('div', { class: 'sel-head' }, rec.hasImage ? tile(rec, { size: 72 }) : h('span', { class: 'tile-art ghost', style: { '--size': '72px', animation: 'none' } }), h('div', null, h('h3', { dir: 'auto' }, rec.name), h('small', { dir: 'ltr' }, rec.key))));
  if (rec.hasImage) {
    const pickHex = (rec.tint && rec.tint[0]) || '#8c95b6';
    panel.append(
      h(
        'div',
        { class: 'colour-row' },
        h('label', { class: 'picker', style: { background: pickHex } }, h('span', { class: 'sr' }, t('pickColour')), h('input', { type: 'color', value: pickHex, onInput: (e) => { setManualColour(rec, e.target.value, state.target); e.target.parentElement.style.background = e.target.value; emit('tiles-lite'); } , onChange: () => renderInspector() })),
        trioEl(rec),
        rec.locked ? h('span', { class: 'pill ok' }, t('locked')) : null
      ),
      h(
        'div',
        { class: 'row' },
        rec.locked ? h('button', { class: 'btn', type: 'button', onClick: () => { rec.locked = false; applyColours(); emit('tiles'); } }, icon('reset', { size: 16 }), t('reset')) : h('button', { class: 'btn', type: 'button', onClick: () => { rec.locked = true; scheduleSave(); renderInspector(); } }, icon('lock', { size: 16 }), t('lock')),
        h('label', { class: 'btn' }, icon('image', { size: 16 }), t('replaceImage'), h('input', { type: 'file', accept: 'image/*,.ico,.svg', class: 'sr', onChange: (e) => replaceImage(rec, e.target.files[0]) }))
      )
    );
  }
  panel.append(
    h(
      'div',
      { class: 'row' },
      item.url ? h('button', { class: 'btn', type: 'button', 'data-act': 'reharvest', onClick: () => reharvest(rec, 'retryDone') }, icon('reset', { size: 16 }), t('reharvest')) : null,
      h('button', { class: 'btn', type: 'button', 'data-act': 'remove', onClick: () => removeTile(rec) }, icon('trash', { size: 16 }), t('removeTile'))
    )
  );
  const glyphLabel = rec.trace && rec.trace.accepted ? t('glyphSymbol', { bytes: rec.trace.bytes }) : rec.mask ? t('glyphAtlas') : t('glyphNone');
  const flags = [];
  if (rec.contrast === 'flagged') flags.push(h('span', { class: 'pill bad' }, t('contrastFlagged')));
  if (rec.contrast === 'nudged') flags.push(h('span', { class: 'pill warn' }, t('contrastNudged')));
  if (rec.tight) flags.push(h('span', { class: 'pill warn' }, t('tight')));
  if ((item.flags || []).includes('low-res')) flags.push(h('span', { class: 'pill warn', 'data-flag': 'low-res' }, t('lowRes')));
  const stale = (item.flags || []).includes('stale-source');
  const nudge = rec.contrast === 'nudged' && Array.isArray(rec.sourceTint) && Array.isArray(rec.tint) ? h('span', { class: 'contrast-note', 'data-note': 'contrast', dir: 'ltr' }, t('contrastAdjusted', { from: rec.sourceTint[0], to: rec.tint[0] })) : null;
  if (stale) flags.push(h('span', { class: 'pill warn', 'data-flag': 'stale-source' }, t('staleSource')), h('button', { class: 'btn', type: 'button', 'data-act': 'retry-live', onClick: () => retryLive(rec) }, t('retryLive')));
  const src = item.source ? (item.source.type + ' ' + (item.source.href || '')).slice(0, 120) : item.error || '-';
  panel.append(
    h(
      'dl',
      { class: 'facts' },
      h('dt', null, t('status')),
      h('dd', null, h('span', { class: 'pill' + (rec.status === 'found' || rec.status === 'override' ? ' ok' : ' warn') }, t(statusKey(rec.status))), ' ', flags),
      nudge ? h('dt', null, t('contrast')) : null,
      nudge ? h('dd', null, nudge) : null,
      h('dt', null, t('glyph')),
      h('dd', null, glyphLabel),
      h('dt', null, t('source')),
      h('dd', null, rec.faviconUrl ? h('span', { class: 'favicon-chip', style: { display: 'inline-grid', 'vertical-align': 'middle', 'margin-inline-end': '8px' } }, h('img', { src: rec.faviconUrl, alt: '' })) : null, src)
    ),
    ...[attemptsList(rec, item.attempts)].filter(Boolean)
  );
  return panel;
};

export const attemptsList = (rec, attempts) =>
  attempts && attempts.length
    ? h(
        'details',
        { class: 'attempts', open: !!pinnedHref(rec) },
        h('summary', null, t('attempts', { n: attempts.length })),
        h(
          'ol',
          null,
          ...attempts.map((a) =>
            h('li', null, h('span', { class: 'pill' + (a.status === 'used' ? ' ok' : ' warn') }, t('attempt' + a.status[0].toUpperCase() + a.status.slice(1))), ' ', h('b', null, a.type), ' ', h('span', { class: 'href', dir: 'ltr' }, a.href), a.reason ? h('span', { class: 'why' }, ' ' + a.reason) : null, pinnable(a) ? h('button', { class: 'btn quiet', type: 'button', 'data-act': 'pin', onClick: () => pinAttempt(rec, a) }, t('useThisOne')) : null)
          ),
          pinnedHref(rec) ? h('li', { class: 'pinned' }, h('span', { class: 'pill ok' }, t('pinned')), ' ', h('span', { class: 'href', dir: 'ltr' }, pinnedHref(rec)), h('button', { class: 'btn quiet', type: 'button', 'data-act': 'copy-pin', onClick: () => copyPin(rec) }, t('copyPin')), h('button', { class: 'btn quiet', type: 'button', 'data-act': 'unpin', onClick: () => unpin(rec) }, t('unpin'))) : null
        )
      )
    : null;

export const renderInspector = () => {
  const el = document.getElementById('inspector');
  if (!el) return;
  clear(el);
  el.append(colourPanel(), selectedPanel(), ...[adjustSection()].filter(Boolean));
};

on('inspector', renderInspector);
on('adjust-panel', renderAdjust);
on('history', refreshHistoryButtons);
