import { state, app, emit, on } from '../store.js';
import { h, clear, icon } from '../dom.js';
import { t } from '../i18n.js';
import { renderTopbar, refreshTopbar } from './topbar.js';
import { renderIntake } from './intake.js';
import { renderBusy } from './busy.js';
import { renderRail } from './rail.js';
import { renderCanvas } from './canvas.js';
import { refreshSelectionBar } from './selection-bar.js';
import { openSettings } from './settings-sheet.js';
import './inspector.js';

const renderWork = () =>
  h('div', { class: 'work-layout', 'data-compare': String(state.compare) }, renderRail(), renderCanvas(), h('aside', { class: 'inspector', id: 'inspector', 'aria-label': t('inspector') }), h('button', { class: 'rail-scrim', type: 'button', tabindex: -1, 'aria-hidden': 'true', onClick: () => emit('rail-toggle') }));

const chrome = () => {
  const work = state.stage === 'work';
  const bar = app.querySelector('.topbar');
  const corner = app.querySelector('.corner');
  if (work && !bar) {
    if (corner) corner.remove();
    app.prepend(renderTopbar());
  } else if (!work && bar) bar.remove();
  if (!work && !app.querySelector('.corner')) app.prepend(h('div', { class: 'corner' }, h('button', { class: 'btn icon quiet', id: 'settings-btn', type: 'button', 'aria-label': t('settings'), title: t('settings'), onClick: openSettings }, icon('settings'))));
};

export const renderMain = () => {
  chrome();
  let main = app.querySelector('main');
  if (!main) {
    main = h('main', { id: 'main' });
    app.append(main);
  }
  main.dataset.stage = state.stage;
  clear(main);
  main.append(state.stage === 'intake' ? renderIntake() : state.stage === 'busy' ? renderBusy() : renderWork());
  if (state.stage === 'work') {
    emit('inspector');
    refreshSelectionBar();
    refreshTopbar();
  }
  if (state.stage === 'busy') emit('progress');
};

export const renderAll = () => {
  clear(app);
  renderMain();
};

on('main', renderMain);
on('all', renderAll);
