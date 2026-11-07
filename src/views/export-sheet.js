import { state, prefs, client, mem, proxySettings } from '../store.js';
import { h, clear, icon } from '../dom.js';
import { t } from '../i18n.js';
import { toast } from '../ui/toast.js';
import { download } from '../ui/download.js';
import { seg } from '../ui/seg.js';
import { patches } from '../actions/export.js';

export const openExport = () => {
  state.dirty = true;
  const dlg = h('dialog', { 'aria-labelledby': 'exp-title' });
  const body = h('div', { class: 'dlg' });
  dlg.append(body);
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  let tab = 'launcher';
  const stateOpts = { formats: new Set(['png', 'webp']), sizes: '32, 64, 128, 192', quality: 90, lossless: false, name: '', background: '#ffffff', themeColor: '', key: state.selected || state.order.find((k) => state.records.get(k).hasImage) };

  const render = async () => {
    clear(body);
    body.append(
      h('header', null, h('h2', { id: 'exp-title' }, t('exportTitle')), h('button', { class: 'btn icon quiet', type: 'button', 'aria-label': t('close'), onClick: () => dlg.close() }, icon('close'))),
      seg(t('exportTitle'), [['launcher', t('tabLauncher')], ['pack', t('tabPack')], ['custom', t('tabCustom')]], tab, (v) => { tab = v; render(); }, { wide: true })
    );
    const area = h('div', { class: 'dlg', style: { padding: 0 } });
    body.append(area);
    if (tab === 'launcher') await renderLauncher(area);
    else if (tab === 'pack') renderPack(area);
    else renderCustom(area);
  };

  const run = async (type, payload) => {
    await client.call('configure', { wasmBase: '/wasm/', settings: await proxySettings() });
    return client.call('build', { patches: patches(), target: state.target, seed: state.seed, cell: state.cell || undefined, ...payload, kind: type });
  };

  const renderLauncher = async (area) => {
    const formatNotes = () => [h('p', { class: 'hint-text', id: 'exp-format' }, state.target === 'v4' ? t('exportV4') : t('exportV3')), prefs.target !== state.target ? h('p', { class: 'hint-text', id: 'exp-mismatch' }, t('targetMismatch', { from: state.target, to: prefs.target })) : null];
    area.append(h('p', { class: 'hint-text' }, t('launcherIntro')), ...formatNotes(), h('p', { class: 'progress-text' }, t('building')));
    try {
      if (state.dirty || !mem.launcherBuild) {
        mem.launcherBuild = await run('launcher', {});
        state.dirty = false;
      }
      const b = mem.launcherBuild;
      clear(area);
      area.append(...formatNotes());
      const items = [];
      const stat = b.stats;
      const line = (ok, label, value) => h('li', null, h('span', { class: 'ic ' + (ok ? 'ok' : 'bad') }, icon(ok ? 'check' : 'close', { stroke: 2.6 })), label, h('small', null, value));
      const fails = new Set(b.gate.failures.map((f) => f.code));
      items.push(line(!fails.has('atlas-size'), 'atlas.webp (' + (stat.atlasMode || '-') + ')', stat.atlasBytes.toLocaleString() + ' / 153,600 B'));
      items.push(line(!fails.has('sprite-gzip'), 'glyphs.svg gzip', stat.spriteGzip.toLocaleString() + ' / 40,960 B'));
      items.push(line(!fails.has('symbol-size'), t('gateGlyphs', { n: stat.symbols }), stat.rejectedGlyphs ? t('gateImageOnly', { n: stat.rejectedGlyphs }) : state.target === 'v4' ? '≤ 1,536 B (' + t('twoTone') + ' ≤ 2,560 B)' : '≤ 1,536 B'));
      items.push(line(!fails.has('contrast'), t('gateContrast'), b.gate.failures.filter((f) => f.code === 'contrast').length ? t('gateLow', { n: b.gate.failures.filter((f) => f.code === 'contrast').length }) : '3:1'));
      area.append(
        h('p', { class: 'hint-text' }, t('launcherIntro')),
        h('ul', { class: 'gate' }, items),
        b.gate.failures.length ? h('div', { class: 'note bad' }, b.gate.failures.slice(0, 4).map((f) => h('div', null, f.message))) : h('div', { class: 'pill ok', style: { 'justify-self': 'start' } }, t('gateOk')),
        h('pre', { class: 'code' }, b.files.map((f) => 'icons/' + f).join('\n')),
        h('div', { class: 'actions-end' }, h('button', { class: 'btn primary', type: 'button', disabled: !b.gate.ok, onClick: () => download(b.zip, 'launcher-icons.zip') }, icon('download', { size: 18 }), t('downloadZip')))
      );
    } catch (e) {
      clear(area);
      area.append(h('div', { class: 'note bad' }, t('exportFailed', { why: e.message })));
    }
  };

  const renderPack = (area) => {
    const keys = state.order.filter((k) => state.records.get(k).hasImage);
    const preview = h('pre', { class: 'code', id: 'head-tags' }, '');
    area.append(
      h('p', { class: 'hint-text' }, t('packIntro')),
      h('div', { class: 'field' }, h('label', { for: 'pk-icon' }, t('packIcon')), h('select', { id: 'pk-icon', onChange: (e) => { stateOpts.key = e.target.value; } }, keys.map((k) => h('option', { value: k, selected: k === stateOpts.key }, state.records.get(k).name)))),
      h('div', { class: 'field' }, h('label', { for: 'pk-name' }, t('packName')), h('input', { id: 'pk-name', type: 'text', placeholder: (state.records.get(stateOpts.key) || {}).name || '', value: stateOpts.name, onInput: (e) => { stateOpts.name = e.target.value; } })),
      h('div', { class: 'row' }, h('div', { class: 'field' }, h('label', { for: 'pk-bg' }, t('packBackground')), h('input', { id: 'pk-bg', type: 'color', value: stateOpts.background, style: { 'min-height': '48px', padding: '4px' }, onInput: (e) => { stateOpts.background = e.target.value; } })), h('div', { class: 'field' }, h('label', { for: 'pk-theme' }, t('packTheme')), h('input', { id: 'pk-theme', type: 'color', value: stateOpts.themeColor || '#1a211e', style: { 'min-height': '48px', padding: '4px' }, onInput: (e) => { stateOpts.themeColor = e.target.value; } }))),
      h('div', { class: 'label' }, t('headTags')),
      preview,
      h('div', { class: 'actions-end' }, h('button', { class: 'btn', type: 'button', onClick: async () => { await navigator.clipboard.writeText(preview.textContent); toast(t('copied')); } }, icon('copy', { size: 16 }), t('copy')), h('button', { class: 'btn primary', type: 'button', onClick: async (e) => { const b = e.currentTarget; b.disabled = true; try { const r = await run('pack', { key: stateOpts.key, name: stateOpts.name || (state.records.get(stateOpts.key) || {}).name, background: stateOpts.background, themeColor: stateOpts.themeColor || null }); preview.textContent = r.head; download(r.zip, (stateOpts.key || 'favicon') + '-favicon-pack.zip'); } catch (err) { toast(t('exportFailed', { why: err.message })); } b.disabled = false; } }, icon('download', { size: 18 }), t('downloadZip')))
    );
    preview.textContent = '<link rel="icon" href="/favicon.ico" sizes="48x48">\n<link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">\n<link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192">\n<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n<link rel="manifest" href="/site.webmanifest">';
  };

  const renderCustom = (area) => {
    const fmt = ['png', 'webp', 'avif', 'jxl', 'ico'];
    area.append(
      h('p', { class: 'hint-text' }, t('customIntro')),
      h('div', { class: 'label' }, t('formats')),
      h('div', { class: 'checks' }, fmt.map((f) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: stateOpts.formats.has(f), onChange: (e) => { if (e.target.checked) stateOpts.formats.add(f); else stateOpts.formats.delete(f); } }), f.toUpperCase()))),
      h('div', { class: 'field' }, h('label', { for: 'cu-sizes' }, t('sizes')), h('input', { id: 'cu-sizes', type: 'text', value: stateOpts.sizes, inputmode: 'numeric', onInput: (e) => { stateOpts.sizes = e.target.value; } })),
      h('div', { class: 'row' }, h('div', { class: 'range', style: { flex: 1 } }, h('label', { class: 'label', for: 'cu-q' }, t('quality') + ' ' + stateOpts.quality), h('input', { id: 'cu-q', type: 'range', min: 40, max: 100, value: stateOpts.quality, onInput: (e) => { stateOpts.quality = Number(e.target.value); e.target.previousElementSibling.textContent = t('quality') + ' ' + stateOpts.quality; } })), h('label', { class: 'check' }, h('input', { type: 'checkbox', onChange: (e) => { stateOpts.lossless = e.target.checked; } }), t('lossless'))),
      h('div', { class: 'actions-end' }, h('button', { class: 'btn primary', type: 'button', onClick: async (e) => { const b = e.currentTarget; b.disabled = true; try { const sizes = stateOpts.sizes.split(/[\s,]+/).map(Number).filter((n) => n >= 16 && n <= 1024); const r = await run('custom', { formats: [...stateOpts.formats], sizes: sizes.length ? sizes : [192], quality: stateOpts.quality, lossless: stateOpts.lossless }); download(r.zip, 'icons-custom.zip'); } catch (err) { toast(t('exportFailed', { why: err.message })); } b.disabled = false; } }, icon('download', { size: 18 }), t('downloadZip')))
    );
  };

  dlg.showModal();
  render();
};
