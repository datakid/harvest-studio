import { state, prefs, save, emit } from '../store.js';
import { h, icon } from '../dom.js';
import { t, setLang, getLang } from '../i18n.js';
import { rescan } from '../inputs.js';
import { seg } from '../ui/seg.js';
import { langOf } from './intake.js';
import { openSettings } from './settings-sheet.js';

export const renderBar = () => {
  const bar = h(
    'header',
    { class: 'bar' },
    h('div', { class: 'brand' }, h('img', { src: '/favicon.svg', alt: '', width: 32, height: 32 }), h('span', null, t('appName'))),
    seg(t('theme'), [['system', t('themeSystem')], ['light', t('themeLight')], ['dark', t('themeDark')]], prefs.theme, (v) => {
      prefs.theme = v;
      if (v === 'system') delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = v;
      save();
      emit('tiles');
    }),
    h(
      'button',
      {
        class: 'btn quiet',
        type: 'button',
        lang: getLang() === 'ar' ? 'en' : 'ar',
        onClick: () => {
          prefs.lang = getLang() === 'ar' ? 'en' : 'ar';
          setLang(prefs.lang);
          save();
          for (const j of state.pending.jsons) rescan(j, j.scan.fields || {}, langOf(j));
          emit('all');
        }
      },
      getLang() === 'ar' ? 'English' : 'العربية'
    ),
    h('button', { class: 'btn icon quiet', type: 'button', 'aria-label': t('settings'), title: t('settings'), onClick: openSettings }, icon('settings'))
  );
  return bar;
};
