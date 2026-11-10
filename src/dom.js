export const h = (tag, props, ...children) => {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk, sv);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
};

export const kids = (...c) => c.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false);

export const clear = (el) => {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
};

const NS = 'http://www.w3.org/2000/svg';
export const svg = (paths, { size = 20, viewBox = '0 0 24 24', stroke = 1.5, fill = 'none', flip = false } = {}) => {
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('viewBox', viewBox);
  el.setAttribute('width', size);
  el.setAttribute('height', size);
  el.setAttribute('fill', fill);
  el.setAttribute('stroke', 'currentColor');
  el.setAttribute('stroke-width', stroke);
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('aria-hidden', 'true');
  if (flip) el.style.transform = 'scaleX(-1)';
  for (const d of [].concat(paths)) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    el.append(p);
  }
  return el;
};

export const ICONS = {
  download: 'M12 4v11m0 0l-4-4m4 4l4-4M5 19h14',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3h0a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5h0a1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9v0a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  upload: 'M12 16V5m0 0l-4 4m4-4l4 4M5 19h14',
  shuffle: 'M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5',
  lock: 'M7 11V8a5 5 0 0110 0v3M5 11h14v10H5z',
  reset: 'M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8M3 3v5h5',
  image: 'M4 5h16v14H4zM8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM20 15l-5-5L5 19',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  warn: 'M12 4l9 16H3zM12 10v4M12 17.5v.01',
  folder: 'M3 6h6l2 2h10v11H3z',
  copy: 'M9 9h11v11H9zM5 15V4h11',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5M12 8v.01',
  chevron: 'M6 9l6 6 6-6',
  next: 'M9 6l6 6-6 6',
  sidebar: 'M4 5h16v14H4zM9 5v14',
  eyedropper: 'M14.5 5.5l4 4M13 7l-8 8v4h4l8-8M17 3.5a2.1 2.1 0 013 3L17.5 9 15 6.5z',
  palette: 'M12 3a9 9 0 100 18c1.6 0 2.2-1.1 1.6-2.2-.5-1 .1-2.1 1.4-2.1H17a4 4 0 004-4c0-5-4-9.7-9-9.7zM7.5 12h.01M9.5 8h.01M14 7.5h.01',
  compare: 'M4 5h7v14H4zM13 5h7v14h-7z',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  filter: 'M4 5h16l-6 7v6l-4 2v-8z',
  sort: 'M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  keyboard: 'M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M8 14h8',
  report: 'M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5',
  minus: 'M5 12h14',
  pin: 'M12 17v5M9 3h6l-1 6 3 3H7l3-3z',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 8h.01',
  box: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10'
};
export const icon = (name, opts) => svg(ICONS[name], opts);
