import { state, app, emit, on } from '../store.js';
import { h, clear } from '../dom.js';
import { renderBar } from './topbar.js';
import { renderIntake } from './intake.js';
import { renderBusy } from './busy.js';
import { renderWork } from './workspace.js';

export const renderMain = () => {
  let main = document.querySelector('main');
  if (!main) {
    main = h('main');
    app.append(main);
  }
  clear(main);
  main.append(state.stage === 'intake' ? renderIntake() : state.stage === 'busy' ? renderBusy() : renderWork());
  if (state.stage === 'work') emit('inspector');
  if (state.stage === 'busy') emit('progress');
};

export const renderAll = () => {
  clear(app);
  app.append(renderBar());
  renderMain();
};

on('main', renderMain);
on('all', renderAll);
