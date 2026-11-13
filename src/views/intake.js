import { state, prefs, save, on, emit } from '../store.js';
import { h, icon, kids } from '../dom.js';
import { t, getLang } from '../i18n.js';
import { rescan, pendingCount } from '../inputs.js';
import { seg } from '../ui/seg.js';
import { info } from '../ui/controls.js';
import { popover } from '../ui/popover.js';
import { addFiles, harvestSets, openManifest, startHarvest, baseOf } from '../actions/harvest.js';
import { openProject } from '../actions/project.js';
import { removeProject, listProjects } from '../projects.js';
import { openSettings } from './settings-sheet.js';

export const langOf = (json) => json.lang || getLang();

const kindLabel = (s) => (s.kind === 'launcher' ? t('kindLauncher') : s.kind === 'fihrist' ? t('kindFihrist') : s.label || '');

const fieldSelect = (json, label, key, options, value, allowNone) =>
  h(
    'div',
    { class: 'field' },
    h('label', null, label),
    h(
      'select',
      {
        onChange: (e) => {
          const v = e.target.value === '' ? null : e.target.value;
          const f = { ...json.scan.fields, [key]: v };
          if (key === 'collection') {
            delete f.urlField;
            delete f.iconField;
            delete f.nameField;
            rescan(json, { collection: v }, langOf(json));
          } else rescan(json, f, langOf(json));
          emit('main');
        }
      },
      allowNone ? h('option', { value: '' }, t('scanNoneOption')) : null,
      options.map((o) => h('option', { value: o, selected: o === value }, o || '(root)'))
    )
  );

const languagePick = (json, index) =>
  h(
    'div',
    { class: 'field' },
    h('label', { for: 'label-lang-' + index }, t('labelLanguage')),
    h(
      'select',
      {
        id: 'label-lang-' + index,
        onChange: (e) => {
          json.lang = e.target.value || null;
          rescan(json, json.scan.fields || {}, langOf(json));
          emit('main');
        }
      },
      h('option', { value: '', selected: !json.lang }, t('labelLanguageAuto')),
      json.scan.languages.map((l) => h('option', { value: l, selected: l === json.lang }, l))
    )
  );

const scanPanel = (json, index) => {
  const s = json.scan;
  const panel = h('div', { class: 'scan' });
  panel.append(...kids(h('div', { class: 'scan-head' }, h('b', { dir: 'auto' }, json.name + ' · ' + (s.kind === 'none' ? t('scanNone') : s.count + ' · ' + kindLabel(s))), h('button', { class: 'btn icon quiet', type: 'button', 'aria-label': t('chipRemove', { name: json.name }), onClick: () => { state.pending.jsons.splice(index, 1); emit('main'); } }, icon('close', { size: 16 })))));
  if (s.kind === 'none') return panel;
  panel.append(...kids(
    h(
      'div',
      { class: 'scan-grid' },
      s.candidates.collections.length > 1 ? fieldSelect(json, t('scanCollection'), 'collection', s.candidates.collections.map((c) => c.path), s.fields.collection, false) : null,
      s.candidates.url.length ? fieldSelect(json, t('scanUrl'), 'urlField', s.candidates.url, s.fields.urlField, true) : null,
      s.candidates.icon.length ? fieldSelect(json, t('scanIcon'), 'iconField', s.candidates.icon, s.fields.iconField, true) : null,
      s.candidates.name.length ? fieldSelect(json, t('scanName'), 'nameField', s.candidates.name, s.fields.nameField, true) : null,
      s.languages && s.languages.length > 1 ? languagePick(json, index) : null
    ),
    h('ul', null, s.targets.slice(0, 4).map((x) => h('li', null, h('b', { dir: 'auto' }, x.name || x.key), x.url ? h('span', { dir: 'ltr', class: 'href' }, '  ' + x.url) : null)))
  ));
  return panel;
};

const jsonChip = (json, index) => {
  const s = json.scan;
  const remove = h('button', { type: 'button', 'aria-label': t('chipRemove', { name: json.name }), onClick: () => { state.pending.jsons.splice(index, 1); emit('main'); } }, icon('close', { size: 14 }));
  const multi = s.languages && s.languages.length > 1;
  const remap = multi
    ? h('button', { type: 'button', class: 'chip-act', 'aria-label': t('remap'), title: t('remap'), onClick: (e) => popover(e.currentTarget, languagePick(json, index), { label: t('remap') }) }, icon('sliders', { size: 14 }))
    : null;
  return h('span', { class: 'chip json', 'data-kind': s.kind }, h('span', { dir: 'auto' }, json.name + ' · ' + s.count + ' · ' + kindLabel(s)), remap, remove);
};

const manifestNeeds = () => {
  const m = state.pending.bundle.manifest;
  if (!m) return null;
  const wanted = [m.data.atlas && baseOf(m.data.atlas.file), m.data.glyphAtlas && baseOf(m.data.glyphAtlas.file), m.data.glyphSprite && baseOf(m.data.glyphSprite.file)].filter(Boolean);
  const missing = wanted.filter((f) => !state.pending.bundle.files.has(f));
  const atlasMissing = !!(m.data.atlas && !state.pending.bundle.files.has(baseOf(m.data.atlas.file)));
  return { missing, atlasMissing, count: Object.keys(m.data.icons).length };
};

const manifestPanel = () => {
  const need = manifestNeeds();
  if (!need) return null;
  return h(
    'div',
    { class: 'manifest', id: 'manifest-panel' },
    h('span', { class: 'manifest-text' }, t('manifestFound', { n: need.count }) + ' · ' + state.pending.bundle.manifest.name),
    need.missing.length ? h('span', { class: 'hint-text' }, need.missing.map((f) => t('manifestNeed', { file: f })).join(' · ')) : h('span', { class: 'hint-text' }, t('manifestReady')),
    h('button', { class: 'btn small primary', id: 'open-set', type: 'button', disabled: need.atlasMissing, onClick: openManifest }, t('manifestOpen')),
    h('button', { class: 'btn icon quiet small', type: 'button', 'aria-label': t('close'), onClick: () => { state.pending.bundle = { manifest: null, files: new Map() }; emit('main'); } }, icon('close', { size: 14 }))
  );
};

const ago = (ms) => {
  const mins = Math.round((Date.now() - ms) / 60000);
  const rtf = new Intl.RelativeTimeFormat(getLang(), { numeric: 'auto', style: 'short' });
  if (mins < 60) return rtf.format(-Math.max(mins, 0), 'minute');
  if (mins < 1440) return rtf.format(-Math.round(mins / 60), 'hour');
  return rtf.format(-Math.round(mins / 1440), 'day');
};

const recents = () => {
  if (!state.projects.length) return null;
  return h(
    'section',
    { class: 'recents', 'aria-labelledby': 'recents-title' },
    h('h2', { id: 'recents-title' }, t('recentTitle')),
    h(
      'ul',
      null,
      state.projects.map((p) =>
        h(
          'li',
          null,
          h('button', { class: 'recent', type: 'button', dataset: { id: p.id }, onClick: () => openProject(p), 'aria-label': t('projectOpen') + ' ' + p.name }, h('span', { class: 'dots', 'aria-hidden': 'true' }, (p.dots || []).map((c) => h('i', { style: { background: c } }))), h('span', { class: 'rname', dir: 'auto' }, p.name || t('recentTitle')), h('small', null, t('projectIcons', { n: p.count }) + ' · ' + ago(p.updatedAt))),
          h('button', { class: 'btn icon quiet recent-del', type: 'button', 'aria-label': t('projectDelete', { name: p.name }), title: t('projectDelete', { name: p.name }), onClick: async () => { await removeProject(p.id); state.projects = await listProjects(); if (state.stage === 'intake') emit('main'); } }, icon('trash', { size: 18 }))
        )
      )
    )
  );
};

const label = () => {
  const n = pendingCount(state.pending);
  return n === 0 ? t('harvest') : t('harvestN', { n });
};

const setButtons = () => {
  const out = [];
  if (state.catalogue) out.push(h('button', { class: 'btn pill', id: 'harvest-catalogue', type: 'button', onClick: () => harvestSets('launcher') }, t('setLauncher', { n: state.catalogue.count })));
  if (state.fihrist) out.push(h('button', { class: 'btn pill', id: 'harvest-fihrist', type: 'button', onClick: () => harvestSets('fihrist') }, t('setFihrist', { n: state.fihrist.count })));
  if (state.catalogue && state.fihrist) out.push(h('button', { class: 'btn pill', id: 'harvest-both', type: 'button', onClick: () => harvestSets('both') }, t('setBoth', { n: state.catalogue.count + state.fihrist.count })));
  return out.length ? h('div', { class: 'pills' }, out) : null;
};

export const refreshHarvestLabel = () => {
  const go = document.getElementById('go');
  if (go) go.textContent = label();
};

const grow = (el) => {
  el.style.blockSize = 'auto';
  el.style.blockSize = Math.min(el.scrollHeight, 160) + 'px';
};

export const renderIntake = () => {
  const area = h('textarea', {
    id: 'urls',
    rows: 1,
    placeholder: t('pastePlaceholder'),
    'aria-label': t('urlLabel'),
    spellcheck: false,
    autocapitalize: 'off',
    autocomplete: 'off',
    inputmode: 'url',
    onInput: (e) => {
      state.pending.urlText = e.target.value;
      grow(e.target);
      refreshHarvestLabel();
    },
    onKeydown: (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        startHarvest();
      }
    }
  });
  area.value = state.pending.urlText;
  const files = state.pending.files.map((f, i) => h('span', { class: 'chip' }, h('span', { dir: 'auto' }, f.name), h('button', { type: 'button', 'aria-label': t('chipRemove', { name: f.name }), onClick: () => { state.pending.files.splice(i, 1); emit('main'); } }, icon('close', { size: 14 }))));
  const generic = state.pending.jsons.map((j, i) => [j, i]).filter(([j]) => j.scan.kind === 'generic' || j.scan.kind === 'none');
  const known = state.pending.jsons.map((j, i) => [j, i]).filter(([j]) => j.scan.kind !== 'generic' && j.scan.kind !== 'none');
  const chips = [...files, ...known.map(([j, i]) => jsonChip(j, i))];
  const col = h(
    'div',
    { class: 'intake-col' },
    h('h1', { class: 'hero' }, t('appName')),
    h(
      'form',
      { class: 'intake-field', onSubmit: (e) => { e.preventDefault(); startHarvest(); } },
      area,
      h('div', { class: 'intake-actions' }, h('div', { class: 'chips' }, chips), h('button', { class: 'btn primary pill', id: 'go', type: 'submit' }, label()))
    ),
    h(
      'div',
      { class: 'intake-tools' },
      setButtons(),
      h('div', { class: 'format-row', id: 'target-pick' }, h('span', { class: 'label' }, t('formatLabel')), seg(t('formatLabel'), [['v3', t('targetV3')], ['v4', t('targetV4')]], prefs.target, (v) => { prefs.target = v; save(); emit('main'); }), info(prefs.target === 'v4' ? t('targetV4Tip') : t('targetV3Tip')))
    ),
    h('input', { id: 'pick-files', type: 'file', multiple: true, accept: 'image/*,.ico,.svg,.json,application/json', class: 'sr', tabindex: -1, 'aria-label': t('addFiles'), onChange: (e) => { addFiles([...e.target.files]); e.target.value = ''; } }),
    h('input', { id: 'pick-folder', type: 'file', webkitdirectory: true, class: 'sr', tabindex: -1, 'aria-label': t('addFolder'), onChange: (e) => { addFiles([...e.target.files]); e.target.value = ''; } }),
    h('div', { class: 'intake-pick row' }, h('button', { class: 'btn quiet small', type: 'button', onClick: () => document.getElementById('pick-files').click() }, icon('image', { size: 16 }), t('addFiles')), h('button', { class: 'btn quiet small', type: 'button', onClick: () => document.getElementById('pick-folder').click() }, icon('folder', { size: 16 }), t('addFolder'))),
    manifestPanel(),
    generic.map(([j, i]) => scanPanel(j, i)),
    state.error ? h('div', { class: 'note bad', role: 'alert' }, h('span', null, state.error), state.errorProxy ? h('button', { class: 'btn small', id: 'set-proxy', type: 'button', onClick: openSettings }, t('setProxy')) : null) : null,
    recents()
  );
  setTimeout(() => grow(area), 0);
  return h('section', { class: 'intake' }, col);
};

on('intake-refresh', refreshHarvestLabel);
