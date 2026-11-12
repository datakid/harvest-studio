export const panel = ({ h, seg, t, colours, mix, fits, outside, apply }) => {
  const root = h('div', { class: 'pick' });
  let picked = [];
  let kind = 'gradient';
  const toggle = (hex) => {
    picked = picked.includes(hex) ? picked.filter((c) => c !== hex) : [...picked, hex].slice(-3);
    draw();
  };
  const draw = () => {
    const tint = picked.length ? mix(kind, picked) : null;
    const flat = picked.length < 2 || kind !== 'gradient';
    root.replaceChildren(...[
      h('p', { class: 'hint-text' }, t('pickHint')),
      h(
        'div',
        { class: 'row swatches pick-row' },
        colours.map((c) => {
          const n = picked.indexOf(c.hex) + 1;
          const label = t('pickSwatch', { hex: c.hex, share: Math.round(c.share * 100) });
          return h('button', { type: 'button', class: 'swatch pick-swatch', style: { background: c.hex }, 'aria-pressed': String(n > 0), 'aria-label': label, title: label, 'data-hex': c.hex, onClick: () => toggle(c.hex) }, n ? h('b', null, String(n)) : null);
        })
      ),
      picked.length > 1 ? seg(t('iconColours'), [['gradient', t('pickGradient')], ['mix', t('pickMix')]], kind, (v) => { kind = v; draw(); }, { id: 'pick-kind' }) : null,
      tint
        ? h(
            'div',
            { class: 'row pick-result' },
            h('span', { class: 'pick-bar', 'aria-hidden': 'true', style: { background: flat ? tint[0] : 'linear-gradient(90deg,' + tint[2] + ',' + tint[0] + ',' + tint[1] + ')' } }),
            h('code', { dir: 'ltr' }, tint[0])
          )
        : null,
      tint && outside() && !fits(tint) ? h('p', { class: 'hint-text', id: 'pick-note' }, t('pickOutsideTip')) : null,
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn small', type: 'button', id: 'pick-apply', disabled: !picked.length, onClick: () => apply(kind, picked) }, t('pickApply')),
        picked.length ? h('button', { class: 'btn small quiet', type: 'button', onClick: () => { picked = []; draw(); } }, t('pickClear')) : null
      )
    ].filter(Boolean));
  };
  if (colours.length) draw();
  else root.append(h('p', { class: 'hint-text' }, t('paletteNone')));
  return root;
};
