/* ============================================================================
   IQONS +  ·  ИНСТРУМЕНТ КАЛИБРОВКИ ПОЛОЖЕНИЯ СНИМКА
   preview placement calibration tool — place-tuner.js
   ----------------------------------------------------------------------------
   v2, 19 Sep 2026. Replaces the twelve-item tuner that was inline in
   mockups/final1/shop.html.

   WHAT IT CALIBRATES
   Every cut-out photograph in the shop preview pane is drawn by the morph
   shader from three numbers:

       h    the photograph's HEIGHT as a fraction of the preview stage
       cx   the photograph's centre, across the stage   (0 = left,  1 = right)
       cy   the photograph's centre, down the stage     (0 = top,   1 = bottom)

   The width is never stored. It follows from h and the file's own aspect
   ratio, which is why nothing the tool produces can ever stretch a garment.
   Storing the HEIGHT rather than the width is what keeps a garment the same
   physical size on screen while the pane changes shape.

   WHY IT IS KEYED BY IMAGE AND NOT BY INDEX
   The old tuner wrote into PLACE[productIndex]. That breaks the moment the
   catalogue is real: a product added, removed or re-sorted shifts every index
   after it and silently re-points every calibration at the wrong garment. It
   also could not reach past the twelfth product at all.

   This version keys on the image's own file name. A calibration therefore
   belongs to a PHOTOGRAPH, not to a position in a list — it survives sorting,
   filtering, pagination, re-pricing and the catalogue doubling in size, and
   two products sharing one photograph share one calibration for free.

   HOW TO RUN IT
   Open the shop page with ?tune=1 and read
   spec/IQONS_placement_calibration.md. Nothing in this file executes unless
   the host page has set window.PLACE_TUNER first.

   WHAT THE HOST PAGE MUST PROVIDE
     window.PLACE_TUNER = {
       stage:      '#wstage',        // the preview stage element, or a selector
       grid:       '#grid',          // OPTIONAL. clicking a card selects it
       placements: PLACEMENTS,       // {key: {h,cx,cy}} — EDITED IN PLACE
       defaults:   DEFAULTS,         // OPTIONAL frozen copy, for "reset"
       items: [                      // one entry per DISTINCT photograph
         {key:'01_kurtka.png', url:'…/01_kurtka.png', name:'Куртка…',
          index:0, uses:1},
         …
       ],
       live: (item) => {}            // OPTIONAL. draw it through the real shader
     };

   `placements` is mutated in place, so whatever the page already reads out of
   it keeps working while you tune. Nothing else in the page is touched.
   ========================================================================= */
(() => {
'use strict';

const CFG = window.PLACE_TUNER;
if(!CFG) return;
if(window.__PLACE_TUNER_ON) return;      /* a double include must not double the panel */
window.__PLACE_TUNER_ON = true;

const el = s => (typeof s === 'string' ? document.querySelector(s) : s);

const stage = el(CFG.stage);
const grid  = el(CFG.grid);
const PLACE = CFG.placements;
const ITEMS = (CFG.items || []).filter(i => i && i.key && i.url);

if(!stage || !PLACE || !ITEMS.length){
  console.warn('[place-tuner] nothing to tune: need a stage, a placements map and items');
  return;
}

/* ---------------------------------------------------------------------------
   1 · CONSTANTS
   The auto-fit targets. These are the numbers that decide what "placed
   correctly" means before a human touches anything, so they are the first
   thing to change if the house style for the preview ever moves.
   ------------------------------------------------------------------------ */
const STORE_KEY = 'iqons.place.v2';

/* ANCHOR_TOP — where the top of the garment's ink lands, down the stage.
   Measured back out of the twelve placements approved on 19 Sep: eight of
   them sit between 0.005 and 0.014, so the approved look hangs a garment from
   the very top of the pane. (09, 10 sit at 0.099 and 11 at 0.240; those three
   were moved down by eye and are exactly the kind of exception the operator
   is there to make.) */
const ANCHOR_TOP = 0.010;

/* INK_H — how much of the stage's height the garment fills, in «по вещи»
   mode only. The median of the same twelve is 0.803; 0.885 is that rounded up
   to fill the pane, which is what that mode is for. */
const INK_H     = 0.885;

const ALPHA_MIN = 16;      /* a pixel counts as garment above this alpha (0–255) */
const SCAN_MAX  = 320;     /* long side the alpha scan downsamples to, in px     */
const H_MIN     = 0.05, H_MAX = 3.0;

/* ---------------------------------------------------------------------------
   2 · DEFAULTS AND STORAGE
   The file's own values are captured BEFORE anything is restored over them,
   so "reset" returns to the page and not to the last sitting.

   Storage is per photograph, and each stored entry carries a fingerprint of
   the file default it was made against. When a calibration is pasted into the
   page as a new default, only THAT photograph's stored entry is dropped —
   the old tuner stamped the whole table and threw away an evening's work on
   every other garment whenever one value was applied.
   ------------------------------------------------------------------------ */
const DEFAULTS = {};
Object.keys(CFG.defaults || PLACE).forEach(k => {
  const v = (CFG.defaults || PLACE)[k];
  if(v) DEFAULTS[k] = {h:v.h, cx:v.cx, cy:v.cy};
});

const fp = v => v ? [v.h, v.cx, v.cy].map(n => (+n).toFixed(4)).join('/') : '-';

let restored = 0, dropped = 0;
try{
  const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
  if(raw && raw.items){
    Object.keys(raw.items).forEach(k => {
      const e = raw.items[k];
      if(!e || typeof e.h !== 'number') return;
      if(e.base !== fp(DEFAULTS[k])){ dropped++; return; }   /* the page moved under it */
      PLACE[k] = {h:e.h, cx:e.cx, cy:e.cy};
      if(e.auto) PLACE[k].auto = true;
      restored++;
    });
  }
}catch(e){ /* corrupt storage must never stop the page loading */ }

let saveT = 0;
function save(){
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try{
      const items = {};
      Object.keys(PLACE).forEach(k => {
        const v = PLACE[k];
        if(!v) return;
        items[k] = {h:v.h, cx:v.cx, cy:v.cy, auto:!!v.auto, base:fp(DEFAULTS[k])};
      });
      localStorage.setItem(STORE_KEY, JSON.stringify({v:2, at:Date.now(), items}));
    }catch(e){ flash('Не удалось сохранить — хранилище браузера переполнено'); }
  }, 250);
}

/* ---------------------------------------------------------------------------
   3 · MEASURING THE GARMENT
   The auto-fit needs to know where the ink actually is inside the file, which
   for a cut-out means the bounding box of its alpha channel. The scan runs on
   a downsampled copy — a 320px scan is within a pixel of a full-resolution
   one at these sizes and is about forty times cheaper, which matters when the
   panel seeds a whole page of the catalogue in one pass.

   A file with no transparency (a JPEG, or a cut-out exported flattened) has
   no bounding box to find; it reports the full frame and the panel says so,
   because a flattened file in this pane is a production fault, not a
   calibration problem.
   ------------------------------------------------------------------------ */
const inkCache = new Map();

function inkBox(url){
  if(inkCache.has(url)) return inkCache.get(url);
  const p = new Promise(resolve => {
    const im = new Image();
    im.crossOrigin = 'anonymous';        /* a CDN needs CORS or the canvas taints */
    im.onload = () => {
      const scale = Math.min(1, SCAN_MAX / Math.max(im.naturalWidth, im.naturalHeight));
      const w = Math.max(1, Math.round(im.naturalWidth  * scale));
      const h = Math.max(1, Math.round(im.naturalHeight * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d', {willReadFrequently:true});
      g.drawImage(im, 0, 0, w, h);
      let d;
      try{ d = g.getImageData(0, 0, w, h).data; }
      catch(e){                          /* tainted canvas — cross-origin, no CORS */
        return resolve({x0:0, y0:0, x1:1, y1:1, flat:true, tainted:true,
                        aspect:im.naturalWidth / im.naturalHeight});
      }
      let x0 = w, y0 = h, x1 = -1, y1 = -1, opaque = 0;
      for(let y = 0; y < h; y++){
        for(let x = 0; x < w; x++){
          const a = d[(y*w + x)*4 + 3];
          if(a === 255) opaque++;
          if(a > ALPHA_MIN){
            if(x < x0) x0 = x;
            if(x > x1) x1 = x;
            if(y < y0) y0 = y;
            if(y > y1) y1 = y;
          }
        }
      }
      const flat = opaque === w*h;       /* every pixel solid: no cut-out */
      const box = (x1 < 0 || flat)
        ? {x0:0, y0:0, x1:1, y1:1, flat:true}
        : {x0:x0/w, y0:y0/h, x1:(x1+1)/w, y1:(y1+1)/h, flat:false};
      box.aspect = im.naturalWidth / im.naturalHeight;
      resolve(box);
    };
    im.onerror = () => resolve(null);
    im.src = url;
  });
  inkCache.set(url, p);
  return p;
}

/* The arithmetic that turns an ink box into h/cx/cy. Both modes hang the
   garment's ink from ANCHOR_TOP and centre its ink — not its file — across
   the stage. They differ only in how they choose the size, and the choice
   matters enough to be the operator's:

   'frame'  (по кадру, the default) — h = 1: the photograph fills the stage's
            height exactly as it was shot. Every frame in this catalogue comes
            off one mannequin at one camera distance, so the file's own scale
            is already the truth: a waistcoat is SHORTER than a coat and must
            stay shorter. This is the mode for a catalogue shot in one setting.

   'ink'    (по вещи) — every garment is scaled to the same height on the
            stage, whatever it is. Right only when photographs arrive from
            mixed sources at mixed distances and the frame carries no usable
            scale. It WILL blow a waistcoat up to the size of a coat.

   The twelve approved placements are 'frame' plus a size nudge by eye: their
   h values run 0.875–1.134 around 1. That spread is the judgement the tool
   cannot make, which is why auto-fit seeds and a person confirms.

   cx is a stage coordinate, so a garment whose ink is off-centre INSIDE its
   file gets an off-centre cx, and that one number is the only part of a
   calibration that is not aspect-independent: it is exact at the window it
   was computed for and drifts a little as the pane changes shape. Files whose
   garment is centred (cx lands on 0.5000) are immune. Export cut-outs
   centred and this stops being a consideration at all. */
function fit(box, boxAspect, mode){
  const inkH = Math.max(1e-3, box.y1 - box.y0);
  const h    = clamp(mode === 'ink' ? INK_H / inkH : 1, H_MIN, H_MAX);
  const cy   = ANCHOR_TOP - box.y0 * h + h/2;
  const sx   = h * box.aspect / boxAspect;
  const inkCx = (box.x0 + box.x1) / 2;
  const cx   = 0.5 + (0.5 - inkCx) * sx;
  return {h:r4(h), cx:r4(cx), cy:r4(cy)};
}

const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const r4    = n => Math.round(n * 1e4) / 1e4;

/* Russian counts take three forms and the site's rule is to build them in
   from the start, tooling included: 1 товар · 2 товара · 5 товаров. */
function plural(n, one, few, many){
  const m10 = n % 10, m100 = n % 100;
  if(m10 === 1 && m100 !== 11) return one;
  if(m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
const count = (n, o, f, m) => n + ' ' + plural(n, o, f, m);
const stageAspect = () => {
  const r = stage.getBoundingClientRect();
  return r.width / Math.max(1, r.height);
};

/* ---------------------------------------------------------------------------
   4 · STATE
   ------------------------------------------------------------------------ */
let cur = 0, prev = 0, ghostOp = 0.10, liveMode = false;
let query = '', onlyTodo = false, fitMode = 'frame';
const tuned = k => !!(PLACE[k] && !PLACE[k].auto);
const seeded = k => !!PLACE[k];

/* ---------------------------------------------------------------------------
   5 · THE PANEL'S OWN STYLESHEET
   Everything is scoped under html.tuning or #tp so that removing ?tune=1
   leaves the page byte-for-byte as it ships.
   ------------------------------------------------------------------------ */
const css = document.createElement('style');
css.textContent = `
  /* the shader's canvas and the crossfade image stand down; the tool draws
     its own two plates with the same arithmetic the shader uses */
  html.tuning:not(.tuning-live) .wstage canvas,
  html.tuning:not(.tuning-live) .wstage img#w-img{display:none !important}
  html.tuning.tuning-live .wstage img.tw{display:none !important}

  /* .wstage in the selectors, so these outrank the pane's own "..wstage img"
     rule, which sets opacity:0 for the crossfade the canvas replaced.
     right/bottom are released because that rule pins inset:0 and the geometry
     here comes from left/top/width/height instead. */
  .wstage img.tw{position:absolute; right:auto; bottom:auto; opacity:1;
      object-fit:contain; object-position:center; transition:none;
      pointer-events:none; display:block}
  .wstage img.tw.active{cursor:grab; pointer-events:auto; z-index:3}
  .wstage img.tw.ghost{z-index:2}

  /* The page boots with the shell closed, and a closed shell sets .window to
     opacity 0 — the plates are laid out correctly inside it but painted
     invisible, which is what "no image in the preview" looks like. This is a
     visibility override and nothing more: no class is forced and the page's
     own open/closed state machine is left alone. */
  html.tuning .shell.is-closed .window{opacity:1; transform:none; pointer-events:auto}
  html.tuning .hud{opacity:.25}
  html.tuning .card{cursor:pointer}
  html.tuning .card.tuning-sel .tile{outline:2px solid #c8102e; outline-offset:2px}

  /* the guides: where the auto-fit puts the top of a garment, and the centre */
  .tw-guide{position:absolute; inset:0; z-index:4; pointer-events:none; display:none}
  html.tuning.tuning-guides .tw-guide{display:block}
  .tw-guide i{position:absolute; background:#c8102e; opacity:.55}
  .tw-guide i.h{left:0; right:0; height:1px}
  .tw-guide i.v{top:0; bottom:0; width:1px}

  #tp{position:fixed; top:0; right:0; width:320px; height:100vh; z-index:9999;
      background:#fff; border-left:1px solid #ddd; overflow:hidden;
      display:flex; flex-direction:column;
      font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace; color:#111;
      box-sizing:border-box}
  /* Three regions, and only the middle one scrolls. The controls are what the
     hand is on all day, so they never move; the list is what grows to several
     hundred rows, so it gets every pixel left over. */
  #tp .fixed{flex:0 0 auto; padding:12px 14px 0}
  #tp .scroll{flex:1 1 auto; min-height:120px; overflow-y:auto;
      overscroll-behavior:contain; padding:0 14px; border-top:1px solid #eee}
  #tp .sticky{position:sticky; top:0; background:#fff; padding-top:8px; z-index:1}
  #tp .foot{flex:0 0 auto; padding:10px 14px 14px; border-top:1px solid #eee;
      background:#fafafa}
  #tp h3{margin:0 0 2px; font-size:12px; letter-spacing:.08em; text-transform:uppercase}
  #tp .prog{color:#777; margin:0; font-size:11px}
  #tp .prog b{color:#111; font-weight:400}
  #tp .bar{height:3px; background:#eee; margin:5px 0 8px; position:relative}
  #tp .bar i{position:absolute; inset:0 auto 0 0; background:#111}
  #tp .bar i.auto{background:#bbb; z-index:0}
  #tp .row{margin:0 0 7px}
  #tp label{display:flex; justify-content:space-between; align-items:center;
      margin-bottom:2px; gap:8px}
  #tp input[type=range]{width:100%; margin:0; accent-color:#111}
  #tp input[type=text]{width:78px; font:inherit; padding:2px 4px; border:1px solid #ddd}
  #tp .row.two{display:flex; gap:8px; align-items:center}
  #tp .row.two select{flex:0 0 auto; font:inherit; font-size:11px; padding:3px;
      border:1px solid #ddd; background:#fff}
  #tp .ghostrow{flex:1 1 auto; display:flex; align-items:center; gap:6px;
      margin:0; color:#777; font-size:11px}
  #tp .ghostrow span{flex:0 0 30px}
  #tp .find{width:100%; font:inherit; padding:5px 6px; border:1px solid #ddd;
      box-sizing:border-box; margin-bottom:6px}
  #tp .todo{display:flex; align-items:center; gap:6px; margin-bottom:8px;
      color:#555; font-size:11px; cursor:pointer}
  #tp .items{display:flex; flex-direction:column; gap:2px; margin-bottom:12px}
  #tp .items button{font:inherit; font-size:11px; padding:4px 6px; cursor:pointer;
      text-align:left; background:#f6f6f6; border:1px solid #eee; display:flex;
      gap:6px; align-items:baseline; content-visibility:auto;
      contain-intrinsic-size:auto 24px}
  #tp .items button .n{color:#999; flex:0 0 34px}
  #tp .items button .t{flex:1 1 auto; overflow:hidden; white-space:nowrap;
      text-overflow:ellipsis}
  #tp .items button .s{flex:0 0 auto; width:7px; height:7px; border:1px solid #bbb;
      border-radius:50%; align-self:center}
  #tp .items button.seeded .s{background:#bbb}
  #tp .items button.done   .s{background:#111; border-color:#111}
  #tp .items button.on{background:#111; color:#fff; border-color:#111}
  #tp .items button.on .n{color:#999}
  #tp .items button.on .s{border-color:#666}
  #tp .none{color:#999; padding:6px 0}
  #tp textarea{width:100%; height:120px; font:11px/1.35 ui-monospace,Menlo,monospace;
      border:1px solid #ddd; padding:6px; box-sizing:border-box; margin-top:6px}
  #tp .btn{font:inherit; font-size:11px; padding:5px 7px; cursor:pointer;
      background:#111; color:#fff; border:0; margin:0 4px 4px 0}
  #tp .btn.alt{background:#eee; color:#111; border:1px solid #ccc}
  #tp .btn.warn{background:#fff; color:#c8102e; border:1px solid #e3b6bd}
  #tp .hint{color:#777; margin:8px 0; font-size:11px}
  #tp .warn{color:#c8102e}
  #tp .flash{position:fixed; right:334px; top:14px; background:#111; color:#fff;
      padding:6px 9px; font:11px ui-monospace,Menlo,monospace; z-index:10000;
      opacity:0; transition:opacity .2s}
  #tp .flash.on{opacity:1}
  #tp details{margin-top:8px}
  #tp summary{cursor:pointer; color:#555; font-size:11px}
  html.tuning{--tw-pad:320px}
  html.tuning body{padding-right:var(--tw-pad)}
`;
document.head.appendChild(css);
document.documentElement.classList.add('tuning', 'tuning-guides');

/* ---------------------------------------------------------------------------
   6 · THE TWO PLATES AND THE GUIDES
   Positioned by exactly the arithmetic the shader uses, so what is dragged
   here is what the page draws. The one asymmetry is cy: the panel measures it
   from the TOP, because that is what the numbers mean to a person, while GL's
   uv runs the other way. The shop page mirrors it in placement(); do not
   "fix" one without the other or every plate lands as far below centre as it
   was tuned above it.
   ------------------------------------------------------------------------ */
const ghost  = document.createElement('img'); ghost.className  = 'tw ghost';
const active = document.createElement('img'); active.className = 'tw active';
ghost.alt = active.alt = '';
const guide = document.createElement('div');
guide.className = 'tw-guide';
guide.innerHTML = `<i class="h" style="top:${ANCHOR_TOP*100}%"></i>`
                + `<i class="v" style="left:50%"></i>`;
stage.append(ghost, active, guide);

function put(el, p){
  if(!p) return;
  const r = stage.getBoundingClientRect();
  const bA = r.width / Math.max(1, r.height);
  /* the plate's OWN aspect, read off the decoded file — not a nominal one.
     The cut-outs are not all 408x612 (11 Жилет кожаный is 476x524), and
     assuming a constant here letterboxes those inside the box in the tool
     while the page fills it, so the tuned size does not carry across. */
  const nA = (el.naturalWidth && el.naturalHeight)
           ? el.naturalWidth / el.naturalHeight : (2/3);
  const sy = p.h, sx = p.h * nA / bA;
  el.style.left   = ((p.cx - sx/2) * 100) + '%';
  el.style.top    = ((p.cy - sy/2) * 100) + '%';
  el.style.width  = (sx * 100) + '%';
  el.style.height = (sy * 100) + '%';
}

/* ---------------------------------------------------------------------------
   7 · SELECTION AND PAINT
   Selecting a photograph that has never been calibrated auto-fits it first,
   so the operator always starts from something close and never from a
   garment dumped in the middle of the pane. An auto-fit is marked `auto` and
   counts as "seeded, not checked" until a human moves it or accepts it.
   ------------------------------------------------------------------------ */
async function ensure(i){
  const it = ITEMS[i];
  if(!it || PLACE[it.key]) return;
  const box = await inkBox(it.url);
  if(!box) return;
  if(PLACE[it.key]) return;                      /* another pass got there first */
  PLACE[it.key] = Object.assign(fit(box, stageAspect(), fitMode), {auto:true});
  save();
}

async function select(i, reveal = true){
  if(i < 0 || i >= ITEMS.length) return;
  if(i !== cur) prev = cur;
  cur = i;
  await ensure(i);
  paint();
  /* only when the operator moved: scrolling the row into view on the first
     paint drags the whole panel down before anything has been asked of it */
  if(!reveal) return;
  const b = items.querySelector(`button[data-i="${i}"]`);
  if(b) b.scrollIntoView({block:'nearest'});
}

function paint(){
  const it = ITEMS[cur], pv = ITEMS[prev] || it;
  const p  = PLACE[it.key], q = PLACE[pv.key];

  active.src = it.url; ghost.src = pv.url;
  active.onload = ghost.onload = () => { put(active, p); put(ghost, q); };
  ghost.style.opacity = (pv === it) ? 0 : ghostOp;
  put(active, p); put(ghost, q);

  if(p){
    sx_.value = nx.value = p.cx.toFixed(4);
    sy_.value = ny.value = p.cy.toFixed(4);
    sh_.value = nh.value = p.h.toFixed(4);
  }
  title.textContent = (cur+1) + '. ' + (it.name || it.key);
  file.textContent  = it.key
    + (it.uses > 1 ? '  · ' + count(it.uses, 'товар', 'товара', 'товаров') : '');

  if(liveMode && CFG.live) CFG.live(it);

  /* the grid marks the selected card when it happens to be on this page */
  if(grid){
    grid.querySelectorAll('.card.tuning-sel').forEach(c => c.classList.remove('tuning-sel'));
    const c = grid.querySelector(`.card[data-i="${it.index}"]`);
    if(c) c.classList.add('tuning-sel');
  }
  markList();
  progress();
  out.value = dumpJS();
  save();
}

/* ---------------------------------------------------------------------------
   8 · THE PANEL
   ------------------------------------------------------------------------ */
const panel = document.createElement('aside');
panel.id = 'tp';
panel.innerHTML = `
  <div class="fixed">
    <h3>Положение снимка</h3>
    <p class="prog" id="prog"></p>
    <div class="bar"><i class="auto" id="barA"></i><i id="barT"></i></div>
    <p class="hint" id="cursel" style="margin:0 0 1px;color:#111"></p>
    <p class="hint" id="curfile" style="margin:0 0 8px"></p>
    <div class="row">
      <label>По горизонтали (cx) <input type="text" inputmode="decimal" id="nx"></label>
      <input type="range" id="sx" min="-0.5" max="1.5" step="0.001">
    </div>
    <div class="row">
      <label>По вертикали (cy) <input type="text" inputmode="decimal" id="ny"></label>
      <input type="range" id="sy" min="-0.5" max="1.5" step="0.001">
    </div>
    <div class="row">
      <label>Размер, высота (h) <input type="text" inputmode="decimal" id="nh"></label>
      <input type="range" id="sh" min="0.20" max="2.60" step="0.001">
    </div>
    <div class="row">
      <button class="btn" id="autoOne">Подогнать</button>
      <button class="btn alt" id="accept">Принять ⏎</button>
      <button class="btn alt" id="reset">Сбросить</button>
    </div>
    <div class="row two">
      <select id="mode" title="Как подгонять">
        <option value="frame">по кадру</option>
        <option value="ink">по вещи</option>
      </select>
      <label class="ghostrow" title="Предыдущий снимок за текущим">
        <span id="gv">10%</span>
        <input type="range" id="sg" min="0" max="1" step="0.01" value="0.10">
      </label>
    </div>
    <p class="hint" id="state"></p>
  </div>

  <div class="scroll">
    <div class="sticky">
      <input class="find" id="find" type="search" placeholder="Найти по названию или файлу"
             autocomplete="off" spellcheck="false">
      <label class="todo"><input type="checkbox" id="todo"> только неоткалиброванные</label>
    </div>
    <div class="items" id="items"></div>
  </div>

  <div class="foot">
    <button class="btn" id="autoAll">Подогнать все</button>
    <button class="btn alt" id="copy">Копировать</button>
    <button class="btn alt" id="dl">Скачать JSON</button>
    <details>
      <summary>Вставить / выгрузить значения</summary>
      <textarea id="out" spellcheck="false"></textarea>
      <button class="btn alt" id="fmtJS">JS</button>
      <button class="btn alt" id="fmtJSON">JSON</button>
      <button class="btn alt" id="imp">Загрузить из поля</button>
      <button class="btn warn" id="resetAll">Сбросить всё</button>
    </details>
    <p class="hint" style="margin-bottom:0">← → ↑ ↓ двигают · shift крупнее ·
    [ ] размер · , . предыдущий/следующий · ⏎ принять · G направляющие ·
    L как на сайте</p>
  </div>
`;
document.body.appendChild(panel);

const $     = id => panel.querySelector('#' + id);
const items = $('items'), out = $('out');
const sx_ = $('sx'), sy_ = $('sy'), sh_ = $('sh'), sg = $('sg');
const nx  = $('nx'), ny  = $('ny'), nh  = $('nh'), gv = $('gv');
const title = $('cursel'), file = $('curfile');

const flashEl = document.createElement('div');
flashEl.className = 'flash';
panel.appendChild(flashEl);
let flashT = 0;
function flash(msg){
  flashEl.textContent = msg;
  flashEl.classList.add('on');
  clearTimeout(flashT);
  flashT = setTimeout(() => flashEl.classList.remove('on'), 1600);
}

/* ---------------------------------------------------------------------------
   9 · THE LIST
   Rendered from the whole catalogue, not from the cards on screen: with
   pagination the grid only ever holds a page of it, and a photograph you
   cannot see still has to be reachable. Search matches the product name and
   the file name; the filter narrows to what has not been checked yet, which
   is how a catalogue of several hundred is worked through without losing the
   place.
   ------------------------------------------------------------------------ */
function visible(){
  const q = query.trim().toLowerCase();
  return ITEMS.map((it, i) => ({it, i})).filter(({it, i}) => {
    if(onlyTodo && tuned(it.key)) return false;
    if(!q) return true;
    return (it.name || '').toLowerCase().includes(q) || it.key.toLowerCase().includes(q);
  });
}

function renderList(){
  const rows = visible();
  items.innerHTML = '';
  if(!rows.length){
    const p = document.createElement('p');
    p.className = 'none';
    p.textContent = onlyTodo ? 'Всё откалибровано.' : 'Ничего не найдено.';
    items.appendChild(p);
    return;
  }
  const frag = document.createDocumentFragment();
  rows.forEach(({it, i}) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.i = i;
    b.innerHTML = `<span class="s"></span><span class="n">${i+1}</span>`
                + `<span class="t"></span>`;
    b.querySelector('.t').textContent = it.name || it.key;
    b.title = it.key;
    b.onclick = () => select(i);
    frag.appendChild(b);
  });
  items.appendChild(frag);
  markList();
}

function markList(){
  items.querySelectorAll('button').forEach(b => {
    const i = +b.dataset.i, k = ITEMS[i].key;
    b.classList.toggle('on', i === cur);
    b.classList.toggle('done', tuned(k));
    b.classList.toggle('seeded', seeded(k) && !tuned(k));
  });
}

function progress(){
  let t = 0, a = 0;
  ITEMS.forEach(it => { if(tuned(it.key)) t++; else if(seeded(it.key)) a++; });
  const n = ITEMS.length;
  $('prog').innerHTML = `<b>${t}</b> проверено · <b>${a}</b> подогнано · `
                      + `<b>${n - t - a}</b> осталось · всего ${n}`;
  $('barT').style.width = (t/n*100) + '%';
  $('barA').style.width = ((t+a)/n*100) + '%';
}

/* ---------------------------------------------------------------------------
   10 · EXPORT
   Two shapes of the same table. The JS block pastes straight into the page
   over the PLACEMENTS literal. The JSON is what a build or a backend reads:
   flat, keyed by file name, no trailing state.
   ------------------------------------------------------------------------ */
function table(){
  const o = {};
  ITEMS.forEach(it => { const v = PLACE[it.key]; if(v) o[it.key] = v; });
  return o;
}
function dumpJS(){
  const t = table();
  const keys = Object.keys(t);
  if(!keys.length) return 'const PLACEMENTS = {};';
  return 'const PLACEMENTS = {\n' + keys.map(k => {
    const v = t[k];
    return `  ${JSON.stringify(k)}: {h:${v.h.toFixed(4)}, cx:${v.cx.toFixed(4)}, `
         + `cy:${v.cy.toFixed(4)}}${v.auto ? ',   // подогнано автоматически, не проверено' : ','}`;
  }).join('\n') + '\n};';
}
function dumpJSON(){
  const t = table(), o = {};
  Object.keys(t).forEach(k => {
    o[k] = {h:+t[k].h.toFixed(4), cx:+t[k].cx.toFixed(4), cy:+t[k].cy.toFixed(4)};
    if(t[k].auto) o[k].auto = true;
  });
  return JSON.stringify({
    version: 2,
    unit: 'stage-fraction',
    note: 'h = height as a fraction of the preview stage; cx/cy = the '
        + "photograph's centre in stage coordinates, cy measured from the top",
    shotRatio: 1.5,
    generated: new Date().toISOString(),
    items: o
  }, null, 2);
}
let fmt = 'js';
const refresh = () => { out.value = fmt === 'js' ? dumpJS() : dumpJSON(); };

/* ---------------------------------------------------------------------------
   11 · WIRING
   ------------------------------------------------------------------------ */
/* every product index that lands on a given photograph, so a click on any
   card in the grid finds the one entry that photograph has in the list */
const BY_INDEX = new Map();
ITEMS.forEach((it, i) => {
  (it.indices && it.indices.length ? it.indices : [it.index])
    .forEach(n => { if(typeof n === 'number' && !BY_INDEX.has(n)) BY_INDEX.set(n, i); });
});

const touch = () => {
  const k = ITEMS[cur].key;
  if(PLACE[k]) delete PLACE[k].auto;     /* a human moved it: it is checked now */
};

const bind = (rng, num, key) => {
  const set = v => {
    /* the fields are plain text so a comma can be typed at all, which means
       the decimal mark is normalised here rather than left to the browser */
    const n = parseFloat(String(v).replace(',', '.'));
    if(!isFinite(n)) return;
    const k = ITEMS[cur].key;
    if(!PLACE[k]) PLACE[k] = {h:1, cx:.5, cy:.5};
    PLACE[k][key] = key === 'h' ? clamp(n, H_MIN, H_MAX) : n;
    touch(); paint();
  };
  rng.addEventListener('input', e => set(e.target.value));
  num.addEventListener('input', e => set(e.target.value));
};
bind(sx_, nx, 'cx'); bind(sy_, ny, 'cy'); bind(sh_, nh, 'h');

sg.addEventListener('input', e => {
  ghostOp = +e.target.value;
  gv.textContent = Math.round(ghostOp*100) + '%';
  paint();
});

$('find').addEventListener('input', e => { query = e.target.value; renderList(); });
$('todo').addEventListener('change', e => { onlyTodo = e.target.checked; renderList(); });

$('autoOne').onclick = async () => {
  const it = ITEMS[cur];
  const box = await inkBox(it.url);
  if(!box) return flash('Файл не открылся');
  if(box.tainted) return flash('Нет доступа к пикселям: нужен CORS на изображениях');
  if(box.flat)    flash('У файла нет прозрачности — подогнано по всему кадру');
  PLACE[it.key] = Object.assign(fit(box, stageAspect(), fitMode), {auto:true});
  paint();
};

$('mode').addEventListener('change', e => { fitMode = e.target.value; });

$('accept').onclick = () => { touch(); paint(); select(Math.min(cur+1, ITEMS.length-1)); };

$('reset').onclick = () => {
  const k = ITEMS[cur].key;
  if(DEFAULTS[k]) PLACE[k] = Object.assign({}, DEFAULTS[k]);
  else delete PLACE[k];
  paint();
};

$('autoAll').onclick = async () => {
  const todo = ITEMS.filter(it => !PLACE[it.key] || PLACE[it.key].auto);
  if(!todo.length) return flash('Нечего подгонять');
  if(!confirm('Подогнать автоматически: '
            + count(todo.length, 'снимок', 'снимка', 'снимков') + '?\n\n'
            + 'Уже проверенные вручную не тронутся.')) return;
  const bA = stageAspect();
  let done = 0, bad = 0;
  for(const it of todo){
    const box = await inkBox(it.url);
    if(!box){ bad++; continue; }
    PLACE[it.key] = Object.assign(fit(box, bA, fitMode), {auto:true});
    done++;
    if(done % 20 === 0){ flash(`${done} / ${todo.length}…`); progress(); }
  }
  paint(); renderList();
  flash(`Подогнано ${done}${bad ? `, не открылось ${bad}` : ''}`);
};

$('copy').onclick = async () => {
  refresh();
  out.select();
  try{ await navigator.clipboard.writeText(out.value); }
  catch(e){ document.execCommand('copy'); }
  flash('Скопировано');
};

$('dl').onclick = () => {
  const blob = new Blob([dumpJSON()], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'iqons-placements.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

$('fmtJS').onclick   = () => { fmt = 'js';   refresh(); };
$('fmtJSON').onclick = () => { fmt = 'json'; refresh(); };

$('imp').onclick = () => {
  let src = out.value.trim();
  const m = src.match(/\{[\s\S]*\}/);
  if(!m) return flash('В поле нет объекта');
  let data;
  try{ data = JSON.parse(m[0]); }
  catch(e){
    /* a pasted JS literal has unquoted keys — accept it too */
    try{ data = (new Function('return (' + m[0] + ')'))(); }
    catch(e2){ return flash('Не разобрать: ни JSON, ни объект JS'); }
  }
  const tbl = data.items || data;
  let n = 0;
  Object.keys(tbl).forEach(k => {
    const v = tbl[k];
    if(!v || typeof v.h !== 'number') return;
    PLACE[k] = {h:v.h, cx:v.cx, cy:v.cy};
    if(v.auto) PLACE[k].auto = true;
    n++;
  });
  paint(); renderList();
  flash(`Загружено ${n}`);
};

$('resetAll').onclick = () => {
  if(!confirm('Отменить всю калибровку и вернуть значения страницы?\n\n'
            + 'Это нельзя отменить.')) return;
  ITEMS.forEach(it => {
    if(DEFAULTS[it.key]) PLACE[it.key] = Object.assign({}, DEFAULTS[it.key]);
    else delete PLACE[it.key];
  });
  try{ localStorage.removeItem(STORE_KEY); }catch(e){}
  paint(); renderList();
};

if(restored || dropped){
  $('state').innerHTML = `Восстановлено из браузера: ${restored}.`
    + (dropped ? ` <span class="warn">Отброшено как устаревшее: ${dropped}</span>
       — значения на странице изменились под ними.` : '');
}

/* pick a product up instead of following its link — capture, so this runs
   before the card's own navigation handler */
if(grid){
  grid.addEventListener('click', e => {
    const card = e.target.closest('.card');
    if(!card) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const at = BY_INDEX.get(+card.dataset.i);
    if(at !== undefined) select(at);
  }, true);
}

/* drag the active plate in the preview */
let drag = null;
active.addEventListener('pointerdown', e => {
  const p = PLACE[ITEMS[cur].key];
  if(!p) return;
  const r = stage.getBoundingClientRect();
  drag = {x:e.clientX, y:e.clientY, cx:p.cx, cy:p.cy, r};
  active.setPointerCapture(e.pointerId);
  active.style.cursor = 'grabbing';
});
active.addEventListener('pointermove', e => {
  if(!drag) return;
  const p = PLACE[ITEMS[cur].key];
  p.cx = r4(drag.cx + (e.clientX - drag.x) / drag.r.width);
  p.cy = r4(drag.cy + (e.clientY - drag.y) / drag.r.height);
  touch(); paint();
});
const endDrag = () => { drag = null; active.style.cursor = 'grab'; };
active.addEventListener('pointerup', endDrag);
active.addEventListener('pointercancel', endDrag);

/* wheel over the preview resizes */
stage.addEventListener('wheel', e => {
  e.preventDefault();
  const p = PLACE[ITEMS[cur].key];
  if(!p) return;
  p.h = r4(clamp(p.h * (e.deltaY > 0 ? 0.98 : 1.02), H_MIN, H_MAX));
  touch(); paint();
}, {passive:false});

addEventListener('keydown', e => {
  if(/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
  const p = PLACE[ITEMS[cur].key];
  const s = e.shiftKey ? 0.01 : 0.002;
  const k = {ArrowLeft:['cx',-s], ArrowRight:['cx',s],
             ArrowUp:['cy',-s],   ArrowDown:['cy',s]}[e.key];
  if(k && p){ e.preventDefault(); p[k[0]] = r4(p[k[0]] + k[1]); touch(); paint(); return; }
  if((e.key === '[' || e.key === ']') && p){
    e.preventDefault();
    p.h = r4(clamp(p.h * (e.key === '[' ? 0.99 : 1.01), H_MIN, H_MAX));
    touch(); paint(); return;
  }
  if(e.key === ',') { e.preventDefault(); select(Math.max(0, cur-1)); return; }
  if(e.key === '.') { e.preventDefault(); select(Math.min(ITEMS.length-1, cur+1)); return; }
  if(e.key === 'Enter'){ e.preventDefault(); $('accept').click(); return; }
  if(e.key === 'g' || e.key === 'G'){
    document.documentElement.classList.toggle('tuning-guides'); return;
  }
  if(e.key === 'l' || e.key === 'L'){
    if(!CFG.live) return flash('Страница не даёт живого просмотра');
    liveMode = !liveMode;
    document.documentElement.classList.toggle('tuning-live', liveMode);
    flash(liveMode ? 'Как на сайте' : 'Плашки инструмента');
    paint();
    return;
  }
});

/* the stage changes shape with the window, and cx is a stage coordinate */
let rt = 0;
new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(paint, 100); }).observe(stage);

renderList();
select(0, false);
console.info('[place-tuner] %d photographs, %d already calibrated',
             ITEMS.length, ITEMS.filter(i => tuned(i.key)).length);
})();
