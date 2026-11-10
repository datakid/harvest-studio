import { state } from '../store.js';
import { h, icon, kids } from '../dom.js';
import { t } from '../i18n.js';
import { colourField } from '../ui/controls.js';
import { download } from '../ui/download.js';
import { toast } from '../ui/toast.js';
import { groupsList } from '../model.js';
import { editMeta } from '../actions/meta.js';
import { removeTiles } from '../actions/records.js';
import { runBuild, HEAD_TAGS } from '../actions/export.js';

const textField = (id, label, value, onSave, { dir = 'auto', mono = false } = {}) =>
  h('div', { class: 'field' }, h('label', { for: id }, label), h('input', { id, type: 'text', value, dir, class: mono ? 'mono' : '', spellcheck: false, onChange: (e) => onSave(e.target.value.trim()) }));

const pack = (rec) => {
  const opts = { name: rec.name, background: '#ffffff', themeColor: '' };
  const preview = h('pre', { class: 'code', id: 'head-tags' }, HEAD_TAGS);
  return h(
    'section',
    { class: 'insp-section' },
    h('h3', null, t('packTitle')),
    h('p', { class: 'hint-text' }, t('packSizes')),
    textField('pk-name', t('packName'), rec.name, (v) => { opts.name = v || rec.name; }),
    h('div', { class: 'row' }, h('div', { class: 'field' }, h('label', { class: 'label' }, t('packBackground')), colourField({ value: opts.background, label: t('packBackground'), id: 'pk-bg', onLive: (v) => { opts.background = v; }, onCommit: (v) => { opts.background = v; } })), h('div', { class: 'field' }, h('label', { class: 'label' }, t('packTheme')), colourField({ value: '#1a211e', label: t('packTheme'), id: 'pk-theme', onLive: (v) => { opts.themeColor = v; }, onCommit: (v) => { opts.themeColor = v; } }))),
    h('div', { class: 'label' }, t('headTags')),
    preview,
    h(
      'div',
      { class: 'actions-end' },
      h('button', { class: 'btn small', type: 'button', onClick: async (e) => { await navigator.clipboard.writeText(preview.textContent); e.currentTarget.lastChild.textContent = t('copied'); } }, icon('copy', { size: 16 }), h('span', null, t('copyTags'))),
      h('button', { class: 'btn primary small', id: 'download-pack', type: 'button', onClick: async (e) => { const b = e.currentTarget; b.disabled = true; try { const r = await runBuild('pack', { key: rec.key, name: opts.name || rec.name, background: opts.background, themeColor: opts.themeColor || null }); preview.textContent = r.head; download(r.zip, rec.key + '-favicon-pack.zip'); } catch (err) { toast(t('exportError', { why: err.message })); } b.disabled = false; } }, icon('download', { size: 16 }), t('downloadPack'))
    )
  );
};

export const appPanel = (recs) => {
  const panel = h('div', { class: 'tab-panel', role: 'tabpanel', id: 'tab-app', 'aria-labelledby': 'tabbtn-app' });
  if (recs.length !== 1) {
    panel.append(...kids(h('p', { class: 'hint-text' }, t('selectedN', { n: recs.length }))));
    return panel;
  }
  const rec = recs[0];
  const item = state.items.get(rec.key) || {};
  const groups = groupsList().map(([g]) => g);
  panel.append(...kids(
    h(
      'section',
      { class: 'insp-section' },
      textField('app-name', t('nameLabel'), rec.name, (v) => v && editMeta(rec.key, { name: v })),
      h('div', { class: 'field' }, h('label', { for: 'app-key' }, t('appKey')), h('input', { id: 'app-key', type: 'text', value: rec.key, readonly: true, dir: 'ltr', class: 'mono' })),
      textField('app-url', t('appUrl'), item.url || '', (v) => editMeta(rec.key, { url: v }), { dir: 'ltr', mono: true }),
      h('div', { class: 'field' }, h('label', { for: 'app-group' }, t('appGroup')), h('input', { id: 'app-group', type: 'text', value: rec.groupId || '', list: 'group-list', dir: 'auto', onChange: (e) => editMeta(rec.key, { groupId: e.target.value.trim() }) }), h('datalist', { id: 'group-list' }, groups.map((g) => h('option', { value: g }))))
    ),
    rec.hasImage ? pack(rec) : null,
    h('section', { class: 'insp-section' }, h('button', { class: 'btn danger', type: 'button', 'data-act': 'remove', onClick: () => removeTiles([rec.key]) }, icon('trash', { size: 16 }), t('selRemove')))
  ));
  return panel;
};

