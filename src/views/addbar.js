import { state, on } from '../store.js';
import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { parseUrls } from '../inputs.js';
import { addFromFiles, addFromUrls, addSets, setCount } from '../actions/add.js';

export const addBar = () => {
  const bar = h('form', { class: 'addbar', id: 'add-bar', role: 'search', 'aria-label': t('addBarLabel'), onSubmit: async (e) => {
    e.preventDefault();
    const input = document.getElementById('add-urls');
    const text = input.value;
    if (!parseUrls(text).length) return;
    input.value = '';
    await addFromUrls(text);
  } });
  bar.append(
    h('div', { class: 'addbar-row' },
      h('input', { id: 'add-urls', type: 'text', placeholder: t('addUrlPlaceholder'), 'aria-label': t('addUrlPlaceholder'), spellcheck: false, autocapitalize: 'off', autocomplete: 'off', inputmode: 'url' }),
      h('button', { class: 'btn primary', id: 'add-go', type: 'submit' }, icon('plus', { size: 16 }), t('add'))
    ),
    h('div', { class: 'addbar-row addbar-actions' },
      h('button', { class: 'btn', id: 'add-files', type: 'button', onClick: () => document.getElementById('add-pick-files').click() }, icon('image', { size: 16 }), t('addFiles')),
      h('button', { class: 'btn', id: 'add-folder', type: 'button', onClick: () => document.getElementById('add-pick-folder').click() }, icon('folder', { size: 16 }), t('addFolder')),
      h('button', { class: 'btn', id: 'add-json', type: 'button', onClick: () => document.getElementById('add-pick-json').click() }, icon('upload', { size: 16 }), t('addJson')),
      state.catalogue ? h('button', { class: 'btn', id: 'add-launcher', type: 'button', onClick: () => addSets('launcher') }, t('addLauncher', { n: setCount('launcher') })) : null,
      state.fihrist ? h('button', { class: 'btn', id: 'add-fihrist', type: 'button', onClick: () => addSets('fihrist') }, t('addFihrist', { n: setCount('fihrist') })) : null,
      state.catalogue && state.fihrist ? h('button', { class: 'btn', id: 'add-both', type: 'button', onClick: () => addSets('both') }, t('addBoth', { n: setCount('both') })) : null,
      h('span', { class: 'adding', id: 'adding', role: 'status' }, state.adding ? t('working') : '')
    ),
    h('input', { id: 'add-pick-files', type: 'file', multiple: true, accept: 'image/*,.ico,.svg', class: 'sr', tabindex: -1, onChange: (e) => { addFromFiles([...e.target.files]); e.target.value = ''; } }),
    h('input', { id: 'add-pick-folder', type: 'file', webkitdirectory: true, class: 'sr', tabindex: -1, onChange: (e) => { addFromFiles([...e.target.files]); e.target.value = ''; } }),
    h('input', { id: 'add-pick-json', type: 'file', multiple: true, accept: '.json,application/json', class: 'sr', tabindex: -1, onChange: (e) => { addFromFiles([...e.target.files]); e.target.value = ''; } })
  );
  return bar;
};

export const refreshAddBar = () => {
  const el = document.getElementById('adding');
  if (el) el.textContent = state.adding ? t('working') : '';
  document.body.dataset.adding = String(state.adding);
  for (const [id, which] of [['add-launcher', 'launcher'], ['add-fihrist', 'fihrist'], ['add-both', 'both']]) {
    const b = document.getElementById(id);
    if (b) b.textContent = t(id === 'add-launcher' ? 'addLauncher' : id === 'add-fihrist' ? 'addFihrist' : 'addBoth', { n: setCount(which) });
  }
};

on('adding', refreshAddBar);
