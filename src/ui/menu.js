import { h, icon } from '../dom.js';
import { popover } from './popover.js';

export const menu = (anchor, items, { label = '' } = {}) => {
  let pop;
  const nodes = items.map((item) => {
    if (item === 'sep') return h('div', { class: 'menu-sep', role: 'separator' });
    return h(
      'button',
      {
        type: 'button',
        class: 'menu-item',
        role: 'menuitem',
        id: item.id,
        'data-act': item.act,
        disabled: item.disabled,
        onClick: () => {
          pop.close();
          item.run();
        }
      },
      item.icon ? icon(item.icon, { size: 18 }) : null,
      item.label
    );
  });
  pop = popover(anchor, nodes, { menu: true, label });
  return pop;
};
