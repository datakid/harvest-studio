export const panel = ({ h, seg, t, colours, mix, fits, outside, apply }) => {
  const root = h('div', { class: 'pick' });
  const all = colours.map((c) => ({ ...c }));
  let picked = [];
  let kind = 'flat';
  const need = () => {
    if (kind === 'flat') picked = picked.slice(-1);
    else
      for (const c of all) {
        if (picked.length > 1) break;
        if (!picked.includes(c.hex)) picked = [...picked, c.hex];
      }
  };
  const toggle = (hex) => {
    picked = picked.includes(hex) ? picked.filter((c) => c !== hex) : [...picked, hex].slice(kind === 'flat' ? -1 : -3);
    draw();
  };
  const custom = (hex) => {
    if (!all.some((c) => c.hex === hex)) all.push({ hex, share: 0, custom: true });
    toggle(hex);
  };
  const draw = () => {
    need();
    const tint = picked.length ? mix(kind, picked) : null;
    const flat = kind !== 'gradient' || picked.length < 2;
    root.replaceChildren(...[
      seg(t('iconColours'), [['flat', t('pickSolid')], ['gradient', t('pickGradient')], ['mix', t('pickMix')]], kind, (v) => { kind = v; draw(); }, { id: 'pick-kind' }),
      h('p', { class: 'hint-text' }, t(kind === 'flat' ? 'pickHintSolid' : 'pickHint')),
      h(
        'div',
        { class: 'row swatches pick-row' },
        all.map((c) => {
          const n = picked.indexOf(c.hex) + 1;
          const label = c.custom ? c.hex : t('pickSwatch', { hex: c.hex, share: Math.round(c.share * 100) });
          return h('button', { type: 'button', class: 'swatch pick-swatch', style: { background: c.hex }, 'aria-pressed': String(n > 0), 'aria-label': label, title: label, 'data-hex': c.hex, onClick: () => toggle(c.hex) }, n && kind !== 'flat' ? h('b', null, String(n)) : null);
        }),
        h('label', { class: 'pick-add', title: t('pickCustom') }, '+', h('input', { type: 'color', id: 'pick-custom', value: picked[picked.length - 1] || '#808080', 'aria-label': t('pickCustom'), onChange: (e) => custom(e.target.value) }))
      ),
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
  draw();
  return root;
};
