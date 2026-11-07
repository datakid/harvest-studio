import { prefs, save, net } from '../store.js';
import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { saveToken } from '../prefs.js';

export const openSettings = () => {
  const dlg = h('dialog', { 'aria-labelledby': 'set-title' });
  const url = h('input', { id: 'px-url', type: 'url', value: prefs.proxyUrl, placeholder: 'https://your-studio.vercel.app/api/fetch', autocomplete: 'off', spellcheck: false });
  const token = h('input', { id: 'px-token', type: 'password', value: net.token, autocomplete: 'off' });
  dlg.append(
    h(
      'div',
      { class: 'dlg' },
      h('header', null, h('h2', { id: 'set-title' }, t('proxyTitle')), h('button', { class: 'btn icon quiet', type: 'button', 'aria-label': t('close'), onClick: () => dlg.close() }, icon('close'))),
      h('p', { class: 'hint-text', id: 'px-status' }, !prefs.proxyUrl && net.builtIn ? t('proxyBuiltIn') : prefs.proxyUrl ? t('proxyCustom') : t('proxyNone')),
      h('p', { class: 'hint-text' }, t('proxyBody')),
      h('div', { class: 'field' }, h('label', { for: 'px-url' }, t('proxyUrl')), url),
      h('div', { class: 'field' }, h('label', { for: 'px-token' }, t('net.token')), token, h('p', { class: 'hint-text' }, t('proxyTokenNote'))),
      h('div', { class: 'actions-end' }, h('button', { class: 'btn primary', type: 'button', onClick: () => { prefs.proxyUrl = url.value.trim(); net.token = token.value; saveToken(net.token); save(); dlg.close(); } }, t('save')))
    )
  );
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
};
