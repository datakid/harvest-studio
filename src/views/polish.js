import { state } from '../store.js';
import { h, icon, kids } from '../dom.js';
import { t } from '../i18n.js';
import { tile } from '../ui/tile.js';
import { sheet } from '../ui/sheet.js';
import { imaged, similarNow } from '../model.js';

export const polishRows = () => {
  const list = imaged();
  const raster = list.filter((r) => r.trace && !r.trace.accepted).length;
  const flagged = list.filter((r) => r.contrast === 'flagged').length;
  const pairs = similarNow().length;
  const p = state.polish;
  return [
    { id: 'safe', ok: !p || p.safeArea >= 0.95, text: t('polishSafe', { p: p ? Math.round(p.safeArea * 100) : 100 }) },
    { id: 'rounded', ok: !p || p.rounded === 1, text: t('polishRounded', { p: p ? Math.round(p.rounded * 100) : 100 }) },
    { id: 'pairs', ok: pairs === 0, text: t('polishPairs', { n: pairs }) },
    { id: 'raster', ok: raster === 0, text: t('polishRaster', { n: raster }) },
    { id: 'contrast', ok: flagged === 0, text: t('polishContrast', { n: flagged }) }
  ];
};

export const previewStrip = (colors, tone) => h('div', { class: 'pstrip ' + tone, role: 'group', 'aria-label': t(colors === 'vivid' ? 'vivid' : 'muted') + ', ' + t(tone === 'dark' ? 'themeDark' : 'themeLight') }, imaged().map((r) => tile(r, { size: 36, colors, theme: tone })));

export const openPolish = () =>
  sheet({
    id: 'polish-dialog',
    title: t('polishTitle'),
    wide: true,
    build: (api) => {
      api.body.append(...kids(
        api.head(t('polishTitle')),
        h('ul', { class: 'checklist' }, polishRows().map((r) => h('li', { 'data-id': r.id, class: r.ok ? 'ok' : 'warn' }, icon(r.ok ? 'check' : 'warn', { size: 16 }), h('span', null, r.text)))),
        h('h3', { class: 'label' }, t('polishPreview')),
        ...['vivid', 'muted'].flatMap((c) => ['light', 'dark'].map((tone) => h('div', { class: 'pstrip-row' }, h('span', { class: 'label' }, t(c === 'vivid' ? 'vivid' : 'muted') + ' · ' + t(tone === 'dark' ? 'themeDark' : 'themeLight')), previewStrip(c, tone))))
      ));
    }
  });
