import { h, kids } from '../dom.js';
import { t } from '../i18n.js';
import { sheet } from './sheet.js';

const ask = ({ id, titleId, title, body, list, buttons, fallback }) =>
  new Promise((resolve) => {
    let choice = fallback;
    const api = sheet({
      id,
      titleId,
      title,
      build: (s) => {
        s.body.append(...kids(
          h('header', { class: 'sheet-head' }, h('h2', { id: titleId }, title)),
          body ? h('p', { class: 'hint-text' }, body) : null,
          list || null,
          h('div', { class: 'actions-end' }, buttons.map(([value, bid, label, kind]) => h('button', { class: 'btn' + (kind ? ' ' + kind : ''), id: bid, type: 'button', onClick: () => { choice = value; s.close(); } }, label)))
        ));
      }
    });
    api.el.addEventListener('close', () => resolve(choice));
  });

const rows = (items, more) => h('ul', { class: 'dups' }, items, more ? h('li', { class: 'more' }, more) : null);

export const askDuplicates = (groups, total) => {
  const extra = groups.reduce((n, g) => n + g.entries.length - 1, 0);
  const shown = groups.slice(0, 8);
  return ask({
    id: 'dup-dialog',
    titleId: 'dup-title',
    title: t('dupTitle', { n: groups.length }),
    body: t('dupBody', { extra, total }),
    list: rows(shown.map((g) => h('li', null, h('b', { dir: 'auto' }, g.entries.map((e) => e.name).join(' = ')), h('span', { class: 'href', dir: 'ltr' }, g.url))), groups.length > shown.length ? t('dupMore', { n: groups.length - shown.length }) : null),
    buttons: [['cancel', 'dup-cancel', t('dupCancel'), 'quiet'], ['keep', 'dup-keep', t('dupKeep', { n: total })], ['once', 'dup-once', t('dupOnce', { n: total - extra }), 'primary']],
    fallback: 'cancel'
  });
};

export const askCollisions = (same) => {
  const shown = same.slice(0, 8);
  return ask({
    id: 'collide-dialog',
    titleId: 'collide-title',
    title: t('collideTitle'),
    body: t('collideBody', { n: same.length }),
    list: rows(shown.map((x) => h('li', null, h('b', { dir: 'auto' }, x.name || x.key), x.url ? h('span', { class: 'href', dir: 'ltr' }, x.url) : null))),
    buttons: [['skip', 'collide-skip', t('collideSkip'), 'quiet'], ['both', 'collide-both', t('collideBoth')], ['update', 'collide-update', t('collideUpdate'), 'primary']],
    fallback: 'skip'
  }).then((c) => c);
};

export const confirmStartOver = () =>
  ask({
    id: 'startover-dialog',
    titleId: 'startover-title',
    title: t('startOverTitle'),
    body: t('startOverBody'),
    buttons: [[false, 'startover-cancel', t('cancel'), 'quiet'], [true, 'startover-ok', t('startOverConfirm'), 'primary']],
    fallback: false
  });
