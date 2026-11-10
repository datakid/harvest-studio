import { state, on } from '../store.js';
import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { parseUrls } from '../inputs.js';
import { popover } from '../ui/popover.js';
import { addFromFiles, addFromUrls, addSets, setCount } from '../actions/add.js';

export const addInputs = () => [
  h('input', { id: 'add-pick-files', type: 'file', multiple: true, accept: 'image/*,.ico,.svg', class: 'sr', tabindex: -1, 'aria-label': t('addFiles'), onChange: (e) => { addFromFiles([...e.target.files]); e.target.value = ''; } }),
  h('input', { id: 'add-pick-folder', type: 'file', webkitdirectory: true, class: 'sr', tabindex: -1, 'aria-label': t('addFolder'), onChange: (e) => { addFromFiles([...e.target.files]); e.target.value = ''; } }),
  h('input', { id: 'add-pick-json', type: 'file', multiple: true, accept: '.json,application/json', class: 'sr', tabindex: -1, 'aria-label': t('addJson'), onChange: (e) => { addFromFiles([...e.target.files]); e.target.value = ''; } })
];

const pick = (id) => () => document.getElementById(id).click();

export const openAdd = (anchor) => {
  const input = h('input', { id: 'add-urls', type: 'text', placeholder: t('addPlaceholder'), 'aria-label': t('addPlaceholder'), spellcheck: false, autocapitalize: 'off', autocomplete: 'off', inputmode: 'url' });
  const form = h(
    'form',
    {
      class: 'add-form',
      onSubmit: async (e) => {
        e.preventDefault();
        const text = input.value;
        if (!parseUrls(text).length) return;
        input.value = '';
        await addFromUrls(text);
      }
    },
    input,
    h('button', { class: 'btn primary', id: 'add-go', type: 'submit' }, t('add'))
  );
  const files = h(
    'div',
    { class: 'row' },
    h('button', { class: 'btn small', id: 'add-files', type: 'button', onClick: pick('add-pick-files') }, icon('image', { size: 16 }), t('addFiles')),
    h('button', { class: 'btn small', id: 'add-folder', type: 'button', onClick: pick('add-pick-folder') }, icon('folder', { size: 16 }), t('addFolder')),
    h('button', { class: 'btn small', id: 'add-json', type: 'button', onClick: pick('add-pick-json') }, icon('upload', { size: 16 }), t('addJson'))
  );
  const sets = h(
    'div',
    { class: 'row', id: 'add-sets' },
    state.catalogue ? h('button', { class: 'btn small pill', id: 'add-launcher', type: 'button', onClick: () => addSets('launcher') }, t('addLauncher', { n: setCount('launcher') })) : null,
    state.fihrist ? h('button', { class: 'btn small pill', id: 'add-fihrist', type: 'button', onClick: () => addSets('fihrist') }, t('addFihrist', { n: setCount('fihrist') })) : null,
    state.catalogue && state.fihrist ? h('button', { class: 'btn small pill', id: 'add-both', type: 'button', onClick: () => addSets('both') }, t('addBoth', { n: setCount('both') })) : null
  );
  const body = h('div', { id: 'add-bar', role: 'search', 'aria-label': t('add'), class: 'add-pop' }, form, files, sets.children.length ? sets : null, h('span', { class: 'hint-text', id: 'adding', role: 'status' }, state.adding ? t('working') : ''));
  return popover(anchor, body, { label: t('add') });
};

export const refreshAddBar = () => {
  const el = document.getElementById('adding');
  if (el) el.textContent = state.adding ? t('working') : '';
  document.body.dataset.adding = String(state.adding);
  for (const [id, which, key] of [['add-launcher', 'launcher', 'addLauncher'], ['add-fihrist', 'fihrist', 'addFihrist'], ['add-both', 'both', 'addBoth']]) {
    const b = document.getElementById(id);
    if (b) b.textContent = t(key, { n: setCount(which) });
  }
};

on('adding', refreshAddBar);
