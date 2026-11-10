import { h, icon } from '../dom.js';
import { t } from '../i18n.js';

export const sheet = ({ id, title, wide = false, build, titleId = (id || 'sheet') + '-title' }) => {
  const dlg = h('dialog', { class: 'sheet' + (wide ? ' wide' : ''), id, 'aria-labelledby': titleId });
  const body = h('div', { class: 'sheet-body' });
  const api = {
    el: dlg,
    body,
    close: () => dlg.close(),
    head: (heading) => h('header', { class: 'sheet-head' }, h('h2', { id: titleId }, heading || title), h('button', { class: 'btn icon quiet', type: 'button', 'aria-label': t('close'), title: t('close'), onClick: () => dlg.close() }, icon('close')))
  };
  dlg.append(body);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
  document.body.append(dlg);
  build(api);
  dlg.showModal();
  return api;
};
