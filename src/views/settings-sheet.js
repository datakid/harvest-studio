import { state, prefs, save, net, emit } from '../store.js';
import { h, kids } from '../dom.js';
import { t, setLang, getLang } from '../i18n.js';
import { rescan } from '../inputs.js';
import { saveToken } from '../prefs.js';
import { seg } from '../ui/seg.js';
import { sheet } from '../ui/sheet.js';
import { toggle, info } from '../ui/controls.js';
import { langOf } from './intake.js';

export const applyTheme = () => {
  if (prefs.theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = prefs.theme;
};

export const openSettings = () =>
  sheet({
    id: 'settings-sheet',
    title: t('settingsTitle'),
    build: (api) => {
      const url = h('input', { id: 'px-url', type: 'url', value: prefs.proxyUrl, placeholder: 'https://your-studio.vercel.app/api/fetch', dir: 'ltr', autocomplete: 'off', spellcheck: false });
      const token = h('input', { id: 'px-token', type: 'password', value: net.token, autocomplete: 'off', dir: 'ltr' });
      const status = !prefs.proxyUrl && net.builtIn ? t('proxyBuiltIn') : prefs.proxyUrl ? t('proxyCustom') : t('proxyNone');
      const commit = () => {
        prefs.proxyUrl = url.value.trim();
        net.token = token.value;
        saveToken(net.token);
        save();
      };
      api.body.append(...kids(
        api.head(t('settingsTitle')),
        h(
          'section',
          { class: 'sheet-section' },
          h('div', { class: 'field' }, h('span', { class: 'label' }, t('theme')), seg(t('theme'), [['system', t('themeSystem')], ['light', t('themeLight')], ['dark', t('themeDark')]], prefs.theme, (v) => { prefs.theme = v; applyTheme(); save(); emit('tiles'); emit('canvas-toolbar'); api.close(); openSettings(); }, { id: 'set-theme' })),
          h('div', { class: 'field' }, h('span', { class: 'label' }, t('language')), seg(t('language'), [['en', 'English'], ['ar', 'العربية']], getLang(), (v) => { prefs.lang = v; setLang(v); save(); for (const j of state.pending.jsons) rescan(j, j.scan.fields || {}, langOf(j)); emit('all'); api.close(); openSettings(); }, { id: 'set-lang' }))
        ),
        h('section', { class: 'sheet-section' }, h('h3', null, t('defaults')), toggle({ id: 'set-fa', label: t('faFallback'), checked: prefs.faFallback, tip: t('faFallbackTip'), onChange: (on) => { prefs.faFallback = on; save(); } })),
        h(
          'section',
          { class: 'sheet-section' },
          h('h3', null, t('proxyTitle'), info(t('proxyTip'))),
          h('p', { class: 'hint-text', id: 'px-status' }, status),
          h('div', { class: 'field' }, h('label', { for: 'px-url' }, t('proxyUrl')), url),
          h('div', { class: 'field' }, h('label', { for: 'px-token' }, t('proxyToken'), info(t('proxyTokenTip'))), token)
        ),
        h('div', { class: 'actions-end' }, h('button', { class: 'btn primary', id: 'set-save', type: 'button', onClick: () => { commit(); api.close(); } }, t('save')))
      ));
    }
  });
