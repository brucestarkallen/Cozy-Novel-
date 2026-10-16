/* Neon Tokyo — a rain-wet street canyon at night, drawn here line by line.
 *
 * Two still drawings and a few moving layers between and above them: the
 * far city and its railway behind, the street and its signs in front, the
 * last train passing between the two, rain, a sign that stutters, light
 * drifting up. Only plain HTML layers move, and only by transform and
 * opacity, so the phone's compositor moves cached pictures — nothing is
 * laid out or painted again while the room is alive. Every window is placed
 * by a seeded hand: the same city every time. */

const W = 900, H = 1600;
const VP = { x: 450, y: 900 };               /* where the street runs to */
const INNER = 0.2;                           /* the facades' far edge, as a share of the near one */

function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const f1 = (n) => Math.round(n * 10) / 10;
/* a point on a facade: `side` -1 left, 1 right; s from 1 (near edge) to INNER (far edge); y0 its height at the near edge */
const at = (side, s, y0) => [f1(VP.x + side * 450 * s), f1(VP.y + (y0 - VP.y) * s)];
const quad = (pts) => `M${pts.map((p) => p.join(' ')).join('L')}Z`;

/* the far city: blocks, rooftop aerials, a scatter of windows */
function farCity(rand) {
  let blocks = '', lit = '', aerials = '';
  let x = 250;
  while (x < 650) {
    const w = 22 + rand() * 48, h = 70 + rand() * 230, top = 900 - h;
    blocks += `M${f1(x)} ${f1(top)}h${f1(w)}V900H${f1(x)}Z`;
    if (rand() < 0.35) aerials += `M${f1(x + w * 0.6)} ${f1(top)}v-${f1(10 + rand() * 30)}`;
    for (let wy = top + 8; wy < 890; wy += 9) for (let wx = x + 4; wx < x + w - 4; wx += 7) {
      if (rand() < 0.18) lit += `M${f1(wx)} ${f1(wy)}h2.4v3.6h-2.4Z`;
    }
    x += w + rand() * 6;
  }
  return { blocks, lit, aerials };
}

/* one facade: floor lines, window bays lit or dark, balcony rails */
function facade(side, rand) {
  const depths = [];
  for (let d = 1; d <= 5.001; d += 0.25) depths.push(1 / d);         /* columns evenly spaced in depth */
  const floors = [];
  for (let y = 150; y <= 1400; y += 86) floors.push(y);
  /* windows near the street read as dim rooms, deeper ones as points of light: three depths, three strengths */
  const lit = { amber: ['', '', ''], cyan: ['', '', ''], rose: ['', '', ''] };
  let dark = '', lines = '', mullions = '';
  for (let f = 0; f < floors.length - 1; f++) {
    const ya = floors[f] + 18, yb = floors[f + 1] - 14;
    lines += `M${at(side, 1, floors[f]).join(' ')}L${at(side, INNER, floors[f]).join(' ')}`;
    for (let c = 0; c < depths.length - 1; c++) {
      const s1 = depths[c], s2 = depths[c + 1];
      const inset = (s1 - s2) * 0.16;
      const a = s1 - inset, b = s2 + inset;
      const p = quad([at(side, a, ya), at(side, b, ya), at(side, b, yb), at(side, a, yb)]);
      const band = s1 > 0.55 ? 0 : s1 > 0.3 ? 1 : 2;
      const r = rand();
      if (r < 0.55) dark += p;
      else lit[r < 0.8 ? 'amber' : r < 0.93 ? 'cyan' : 'rose'][band] += p;
      /* a frame down the middle of the nearer windows */
      if (band < 2) { const m = (a + b) / 2; mullions += `M${at(side, m, ya).join(' ')}L${at(side, m, yb).join(' ')}`; }
    }
  }
  let rails = '';
  for (let f = 2; f < floors.length - 1; f += 3) {
    const y = floors[f + 1] - 10;
    rails += `M${at(side, 1, y).join(' ')}L${at(side, 0.5, y).join(' ')}`;
  }
  return { dark, lit, lines, mullions, rails, edge: quad([at(side, 1, 110), at(side, INNER, 110), at(side, INNER, 1420), at(side, 1, 1420)]) };
}

/* a sign that hangs out from a facade and faces the street */
function hangingSign({ side, s, y0, w, h, words, tube, size, vertical = true }) {
  const [x, y] = at(side, s, y0);
  const ww = w * s, hh = h * s;
  const left = side < 0 ? x : x - ww;
  const step = (vertical ? hh : ww) / (words.length + 0.4);
  const glyphs = words.split('').map((ch, i) => vertical
    ? `<text x="${f1(left + ww / 2)}" y="${f1(y + step * (i + 0.95))}" font-size="${f1(size * s)}">${ch}</text>`
    : `<text x="${f1(left + step * (i + 0.7))}" y="${f1(y + hh * 0.7)}" font-size="${f1(size * s)}">${ch}</text>`).join('');
  return { box: `M${f1(left)} ${f1(y)}h${f1(ww)}v${f1(hh)}h${f1(-ww)}Z`, glyphs, tube, bounds: { x: left, y, w: ww, h: hh } };
}

const SIGNS = [
  { side: -1, s: 0.62, y0: 360, w: 74, h: 520, words: '物語', tube: 'magenta', size: 78 },
  { side: -1, s: 0.36, y0: 520, w: 70, h: 430, words: '夜', tube: 'cyan', size: 92 },
  { side: 1, s: 0.55, y0: 300, w: 72, h: 560, words: 'ノベル', tube: 'cyan', size: 66 },
  { side: 1, s: 0.31, y0: 700, w: 160, h: 70, words: 'BAR', tube: 'amber', size: 54, vertical: false },
];

function signMarkup(sg, { glow = true } = {}) {
  const c = `var(--neon-${sg.tube})`;
  return `<path d="${sg.box}" fill="var(--neon-sign-back)" stroke="${c}" stroke-opacity=".55" stroke-width="2"/>`
    + `<g font-family="'Noto Sans CJK JP','Hiragino Sans','Yu Gothic',sans-serif" font-weight="700" text-anchor="middle" fill="none" stroke-linejoin="round">`
    + (glow ? `<g stroke="${c}" stroke-opacity="var(--neon-halo)" stroke-width="11">${sg.glyphs}</g><g stroke="${c}" stroke-opacity="var(--neon-halo-2)" stroke-width="5">${sg.glyphs}</g>` : '')
    + `<g stroke="var(--neon-core)" stroke-width="1.6" fill="${c}" fill-opacity=".18">${sg.glyphs}</g></g>`;
}

let cache = null;
function build() {
  const rand = seeded(1729);
  const city = farCity(rand);
  const left = facade(-1, rand), right = facade(1, rand);
  const signs = SIGNS.map(hangingSign);
  const [flicker, ...steady] = signs;
  /* the wet street: each sign's light pulled down into the asphalt */
  const puddles = signs.map((sg) => {
    const cx = sg.bounds.x + sg.bounds.w / 2;
    const top = 1030 + (sg.bounds.y + sg.bounds.h - 600) * 0.15;
    return `<rect x="${f1(cx - sg.bounds.w * 0.9)}" y="${f1(top)}" width="${f1(sg.bounds.w * 1.8)}" height="${f1(1600 - top)}" fill="url(#neon-pool-${sg.tube})"/>`;
  }).join('');
  const back = `<svg class="neon-back" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="neon-sky" x2="0" y2="1"><stop stop-color="var(--neon-sky-top)"/><stop offset=".45" stop-color="var(--neon-sky-mid)"/><stop offset=".57" stop-color="var(--neon-horizon)"/><stop offset="1" stop-color="var(--neon-sky-low)"/></linearGradient>
    <radialGradient id="neon-city-glow" cy=".55"><stop stop-color="var(--neon-magenta)" stop-opacity="var(--neon-glow)"/><stop offset=".45" stop-color="var(--neon-violet)" stop-opacity=".22"/><stop offset="1" stop-color="var(--neon-violet)" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#neon-sky)"/>
  <ellipse cx="450" cy="880" rx="430" ry="230" fill="url(#neon-city-glow)"/>
  <circle cx="610" cy="250" r="34" fill="var(--neon-moon)" opacity=".75"/>
  <circle cx="610" cy="250" r="70" fill="var(--neon-moon)" opacity=".08"/>
  <path d="${city.blocks}" fill="var(--neon-far)"/>
  <path d="${city.aerials}" stroke="var(--neon-far)" stroke-width="2"/>
  <path d="${city.lit}" fill="var(--neon-window-far)" opacity=".75"/>
  <path d="M250 826h400v7H250z M290 833v67 M360 833v67 M430 833v67 M500 833v67 M570 833v67 M620 833v67" fill="var(--neon-rail)" stroke="var(--neon-rail)" stroke-width="3"/>
  <path d="M250 823h400" stroke="var(--neon-cyan)" stroke-opacity=".35" stroke-width="1.2"/>
</svg>`;
  const front = `<svg class="neon-front" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="neon-street" x2="0" y2="1"><stop stop-color="var(--neon-street-far)"/><stop offset="1" stop-color="var(--neon-street-near)"/></linearGradient>
    <linearGradient id="neon-facade-l" x2="1"><stop stop-color="var(--neon-wall-near)"/><stop offset="1" stop-color="var(--neon-wall-far)"/></linearGradient>
    <linearGradient id="neon-facade-r" x1="1" x2="0"><stop stop-color="var(--neon-wall-near)"/><stop offset="1" stop-color="var(--neon-wall-far)"/></linearGradient>
    ${['magenta', 'cyan', 'amber'].map((t) => `<linearGradient id="neon-pool-${t}" x2="0" y2="1"><stop stop-color="var(--neon-${t})" stop-opacity="0"/><stop offset=".12" stop-color="var(--neon-${t})" stop-opacity="var(--neon-pool)"/><stop offset="1" stop-color="var(--neon-${t})" stop-opacity="0"/></linearGradient>`).join('')}
  </defs>
  <path d="M0 1420 360 1006h180l360 414v180H0z" fill="url(#neon-street)"/>
  <g opacity=".9">${puddles}</g>
  <path d="M450 1006v594 M405 1006 300 1600 M495 1006 600 1600" stroke="var(--neon-lane)" stroke-width="3" stroke-dasharray="26 34" opacity=".35"/>
  <path d="${left.edge}" fill="url(#neon-facade-l)"/>
  <path d="${right.edge}" fill="url(#neon-facade-r)"/>
  <path d="${left.dark}${right.dark}" fill="var(--neon-window-dark)"/>
  ${['amber', 'cyan', 'rose'].map((t) => [0.34, 0.6, 0.9].map((o, band) => `<path d="${left.lit[t][band]}${right.lit[t][band]}" fill="var(--neon-window-${t})" opacity="${o}"/>`).join('')).join('')}
  <path d="${left.mullions}${right.mullions}" stroke="var(--neon-wall-near)" stroke-width="3"/>
  <path d="${left.lines}${right.lines}" stroke="var(--neon-floor-line)" stroke-width="2"/>
  <path d="${left.rails}${right.rails}" stroke="var(--neon-steel)" stroke-width="3" opacity=".8"/>
  <path d="M0 330C200 380 330 610 450 640S700 380 900 330 M0 470C220 520 340 700 450 720S690 520 900 470" fill="none" stroke="var(--neon-wire)" stroke-width="2" opacity=".55"/>
  ${steady.map((sg) => signMarkup(sg)).join('')}
  <g opacity=".45">${signMarkup(flicker, { glow: false })}</g>
</svg>`;
  /* the sign that stutters: its own small layer, over the place it hangs */
  const b = flicker.bounds, pad = 24;
  const vb = `${f1(b.x - pad)} ${f1(b.y - pad)} ${f1(b.w + pad * 2)} ${f1(b.h + pad * 2)}`;
  const flick = `<svg class="neon-flicker-art" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${signMarkup(flicker)}</svg>`;
  const box = { left: ((b.x - pad) / W) * 100, top: ((b.y - pad) / H) * 100, width: ((b.w + pad * 2) / W) * 100, height: ((b.h + pad * 2) / H) * 100 };
  return { back, front, flick, box };
}

export function tokyoArt() {
  if (!cache) cache = build();
  const { back, front, flick, box } = cache;
  const motes = Array.from({ length: 9 }, (_, i) => `<i class="neon-mote" style="--x:${8 + ((i * 37) % 84)}%;--d:${-i * 2.3}s;--s:${(0.6 + ((i * 7) % 5) / 6).toFixed(2)}"></i>`).join('');
  return `<div class="world-art tokyo-art neon-stage" aria-hidden="true">
  ${back}
  <div class="neon-train" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
  ${front}
  <div class="neon-flicker" style="left:${f1(box.left)}%;top:${f1(box.top)}%;width:${f1(box.width)}%;height:${f1(box.height)}%">${flick}</div>
  <div class="neon-rain neon-rain-far"></div>
  <div class="neon-rain neon-rain-near"></div>
  <div class="neon-motes">${motes}</div>
</div>`;
}
