import { h, kids } from '../dom.js';
import { t } from '../i18n.js';
import { sheet } from '../ui/sheet.js';

const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

const ROWS = () => [
  ['scSearch', ['/']],
  ['scMove', ['←', '↑', '→', '↓']],
  ['scInspect', ['Enter']],
  ['scToggle', ['Space']],
  ['scAll', [mod, 'A']],
  ['scClear', ['Esc']],
  ['scKeep', ['K']],
  ['scReharvest', ['R']],
  ['scRemove', ['Delete']],
  ['scScale', ['[', ']']],
  ['scNudge', ['Alt', '←↑→↓']],
  ['scUndo', [mod, 'Z']],
  ['scRedo', [mod, 'Shift', 'Z']],
  ['scExport', ['E']],
  ['scHelp', ['?']]
];

export const openShortcuts = () =>
  sheet({
    id: 'shortcuts-sheet',
    title: t('shortcutsTitle'),
    build: (api) => {
      api.body.append(...kids(
        api.head(t('shortcutsTitle')),
        h('dl', { class: 'shortcuts' }, ROWS().flatMap(([key, keys]) => [h('dt', null, t(key)), h('dd', { dir: 'ltr' }, keys.map((k) => h('kbd', null, k)))]))
      ));
    }
  });
