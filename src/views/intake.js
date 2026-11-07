import { state, prefs, save, emit } from '../store.js';
import { h, icon } from '../dom.js';
import { t, getLang } from '../i18n.js';
import { filesFromDrop, rescan, pendingCount } from '../inputs.js';
import { listProjects, removeProject } from '../projects.js';
import { seg } from '../ui/seg.js';
import { openProject } from '../actions/project.js';
import { addFiles, baseOf, harvestSets, openManifest, startHarvest } from '../actions/harvest.js';

export const pendingChips = () => {
  const chips = [];
  state.pending.files.forEach((f, i) => chips.push(h('span', { class: 'chip' }, f.name, h('button', { type: 'button', 'aria-label': t('close'), onClick: () => { state.pending.files.splice(i, 1); emit('main'); } }, icon('close', { size: 14 })))));
  return chips.length ? h('div', { class: 'chips' }, chips) : null;
};

export const langOf = (json) => json.lang || getLang();

export const scanPanel = (json, index) => {
  const s = json.scan;
  const panel = h('div', { class: 'scan' });
  if (s.kind === 'none') {
    panel.append(h('h3', null, json.name), h('p', { class: 'hint-text' }, t('scanNone')));
    return panel;
  }
  panel.append(h('h3', null, t('scanFound', { n: s.count, label: s.kind === 'launcher' ? t('scanLauncher') : s.kind === 'fihrist' ? t('scanFihrist') : s.label }) + ' · ' + json.name));
  if (s.kind === 'generic') {
    const select = (label, key, options, value, allowNone) =>
      h(
        'div',
        { class: 'field' },
        h('label', null, label),
        h(
          'select',
          {
            onChange: (e) => {
              const v = e.target.value === '' ? null : e.target.value;
              const f = { ...s.fields, [key]: v };
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
    panel.append(
      h(
        'div',
        { class: 'scan-grid' },
        s.candidates.collections.length > 1 ? select(t('scanCollection'), 'collection', s.candidates.collections.map((c) => c.path), s.fields.collection, false) : null,
        s.candidates.url.length ? select(t('scanUrl'), 'urlField', s.candidates.url, s.fields.urlField, true) : null,
        s.candidates.icon.length ? select(t('scanIcon'), 'iconField', s.candidates.icon, s.fields.iconField, true) : null,
        s.candidates.name.length ? select(t('scanName'), 'nameField', s.candidates.name, s.fields.nameField, true) : null
      )
    );
  }
  if (s.languages && s.languages.length > 1) {
    panel.append(
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
              rescan(json, s.fields || {}, langOf(json));
              emit('main');
            }
          },
          h('option', { value: '', selected: !json.lang }, t('labelLanguageAuto')),
          s.languages.map((l) => h('option', { value: l, selected: l === json.lang }, l))
        )
      )
    );
  }
  panel.append(h('ul', null, s.targets.slice(0, 4).map((x) => h('li', null, h('b', { dir: 'auto' }, x.name || x.key), x.url ? h('span', { dir: 'ltr', class: 'href' }, '  ' + x.url) : null))));
  panel.append(h('div', { class: 'row' }, h('button', { class: 'btn quiet', type: 'button', onClick: () => { state.pending.jsons.splice(index, 1); emit('main'); } }, icon('trash', { size: 16 }), t('close'))));
  return panel;
};

export const manifestNeeds = () => {
  const m = state.pending.bundle.manifest;
  if (!m) return null;
  const wanted = [m.data.atlas && baseOf(m.data.atlas.file), m.data.glyphAtlas && baseOf(m.data.glyphAtlas.file), m.data.glyphSprite && baseOf(m.data.glyphSprite.file)].filter(Boolean);
  const missing = wanted.filter((f) => !state.pending.bundle.files.has(f));
  const atlasMissing = !!(m.data.atlas && !state.pending.bundle.files.has(baseOf(m.data.atlas.file)));
  return { missing, atlasMissing, count: Object.keys(m.data.icons).length };
};

export const manifestPanel = () => {
  const need = manifestNeeds();
  if (!need) return null;
  return h(
    'div',
    { class: 'scan', id: 'manifest-panel' },
    h('h3', null, t('manifestFound', { n: need.count }) + ' · ' + state.pending.bundle.manifest.name),
    need.missing.length ? h('p', { class: 'hint-text' }, need.missing.map((f) => t('manifestNeed', { file: f })).join(' ')) : h('p', { class: 'hint-text' }, t('manifestReady')),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'open-set', type: 'button', disabled: need.atlasMissing, onClick: openManifest }, t('manifestOpen')), h('button', { class: 'btn quiet', type: 'button', onClick: () => { state.pending.bundle = { manifest: null, files: new Map() }; emit('main'); } }, icon('trash', { size: 16 }), t('close')))
  );
};

export const ago = (ms) => {
  const mins = Math.round((Date.now() - ms) / 60000);
  const rtf = new Intl.RelativeTimeFormat(getLang(), { numeric: 'auto' });
  if (mins < 60) return rtf.format(-Math.max(mins, 0), 'minute');
  if (mins < 1440) return rtf.format(-Math.round(mins / 60), 'hour');
  return rtf.format(-Math.round(mins / 1440), 'day');
};

export const recentsPanel = () => {
  if (!state.projects.length) return null;
  return h(
    'section',
    { class: 'recents', 'aria-labelledby': 'recents-title' },
    h('h2', { id: 'recents-title' }, t('projectsTitle')),
    h(
      'ul',
      null,
      state.projects.map((p) =>
        h(
          'li',
          null,
          h('button', { class: 'recent', type: 'button', dataset: { id: p.id }, onClick: () => openProject(p), 'aria-label': t('projectOpen') + ' ' + p.name }, h('span', { class: 'dots', 'aria-hidden': 'true' }, (p.dots || []).map((c) => h('i', { style: { background: c } }))), h('span', { class: 'rname' }, p.name || t('projectsTitle')), h('small', null, t('projectIcons', { n: p.count }) + ' · ' + ago(p.updatedAt))),
          h('button', { class: 'btn icon quiet', type: 'button', 'aria-label': t('projectDelete', { name: p.name }), onClick: async () => { await removeProject(p.id); state.projects = await listProjects(); if (state.stage === 'intake') emit('main'); } }, icon('trash', { size: 16 }))
        )
      )
    ),
    h('p', { class: 'hint-text' }, t('projectsNote'))
  );
};

export const targetPanel = () =>
  h(
    'div',
    { class: 'target-pick', id: 'target-pick' },
    h('span', null, t('targetTitle')),
    seg(t('targetTitle'), [['v3', t('targetV3')], ['v4', t('targetV4')]], prefs.target, (v) => { prefs.target = v; save(); emit('main'); }),
    h('p', { class: 'hint-text' }, prefs.target === 'v4' ? t('targetV4Hint') : t('targetV3Hint'))
  );

export const renderIntake = () => {
  const urlText = state.pending.urlText;
  const count = pendingCount(state.pending);
  const over = (on) => (e) => {
    e.preventDefault();
    e.currentTarget.classList.toggle('over', on);
  };
  const drop = h(
    'div',
    {
      class: 'drop',
      onDragenter: over(true),
      onDragover: over(true),
      onDragleave: over(false),
      onDrop: async (e) => {
        e.preventDefault();
        e.currentTarget.classList.remove('over');
        await addFiles(await filesFromDrop(e.dataTransfer));
      }
    },
    icon('upload', { size: 26 }),
    h('strong', null, t('dropTitle')),
    h('span', { class: 'hint' }, t('dropBody')),
    h(
      'div',
      { class: 'row', style: { 'justify-content': 'center', 'margin-top': '6px' } },
      h('button', { class: 'btn', type: 'button', onClick: () => document.getElementById('pick-files').click() }, icon('image', { size: 16 }), t('browseFiles')),
      h('button', { class: 'btn', type: 'button', onClick: () => document.getElementById('pick-folder').click() }, icon('folder', { size: 16 }), t('browseFolder'))
    ),
    h('input', { id: 'pick-files', type: 'file', multiple: true, accept: 'image/*,.ico,.svg,.json,application/json', class: 'sr', tabindex: -1, onChange: (e) => { addFiles([...e.target.files]); e.target.value = ''; } }),
    h('input', { id: 'pick-folder', type: 'file', webkitdirectory: true, class: 'sr', tabindex: -1, onChange: (e) => { addFiles([...e.target.files]); e.target.value = ''; } })
  );
  const label = count === 0 ? t('harvest') : count === 1 ? t('harvestOne') : t('harvestN', { n: count });
  const hero = h(
    'section',
    { class: 'hero' },
    h(
      'div',
      null,
      h('h1', { class: 'sr' }, t('appName')),
      h(
        'div',
        { class: 'intake' },
        setButtons(),
        h(
          'form',
          { class: 'field', onSubmit: (e) => { e.preventDefault(); startHarvest(); } },
          h('label', { for: 'urls' }, t('urlLabel')),
          h(
            'div',
            { class: 'url-row' },
            h('textarea', { id: 'urls', rows: 1, placeholder: t('urlPlaceholder'), spellcheck: false, autocapitalize: 'off', autocomplete: 'off', inputmode: 'url', value: urlText, onInput: (e) => { state.pending.urlText = e.target.value; refreshHarvestLabel(); }, onKeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); startHarvest(); } } }),
            h('button', { class: 'btn primary', id: 'go', type: 'submit' }, label)
          )
        ),
        drop,
        pendingChips(),
        manifestPanel(),
        targetPanel(),
        state.pending.jsons.map(scanPanel),
        state.pending.jsons.some((j) => j.scan.kind === 'launcher') ? h('label', { class: 'check', id: 'fa-fallback' }, h('input', { type: 'checkbox', checked: prefs.faFallback, onChange: (e) => { prefs.faFallback = e.target.checked; save(); } }), t('faFallback')) : null,
        state.error ? h('div', { class: 'note bad', role: 'alert' }, state.error) : null,
        recentsPanel()
      )
    )
  );
  hero.querySelector('textarea').value = urlText;
  return hero;
};

export const setButtons = () => {
  const buttons = [];
  if (state.catalogue) buttons.push(h('button', { class: 'btn primary catalogue', id: 'harvest-catalogue', type: 'button', onClick: () => harvestSets('launcher') }, icon('folder', { size: 16 }), t('harvestCatalogue', { n: state.catalogue.count })));
  if (state.fihrist) buttons.push(h('button', { class: 'btn', id: 'harvest-fihrist', type: 'button', onClick: () => harvestSets('fihrist') }, icon('folder', { size: 16 }), t('harvestFihrist', { n: state.fihrist.count })));
  if (state.catalogue && state.fihrist) buttons.push(h('button', { class: 'btn', id: 'harvest-both', type: 'button', onClick: () => harvestSets('both') }, icon('folder', { size: 16 }), t('harvestBoth', { n: state.catalogue.count + state.fihrist.count })));
  return buttons.length ? h('div', { class: 'sets' }, buttons) : null;
};

export const refreshHarvestLabel = () => {
  const go = document.getElementById('go');
  if (!go) return;
  const n = pendingCount(state.pending);
  go.textContent = n === 0 ? t('harvest') : n === 1 ? t('harvestOne') : t('harvestN', { n });
};
