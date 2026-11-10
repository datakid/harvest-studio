import { state, prefs, mem } from '../store.js';
import { h, icon, kids } from '../dom.js';
import { t } from '../i18n.js';
import { toast } from '../ui/toast.js';
import { download } from '../ui/download.js';
import { seg } from '../ui/seg.js';
import { sheet } from '../ui/sheet.js';
import { colourField, toggle } from '../ui/controls.js';
import { imaged, similarNow, visibleKeys } from '../model.js';
import { runBuild } from '../actions/export.js';
import { openPolish } from './polish.js';

const scopeKeys = (which) => {
  const withImage = (keys) => keys.filter((k) => (state.records.get(k) || {}).hasImage);
  if (which === 'selection') return withImage([...state.sel]);
  if (which === 'visible') return withImage(visibleKeys());
  return imaged().map((r) => r.key);
};

export const openExport = () => {
  state.dirty = true;
  const opts = {
    tab: 'launcher',
    scope: state.sel.size ? 'selection' : 'all',
    formats: new Set(['png', 'webp']),
    sizes: '32, 64, 128, 192',
    quality: 90,
    lossless: false,
    background: '#ffffff',
    themeColor: ''
  };

  return sheet({
    id: 'export-sheet',
    title: t('exportTitle'),
    wide: true,
    build: (api) => {
      const area = h('div', { class: 'sheet-section', id: 'export-area' });
      const tabs = h('div', { class: 'tabs-slot' });

      const scopeSeg = () => {
        const n = (w) => scopeKeys(w).length;
        const options = [['all', t('scopeAll', { n: n('all') })], ['visible', t('scopeVisible', { n: n('visible') })]];
        if (state.sel.size) options.unshift(['selection', t('scopeSelection', { n: n('selection') })]);
        if (!options.some(([v]) => v === opts.scope)) opts.scope = 'all';
        return seg(t('exportTitle'), options, opts.scope, (v) => { opts.scope = v; render(); }, { id: 'exp-scope' });
      };

      const formatNotes = () => [
        h('p', { class: 'hint-text', id: 'exp-format' }, t('formatNote', { v: state.target })),
        prefs.target !== state.target ? h('p', { class: 'hint-text', id: 'exp-mismatch' }, t('targetMismatch', { from: state.target, to: prefs.target })) : null
      ];

      const downloadButton = (label, run, { disabled = false, id } = {}) =>
        h('button', {
          class: 'btn primary',
          id,
          type: 'button',
          disabled,
          onClick: async (e) => {
            const b = e.currentTarget;
            const keep = [...b.childNodes];
            b.disabled = true;
            b.replaceChildren(t('building'));
            try {
              await run();
            } catch (err) {
              toast(t('exportError', { why: err.message }));
            }
            b.replaceChildren(...keep);
            b.disabled = disabled;
          }
        }, icon('download', { size: 18 }), label);

      const renderLauncher = async () => {
        area.replaceChildren(...kids(...formatNotes(), h('p', { class: 'progress-text', role: 'status' }, t('building'))));
        try {
          if (state.dirty || !mem.launcherBuild) {
            mem.launcherBuild = await runBuild('launcher', {});
            state.dirty = false;
          }
          if (opts.tab !== 'launcher' || !area.isConnected) return;
          const b = mem.launcherBuild;
          const stat = b.stats;
          const fails = new Set(b.gate.failures.map((f) => f.code));
          const line = (ok, label, value) => h('li', { class: ok ? 'ok' : 'bad' }, h('span', { class: 'ic ' + (ok ? 'ok' : 'bad') }, icon(ok ? 'check' : 'close', { stroke: 2.6 })), h('span', { class: 'gate-label' }, label), h('small', null, value));
          const contrastFails = b.gate.failures.filter((f) => f.code === 'contrast').length;
          const items = [
            line(!fails.has('atlas-size'), t('gateAtlas') + ' · ' + (stat.atlasMode || '-'), stat.atlasBytes.toLocaleString() + ' / 153,600 B'),
            line(!fails.has('sprite-gzip'), t('gateSprite'), stat.spriteGzip.toLocaleString() + ' / 40,960 B'),
            line(!fails.has('symbol-size'), t('gateGlyphs', { n: stat.symbols }), stat.rejectedGlyphs ? t('gateImageOnly', { n: stat.rejectedGlyphs }) : state.target === 'v4' ? '≤ 1,536 B (' + t('twoTone') + ' ≤ 2,560 B)' : '≤ 1,536 B'),
            line(!fails.has('contrast'), t('gateContrast'), contrastFails ? t('gateLow', { n: contrastFails }) : '3:1')
          ];
          const pairs = similarNow().length;
          area.replaceChildren(...kids(
            ...formatNotes(),
            h('ul', { class: 'gate' }, items),
            b.gate.failures.length ? h('div', { class: 'note bad' }, b.gate.failures.slice(0, 4).map((f) => h('div', null, f.message))) : h('span', { class: 'pill ok', id: 'gate-ok' }, t('gateOk')),
            h('button', { class: 'btn quiet small', id: 'polish-row', type: 'button', onClick: openPolish }, icon(pairs ? 'warn' : 'check', { size: 16 }), t('polishRow', { n: pairs })),
            h('p', { class: 'hint-text' }, t('reportsIncluded')),
            h('pre', { class: 'code' }, b.files.map((f) => 'icons/' + f).join('\n')),
            h('div', { class: 'actions-end' }, downloadButton(t('downloadZip'), async () => download(b.zip, 'launcher-icons.zip'), { disabled: !b.gate.ok, id: 'download-launcher' }))
          ));
        } catch (err) {
          area.replaceChildren(...kids(h('div', { class: 'note bad' }, t('exportError', { why: err.message }))));
        }
      };

      const renderPacks = () => {
        const keys = scopeKeys(opts.scope);
        area.replaceChildren(...kids(
          scopeSeg(),
          h('p', { class: 'hint-text' }, keys.length ? t('packSizes') : t('exportEmpty')),
          h('div', { class: 'row' }, h('div', { class: 'field' }, h('label', { class: 'label' }, t('packBackground')), colourField({ value: opts.background, label: t('packBackground'), id: 'pk-bg', onLive: (v) => { opts.background = v; }, onCommit: (v) => { opts.background = v; } })), h('div', { class: 'field' }, h('label', { class: 'label' }, t('packTheme')), colourField({ value: opts.themeColor || '#1a211e', label: t('packTheme'), id: 'pk-theme', onLive: (v) => { opts.themeColor = v; }, onCommit: (v) => { opts.themeColor = v; } }))),
          h('div', { class: 'actions-end' }, downloadButton(t('downloadZip'), async () => {
            const names = Object.fromEntries(keys.map((k) => [k, state.records.get(k).name]));
            const r = await runBuild('packs', { keys, names, background: opts.background, themeColor: opts.themeColor || null });
            download(r.zip, 'favicon-packs.zip');
          }, { disabled: !keys.length, id: 'download-packs' }))
        ));
      };

      const renderCustom = () => {
        const keys = scopeKeys(opts.scope);
        const fmt = ['png', 'webp', 'avif', 'jxl', 'ico'];
        const readout = h('output', { class: 'adj-out', for: 'cu-q' }, String(opts.quality));
        area.replaceChildren(...kids(
          scopeSeg(),
          h('div', { class: 'label' }, t('formats')),
          h('div', { class: 'checks' }, fmt.map((f) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: opts.formats.has(f), onChange: (e) => { if (e.target.checked) opts.formats.add(f); else opts.formats.delete(f); } }), f.toUpperCase()))),
          h('div', { class: 'field' }, h('label', { for: 'cu-sizes' }, t('sizes')), h('input', { id: 'cu-sizes', type: 'text', value: opts.sizes, inputmode: 'numeric', onInput: (e) => { opts.sizes = e.target.value; } })),
          h('div', { class: 'range adj-row' }, h('label', { class: 'label', for: 'cu-q' }, t('quality')), h('div', { class: 'adj-ctl' }, h('input', { id: 'cu-q', type: 'range', min: 40, max: 100, value: opts.quality, onInput: (e) => { opts.quality = Number(e.target.value); readout.textContent = String(opts.quality); } }), readout)),
          toggle({ id: 'cu-lossless', label: t('lossless'), checked: opts.lossless, onChange: (on) => { opts.lossless = on; } }),
          h('div', { class: 'actions-end' }, downloadButton(t('downloadZip'), async () => {
            const sizes = opts.sizes.split(/[\s,]+/).map(Number).filter((n) => n >= 16 && n <= 1024);
            const r = await runBuild('custom', { keys, formats: [...opts.formats], sizes: sizes.length ? sizes : [192], quality: opts.quality, lossless: opts.lossless });
            download(r.zip, 'icons-custom.zip');
          }, { disabled: !keys.length, id: 'download-custom' }))
        ));
      };

      const render = () => {
        tabs.replaceChildren(...kids(seg(t('exportTitle'), [['launcher', t('scopeLauncher')], ['pack', t('scopePack')], ['custom', t('scopeCustom')]], opts.tab, (v) => { opts.tab = v; render(); }, { wide: true, id: 'exp-tabs' })));
        if (opts.tab === 'launcher') renderLauncher();
        else if (opts.tab === 'pack') renderPacks();
        else renderCustom();
      };

      api.body.append(...kids(api.head(t('exportTitle')), tabs, area));
      render();
    }
  });
};
