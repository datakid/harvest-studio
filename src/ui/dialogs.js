import { h } from '../dom.js';
import { t } from '../i18n.js';

export const askDuplicates = (groups, total) =>
  new Promise((resolve) => {
    const extra = groups.reduce((n, g) => n + g.entries.length - 1, 0);
    const dlg = h('dialog', { 'aria-labelledby': 'dup-title', id: 'dup-dialog' });
    let choice = 'cancel';
    const pick = (value) => () => {
      choice = value;
      dlg.close();
    };
    const shown = groups.slice(0, 8);
    dlg.append(
      h(
        'div',
        { class: 'dlg' },
        h('header', null, h('h2', { id: 'dup-title' }, t('dupTitle', { n: groups.length }))),
        h('p', { class: 'hint-text' }, t('dupBody', { n: groups.length, extra, total })),
        h(
          'ul',
          { class: 'dups' },
          shown.map((g) => h('li', null, h('b', { dir: 'auto' }, g.entries.map((e) => e.name).join(' = ')), h('span', { class: 'href', dir: 'ltr' }, g.url))),
          groups.length > shown.length ? h('li', { class: 'more' }, t('dupMore', { n: groups.length - shown.length })) : null
        ),
        h(
          'div',
          { class: 'actions-end' },
          h('button', { class: 'btn quiet', id: 'dup-cancel', type: 'button', onClick: pick('cancel') }, t('dupCancel')),
          h('button', { class: 'btn', id: 'dup-keep', type: 'button', onClick: pick('keep') }, t('dupKeep', { n: total })),
          h('button', { class: 'btn primary', id: 'dup-once', type: 'button', onClick: pick('once') }, t('dupOnce', { n: total - extra }))
        )
      )
    );
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(choice);
    });
    document.body.append(dlg);
    dlg.showModal();
  });

export const askCollisions = (same) =>
  new Promise((resolve) => {
    const dlg = h('dialog', { 'aria-labelledby': 'col-title', id: 'collide-dialog' });
    let choice = 'skip';
    const pick = (v) => () => {
      choice = v;
      dlg.close();
    };
    const shown = same.slice(0, 8);
    dlg.append(
      h(
        'div',
        { class: 'dlg' },
        h('header', null, h('h2', { id: 'col-title' }, t('collideTitle'))),
        h('p', { class: 'hint-text' }, t('collideBody', { n: same.length })),
        h('ul', { class: 'dups' }, shown.map((x) => h('li', null, h('b', { dir: 'auto' }, x.name || x.key), x.url ? h('span', { class: 'href', dir: 'ltr' }, x.url) : null))),
        h(
          'div',
          { class: 'actions-end' },
          h('button', { class: 'btn quiet', id: 'collide-skip', type: 'button', onClick: pick('skip') }, t('collideSkip')),
          h('button', { class: 'btn', id: 'collide-both', type: 'button', onClick: pick('both') }, t('collideBoth')),
          h('button', { class: 'btn primary', id: 'collide-update', type: 'button', onClick: pick('update') }, t('collideUpdate'))
        )
      )
    );
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(choice);
    });
    document.body.append(dlg);
    dlg.showModal();
  });

export const confirmStartOver = () =>
  new Promise((resolve) => {
    const dlg = h('dialog', { 'aria-labelledby': 'so-title', id: 'startover-dialog' });
    let ok = false;
    dlg.append(
      h(
        'div',
        { class: 'dlg' },
        h('header', null, h('h2', { id: 'so-title' }, t('startOverTitle'))),
        h('p', { class: 'hint-text' }, t('startOverBody')),
        h('div', { class: 'actions-end' },
          h('button', { class: 'btn quiet', id: 'startover-cancel', type: 'button', onClick: () => dlg.close() }, t('dupCancel')),
          h('button', { class: 'btn primary', id: 'startover-ok', type: 'button', onClick: () => { ok = true; dlg.close(); } }, t('startOverConfirm'))
        )
      )
    );
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(ok);
    });
    document.body.append(dlg);
    dlg.showModal();
  });
