import { state } from '../store.js';
import { h, icon, kids } from '../dom.js';
import { t } from '../i18n.js';
import { statusKey, pinnedHref, pinnable } from '../model.js';
import { copyPin, pinAttempt, unpin, reharvest, reharvestMany, replaceImage } from '../actions/records.js';

const attempts = (rec, list) =>
  list && list.length
    ? h(
        'section',
        { class: 'insp-section' },
        h('h3', null, t('attemptsTitle', { n: list.length })),
        h(
          'ol',
          { class: 'attempts' },
          ...list.map((a) => h('li', null, h('span', { class: 'pill' + (a.status === 'used' ? ' ok' : ' warn') }, t('attempt' + a.status[0].toUpperCase() + a.status.slice(1))), ' ', h('b', null, a.type), ' ', h('span', { class: 'href', dir: 'ltr' }, a.href), a.reason ? h('span', { class: 'why' }, ' ' + a.reason) : null, pinnable(a) ? h('button', { class: 'btn quiet small', type: 'button', 'data-act': 'pin', onClick: () => pinAttempt(rec, a) }, t('useThis')) : null)),
          pinnedHref(rec) ? h('li', { class: 'pinned' }, h('span', { class: 'pill ok' }, t('pinned')), ' ', h('span', { class: 'href', dir: 'ltr' }, pinnedHref(rec)), h('button', { class: 'btn quiet small', type: 'button', 'data-act': 'copy-pin', onClick: () => copyPin(rec) }, t('copyPin')), h('button', { class: 'btn quiet small', type: 'button', 'data-act': 'unpin', onClick: () => unpin(rec) }, t('unpin'))) : null
        )
      )
    : null;

export const sourcePanel = (recs) => {
  const panel = h('div', { class: 'tab-panel', role: 'tabpanel', id: 'tab-source', 'aria-labelledby': 'tabbtn-source' });
  const withUrl = recs.filter((r) => (state.items.get(r.key) || {}).url);
  if (recs.length === 1) {
    const rec = recs[0];
    const item = state.items.get(rec.key) || {};
    const glyphLabel = rec.trace && rec.trace.accepted ? t('glyphSymbol', { bytes: rec.trace.bytes }) : rec.mask ? t('glyphAtlas') : t('glyphNone');
    const src = item.source ? (item.source.type + ' ' + (item.source.href || '')).slice(0, 120) : item.error || '-';
    panel.append(...kids(
      h(
        'dl',
        { class: 'facts' },
        h('dt', null, t('statusLabel')),
        h('dd', null, h('span', { class: 'pill' + (rec.status === 'found' || rec.status === 'override' ? ' ok' : ' warn') }, t(statusKey(rec.status)))),
        h('dt', null, t('glyphLabel')),
        h('dd', null, glyphLabel),
        h('dt', null, t('sourceLabel')),
        h('dd', null, rec.faviconUrl ? h('span', { class: 'fav-chip' }, h('img', { src: rec.faviconUrl, alt: '' })) : null, h('span', { dir: 'ltr' }, src))
      ),
      attempts(rec, item.attempts)
    ));
  }
  panel.append(...kids(
    h(
      'section',
      { class: 'insp-section' },
      h('div', { class: 'row' }, withUrl.length ? h('button', { class: 'btn', type: 'button', 'data-act': 'reharvest', onClick: () => (recs.length === 1 ? reharvest(recs[0], 'retryDone') : reharvestMany(recs.map((r) => r.key))) }, icon('reset', { size: 16 }), t('reharvest')) : null, recs.length === 1 ? h('label', { class: 'btn', id: 'replace-image' }, icon('image', { size: 16 }), t('replaceImage'), h('input', { type: 'file', accept: 'image/*,.ico,.svg', class: 'sr', 'aria-label': t('replaceImage'), onChange: (e) => replaceImage(recs[0], e.target.files[0]) })) : null)
    )
  ));
  return panel;
};
