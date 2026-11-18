/*!
 * Cloud VPN — загрузчики «пёс догоняет зайца» и «облачко-едок» с процентом.
 * Нарисовано с нуля (SVG-фигуры), без картинок и чужой графики. Без зависимостей.
 *
 * Подключение: <script src="cv-loader.js"></script> или import './cv-loader.js' (Vite/webpack).
 * Всё доступно через globalThis.CvLoaders = { cvLoader, CvLoad, cvLoadStrip, cvAutoSwap, snapshot }.
 *
 *   const l = cvLoader(el, { kind: 'chase' | 'eater' | 'auto', label: 'Загрузка', size: 54 });
 *   l.set(42);           // настоящий процент (0..100)
 *   l.label('Сервера');  // подпись
 *   await l.done();      // доводит до 100%: пёс догнал зайца / едок съел приз
 *   l.destroy();
 *   Без set() процент берётся из CvLoad (общие запросы страницы), а если их нет — оценивается по времени.
 *   progress: 'loop' — бесконечный бег без процента.
 *
 *   <cv-loader kind="chase" progress="42" label="Загрузка"></cv-loader>   — то же как элемент.
 *
 *   CvLoad — общий счётчик загрузок страницы: CvLoad.attachAxios(axios), CvLoad.wrapFetch(),
 *   const t = CvLoad.begin(); CvLoad.progress(t, 0.5); CvLoad.end(t); CvLoad.subscribe(fn).
 *   cvLoadStrip() — тонкая полоса с бегущими фигурками вверху страницы, пока что-то грузится.
 *   cvAutoSwap(document.body) — заменяет крупные круглые спиннеры (.animate-spin и др.) на загрузчик.
 *
 * Цвета берутся из CSS-переменных (с запасными значениями), так что загрузчик подходит
 * к светлой, тёмной и ff7-теме: --cvl-text, --cvl-dim, --cvl-track, --cvl-edge, --cvl-glow.
 */
(function () {
  'use strict';
  var G = typeof globalThis !== 'undefined' ? globalThis : window;
  if (G.CvLoaders) return;

  var NS = 'http://www.w3.org/2000/svg';
  var OUT = '#0A0F2E';
  var STEP = 180;          // полшага: 360 мс на полный шаг (две позы)
  var LAP = 2600;          // круг в режиме без процента
  var FINISH = 900;        // финальная сценка
  var H0 = 54;             // базовая высота: все фигуры заданы в единицах u = высота/54
  var LINE_Y = 46;         // линия на 0,86 высоты
  var PAD = 6;
  var GAP = 46;            // заяц впереди пса на 46u
  var reduce = false;
  try { reduce = G.matchMedia && G.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* */ }

  // ── фигуры: списки слоёв; сначала общий контур, потом заливки ──
  function E(cx, cy, rx, ry, f, rot) { return { k: 'e', cx: cx, cy: cy, rx: rx, ry: ry, f: f, rot: rot }; }
  function C(cx, cy, r, f) { return { k: 'e', cx: cx, cy: cy, rx: r, ry: r, f: f }; }
  function P(d, f) { return { k: 'p', d: d, f: f }; }
  function Ln(d, f, w, noOutline) { return { k: 'l', d: d, f: f, w: w, no: noOutline }; }
  function R(x, y, w, h, r, f) { return { k: 'r', x: x, y: y, w: w, h: h, r: r, f: f }; }

  function geo(s) {
    if (s.k === 'e') {
      return (s.rx === s.ry ? '<circle cx="' + s.cx + '" cy="' + s.cy + '" r="' + s.rx + '"' :
        '<ellipse cx="' + s.cx + '" cy="' + s.cy + '" rx="' + s.rx + '" ry="' + s.ry + '"') +
        (s.rot ? ' transform="rotate(' + s.rot + ')"' : '');
    }
    if (s.k === 'r') return '<rect x="' + s.x + '" y="' + s.y + '" width="' + s.w + '" height="' + s.h + '" rx="' + s.r + '"';
    return '<path d="' + s.d + '"';
  }

  function draw(shapes, ow) {
    if (ow == null) ow = 2.4;
    var o = '', f = '';
    for (var i = 0; i < shapes.length; i++) {
      var s = shapes[i];
      if (s.k === 'l') {
        if (!s.no && ow > 0) o += geo(s) + ' fill="none" stroke="' + OUT + '" stroke-width="' + (s.w + ow) + '" stroke-linecap="round" stroke-linejoin="round"/>';
        f += geo(s) + ' fill="none" stroke="' + s.f + '" stroke-width="' + s.w + '" stroke-linecap="round" stroke-linejoin="round"/>';
      } else {
        if (!s.no && ow > 0) o += geo(s) + ' fill="' + OUT + '" stroke="' + OUT + '" stroke-width="' + ow + '" stroke-linejoin="round"/>';
        f += geo(s) + ' fill="' + s.f + '"/>';
      }
    }
    return o + f;
  }

  // Рисунок = слои [фигуры, толщина контура]; первый слой — дальние лапы (рисуются под телом).
  // Эти же данные экспортируются в Kotlin (tools/gen_race_kotlin.js → android/common/CvRaceArt.kt).
  function art(layers, lift) {
    var main = '';
    for (var i = 1; i < layers.length; i++) main += draw(layers[i][0], layers[i][1]);
    return { layers: layers, lift: lift, far: draw(layers[0][0], layers[0][1]), main: main };
  }

  // Пёс (золотистый, хвост бубликом). Начало координат — между лапами на линии, смотрит вправо.
  var DOG = { body: '#F4C552', far: '#D2A03A', ear: '#8A5A12', cheek: '#FFF1CC', nose: '#21253C', eye: '#101F6E' };
  function dog(frame) {
    var a = frame === 0, c = DOG;
    var legsFar = a ? [Ln('M5 -11L11 -3', c.far, 3.4), Ln('M-10 -10L-17 -5', c.far, 3.4)]
      : [Ln('M5 -11L1.5 -1.5', c.far, 3.4), Ln('M-10 -10L-6.5 -1.5', c.far, 3.4)];
    var legsNear = a ? [Ln('M7.5 -11L14 -4', c.body, 3.4), Ln('M-7.5 -10L-14.5 -3', c.body, 3.4)]
      : [Ln('M7.5 -11L4.5 -1', c.body, 3.4), Ln('M-7.5 -10L-3 -1', c.body, 3.4)];
    var body = [
      Ln('M-11.5 -16C-16.5 -18 -17 -25 -12.5 -25.5C-9.5 -25.8 -9.8 -21.5 -12.4 -21.6', c.body, 3.2),
      E(-2, -15, 11, 6.2, c.body), E(6.5, -17.5, 5, 6, c.body), C(11, -23, 5.6, c.body),
      E(16.4, -21, 3.9, 2.7, c.body), P('M8.6 -27L10.2 -32.5L13.8 -26.8Z', c.ear),
      E(14.6, -19.4, 3.2, 1.6, c.cheek)
    ];
    var face = [C(20, -21.7, 1.3, c.nose), C(12.9, -24.2, 1.05, c.eye)];
    return art([[legsFar, 2.4], [body.concat(legsNear), 2.4], [face, 0]], a ? -2 : 0);
  }

  // Заяц (белый, длинные уши). Смотрит вправо; flip — смотрит влево.
  var HARE = { body: '#F2F4FA', shade: '#C9D0E2', inner: '#F7B8C8', eye: '#101F6E' };
  function hare(frame) {
    var a = frame === 0, c = HARE;
    var legsFar = a ? [Ln('M1.5 -9L7.5 -5', c.shade, 3), Ln('M-7 -9L-15.5 -7', c.shade, 3.2)]
      : [Ln('M1.5 -9L0 -1', c.shade, 3), Ln('M-7 -9L-6 -1', c.shade, 3.2)];
    var legsNear = a ? [Ln('M3.5 -9L10 -5.5', c.body, 3), Ln('M-5.5 -9L-14 -5', c.body, 3.4)]
      : [Ln('M3.5 -9L2.5 -1', c.body, 3), Ln('M-5.5 -9L-3 -1', c.body, 3.4)];
    var body = [
      E(0.8, -25.5, 1.9, 6, c.shade, '-28 3.4 -20'), C(-11.6, -13.6, 2.8, c.body),
      E(-3, -12, 8.6, 6, c.body), C(5.8, -17.2, 4.6, c.body),
      E(3, -26, 2.1, 6.4, c.body, '-16 4.8 -20')
    ];
    var face = [E(3, -26.4, 0.8, 4.2, c.inner, '-16 4.8 -20'), C(7.6, -18.3, 0.95, c.eye), C(10.2, -16.7, 0.7, c.inner)];
    return art([[legsFar, 2.4], [body.concat(legsNear), 2.4], [face, 0]], a ? -4 : 0);
  }

  // Облачко-едок: белое облако со ртом справа. Рот открывается и закрывается каждые полшага.
  var EAT = { body: '#F2F4FA', shade: '#C9D0E2', mouth: '#16226A', tongue: '#FF8FA3', eye: '#101F6E', blush: '#F7B8C8' };
  function eater(frame, happy) {
    var c = EAT, open = frame === 0 && !happy;
    var body = [C(-7, -11, 6.6, c.body), C(1, -15.5, 9, c.body), C(9.2, -11.5, 6.6, c.body), R(-13.6, -11, 27, 8.5, 4.2, c.body)];
    var face = [];
    if (open) {
      face.push(P('M17 -17L6.5 -10.5L17 -4.5Z', c.mouth), P('M14 -6.6L9.6 -8.6L14.6 -9.4Z', c.tongue));
    } else {
      face.push(Ln(happy ? 'M7 -10Q11 -6.5 14.5 -10' : 'M7.5 -10.4L15 -10.4', c.mouth, 1.4, true));
    }
    if (happy) {
      face.push(Ln('M2 -18.5Q4 -21 6 -18.5', c.eye, 1.4, true));
    } else {
      face.push(C(4, -18.6, 1.7, c.eye), C(4.6, -19.3, 0.55, '#FFFFFF'));
    }
    face.push(E(8.4, -14.6, 1.7, 0.9, c.blush));
    return art([[[], 0], [body, 2.4], [face, 0]], frame === 0 ? -1.5 : 0);
  }

  // Моб-блокировка: сердитый комочек с рожками, смотрит на едока (влево).
  var MOB_COLORS = ['#FF6B7A', '#B07CFF', '#FF9F5A'];
  function mob(color) { return mobArt(color).main; }
  function mobArt(color) {
    return art([[[], 0], [[
      E(-2.4, -0.7, 1.7, 0.9, '#7A2030'), E(2.4, -0.7, 1.7, 0.9, '#7A2030'),
      P('M-3.4 -8.4L-4.9 -11.8L-1.6 -9.4Z', color), P('M3.4 -8.4L4.9 -11.8L1.6 -9.4Z', color),
      E(0, -5, 5.1, 4.6, color)
    ], 2], [[
      C(-1.8, -5.4, 1.5, '#FFFFFF'), C(1.8, -5.4, 1.5, '#FFFFFF'), C(-2.3, -5.2, 0.7, '#101F6E'), C(1.3, -5.2, 0.7, '#101F6E'),
      Ln('M-3.6 -7.8L-0.8 -6.8', '#101F6E', 0.8, true), Ln('M3.6 -7.8L0.8 -6.8', '#101F6E', 0.8, true)
    ], 0]], 0);
  }

  // Приз — сундук; open — крышка откинута, золото светится.
  function chest(open) { return chestArt(open).main; }
  function chestArt(open) {
    var wood = '#C27A38', dark = '#7A4318', gold = '#F4C552';
    var s = [R(-8, -9, 16, 9, 1, wood), R(-8, -9.6, 16, 2, 0.4, gold)];
    if (open) {
      s.push(P('M-8 -10V-16C-8 -18 -6 -19.5 -4 -19.5H4C6 -19.5 8 -18 8 -16V-10Z', dark));
      s.push(E(0, -10, 6.5, 2.2, '#FFE89A'));
    } else {
      s.push(P('M-8 -9V-11C-8 -13.5 -6 -14.5 -4 -14.5H4C6 -14.5 8 -13.5 8 -11V-9Z', wood));
      s.push(R(-1.6, -10.4, 3.2, 4, 0.8, gold));
    }
    return art([[[], 0], [s, 2]], 0);
  }

  function sparkleArt(color) { return art([[[], 0], [[P('M0 -5L1.2 -1.2L5 0L1.2 1.2L0 5L-1.2 1.2L-5 0L-1.2 -1.2Z', color)], 1.6]], 0); }
  function heartArt() { return art([[[], 0], [[P('M0 3.5C-5 0 -5.5 -3.5 -3 -4.5C-1.5 -5 -0.4 -4 0 -3C0.4 -4 1.5 -5 3 -4.5C5.5 -3.5 5 0 0 3.5Z', '#FF6B7A')], 1.8]], 0); }
  function sparkle(color) { return sparkleArt(color).main; }
  function heart() { return heartArt().main; }

  // ── стили (один раз на документ) ──
  var CSS = '' +
    '.cvl{--_t:var(--cvl-text,currentColor);--_d:var(--cvl-dim,currentColor);display:flex;flex-direction:column;gap:2px;width:100%;max-width:var(--cvl-max,360px);margin:0 auto;color:var(--_t);font-family:var(--cvl-font,inherit);user-select:none;-webkit-user-select:none;pointer-events:none}' +
    '.cvl-row{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:0 6px;min-height:1.2em}' +
    '.cvl-label{font-size:13px;font-weight:700;color:var(--_d);opacity:.9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.cvl-pct{font-family:var(--cvl-num-font,inherit);font-size:18px;font-weight:900;font-variant-numeric:tabular-nums;letter-spacing:.02em;text-shadow:var(--cvl-shadow,none)}' +
    '.cvl svg{display:block;width:100%;overflow:hidden}' +
    '.cvl.cvl-compact{flex-direction:row;align-items:center;gap:6px}' +
    '.cvl.cvl-compact .cvl-row{order:2;padding:0}' +
    '.cvl.cvl-compact .cvl-label{display:none}' +
    '.cvl.cvl-compact .cvl-pct{font-size:13px;min-width:3.2em;text-align:right}' +
    '.cvl.cvl-compact svg{flex:1;min-width:0}' +
    '.cvl-strip{position:fixed;left:0;right:0;top:0;z-index:2147483000;padding:calc(env(safe-area-inset-top,0px) + 2px) 10px 2px;background:var(--cvl-strip-bg,rgba(10,15,46,.72));transition:opacity .25s ease,transform .25s ease;pointer-events:none}' +
    '.cvl-strip.cvl-hidden{opacity:0;transform:translateY(-100%)}' +
    '.cvl-strip .cvl{max-width:none;--cvl-text:#F2F4FA;--cvl-dim:#A9B6DD}' +
    '.cvl-host{animation:none!important;border:0!important;border-radius:0!important;width:min(320px,86%)!important;height:auto!important;background:none!important;box-shadow:none!important;display:block!important;margin-left:auto!important;margin-right:auto!important}' +
    '@media (prefers-reduced-motion:reduce){.cvl-strip{transition:none}}';
  function injectCss() {
    if (!G.document || G.document.getElementById('cvl-css')) return;
    var st = G.document.createElement('style');
    st.id = 'cvl-css';
    st.textContent = CSS;
    (G.document.head || G.document.documentElement).appendChild(st);
  }

  // ── общий счётчик загрузок ──
  var CvLoad = (function () {
    var jobs = {}, seq = 0, subs = [], episode = null, shown = 0, timer = null;
    function now() { return (G.performance && G.performance.now) ? G.performance.now() : Date.now(); }
    function est(j, t) {
      if (j.done) return 1;
      if (j.frac != null) return Math.max(j.frac, 0.02);
      return 0.9 * (1 - Math.exp(-(t - j.t0) / 1400));  // оценка по времени: быстро до ~60%, потом медленнее
    }
    function state() {
      if (!episode) return { active: false, pct: 0 };
      var t = now(), ids = episode.ids, sum = 0, n = 0, open = 0;
      for (var k in ids) { var j = jobs[k] || { done: true }; sum += est(j, t); n++; if (!j.done) open++; }
      var p = n ? sum / n : 1;
      if (open) p = Math.min(p, 0.99);
      shown = Math.max(shown, p);
      return { active: open > 0, pct: Math.round(shown * 100), since: episode.t0 };
    }
    function emit() {
      var s = state();
      for (var i = 0; i < subs.length; i++) { try { subs[i](s); } catch (e) { /* */ } }
      if (!s.active && episode) { episode = null; shown = 0; stopTick(); }
    }
    function tick() { emit(); }
    function startTick() { if (!timer) timer = setInterval(tick, 120); }
    function stopTick() { if (timer) { clearInterval(timer); timer = null; } }
    var api = {
      begin: function (name) {
        var id = 'j' + (++seq);
        jobs[id] = { t0: now(), frac: null, done: false, name: name || '' };
        if (!episode) { episode = { t0: now(), ids: {} }; shown = 0; }
        episode.ids[id] = 1;
        startTick();
        emit();
        return id;
      },
      progress: function (id, frac) {
        var j = jobs[id];
        if (j && !j.done && frac >= 0) { j.frac = Math.min(0.99, frac); }
      },
      end: function (id) {
        var j = jobs[id];
        if (!j || j.done) return;
        j.done = true;
        setTimeout(function () { delete jobs[id]; }, 30000);
        emit();
      },
      track: function (promise, name) {
        var id = api.begin(name);
        var fin = function () { api.end(id); };
        Promise.resolve(promise).then(fin, fin);
        return promise;
      },
      subscribe: function (fn) {
        subs.push(fn);
        try { fn(state()); } catch (e) { /* */ }
        return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); };
      },
      state: state,
      attachAxios: function (ax) {
        if (!ax || !ax.interceptors || ax.__cvl) return ax;
        ax.__cvl = true;
        ax.interceptors.request.use(function (cfg) {
          if (cfg && cfg.cvSilent) return cfg;  // фоновые опросы: { cvSilent: true }
          var id = api.begin(cfg && cfg.url);
          cfg.__cvl = id;
          var prevD = cfg.onDownloadProgress, prevU = cfg.onUploadProgress;
          cfg.onDownloadProgress = function (e) {
            if (e && e.total) api.progress(id, 0.15 + 0.85 * (e.loaded / e.total));
            if (prevD) prevD(e);
          };
          cfg.onUploadProgress = function (e) {
            if (e && e.total) api.progress(id, 0.15 * (e.loaded / e.total));
            if (prevU) prevU(e);
          };
          return cfg;
        }, function (err) { return Promise.reject(err); });
        ax.interceptors.response.use(function (res) {
          if (res && res.config && res.config.__cvl) api.end(res.config.__cvl);
          return res;
        }, function (err) {
          if (err && err.config && err.config.__cvl) api.end(err.config.__cvl);
          return Promise.reject(err);
        });
        return ax;
      },
      wrapFetch: function () {
        if (!G.fetch || G.fetch.__cvl) return;
        var orig = G.fetch;
        var wrapped = function (input, init) {
          if (init && init.cvSilent) return orig.call(this, input, init);
          var id = api.begin(typeof input === 'string' ? input : (input && input.url));
          return orig.call(this, input, init).then(function (r) { api.end(id); return r; }, function (e) { api.end(id); throw e; });
        };
        wrapped.__cvl = true;
        G.fetch = wrapped;
      }
    };
    return api;
  })();

  // ── загрузчик ──
  var uid = 0;
  var lastKind = 'eater';
  function pickKind(kind) {
    if (kind === 'chase' || kind === 'eater') return kind;
    var pref = null;
    try { pref = G.localStorage && G.localStorage.getItem('cv_loader_kind'); } catch (e) { /* */ }
    if (pref === 'chase' || pref === 'eater') return pref;
    lastKind = lastKind === 'chase' ? 'eater' : 'chase';  // «по очереди»
    return lastKind;
  }

  function el(tag, attrs) {
    var n = G.document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function cvLoader(host, opts) {
    opts = opts || {};
    injectCss();
    var kind = pickKind(opts.kind || 'auto');
    var hpx = opts.size || H0;
    var u = hpx / H0;
    var compact = !!opts.compact;
    var id = 'cvl' + (++uid);

    var box = G.document.createElement('div');
    box.className = 'cvl' + (compact ? ' cvl-compact' : '') + ' cvl-' + kind;
    box.setAttribute('role', 'progressbar');
    box.setAttribute('aria-valuemin', '0');
    box.setAttribute('aria-valuemax', '100');
    var row = G.document.createElement('div');
    row.className = 'cvl-row';
    var lab = G.document.createElement('span');
    lab.className = 'cvl-label';
    lab.textContent = opts.label || '';
    var pct = G.document.createElement('span');
    pct.className = 'cvl-pct';
    row.appendChild(lab);
    row.appendChild(pct);
    box.appendChild(row);

    var svg = el('svg', { height: String(hpx), 'aria-hidden': 'true' });
    svg.style.height = hpx + 'px';
    var defs = el('defs', {});
    defs.innerHTML = '<linearGradient id="' + id + 's" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--cvl-steel-top,#E2E6F1)"/><stop offset="1" stop-color="var(--cvl-track,#9EA2B5)"/></linearGradient>';
    svg.appendChild(defs);
    var gTrack = el('g', {});
    var lineY = LINE_Y * u;
    var edge = el('line', { y1: lineY, y2: lineY, 'stroke-width': 5 * u, 'stroke-linecap': 'round' });
    edge.style.stroke = 'var(--cvl-edge,#21253C)';
    var steel = el('line', { y1: lineY, y2: lineY, 'stroke-width': 3 * u, 'stroke-linecap': 'round', stroke: 'url(#' + id + 's)' });
    var halo = el('line', { y1: lineY, y2: lineY, 'stroke-width': 8 * u, 'stroke-linecap': 'round', opacity: '0.28' });
    halo.style.stroke = 'var(--cvl-glow,#7CFFCB)';
    var glow = el('line', { y1: lineY, y2: lineY, 'stroke-width': 3 * u, 'stroke-linecap': 'round' });
    glow.style.stroke = 'var(--cvl-glow,#7CFFCB)';
    var ticks = el('g', {});
    gTrack.appendChild(edge);
    gTrack.appendChild(steel);
    gTrack.appendChild(ticks);
    gTrack.appendChild(halo);
    gTrack.appendChild(glow);
    svg.appendChild(gTrack);
    var gMobs = el('g', {});
    var gPrize = el('g', {});
    var gFx = el('g', {});
    svg.appendChild(gMobs);
    svg.appendChild(gPrize);
    // creature groups: [outer translate] > [lift] > far + main
    function creature() {
      var outer = el('g', {}), lift = el('g', {}), far = el('g', {}), main = el('g', {});
      lift.appendChild(far);
      lift.appendChild(main);
      outer.appendChild(lift);
      svg.appendChild(outer);
      return { outer: outer, lift: lift, far: far, main: main, frame: -1, art: null };
    }
    var A = creature();               // пёс или едок
    var B = kind === 'chase' ? creature() : null;  // заяц
    svg.appendChild(gFx);
    box.appendChild(svg);
    if (opts.replace !== false) host.innerHTML = '';
    host.appendChild(box);

    var mode = opts.progress === 'loop' ? 'loop' : (typeof opts.progress === 'number' ? 'set' : 'auto');
    var target = mode === 'set' ? Math.max(0, Math.min(1, opts.progress / 100)) : 0;
    var shownP = 0, t0 = now(), finishing = null, finishedAt = 0, destroyed = false, raf = 0, W = 0;
    var mobs = [], unsub = null, globalPct = null;

    function now() { return (G.performance && G.performance.now) ? G.performance.now() : Date.now(); }

    if (mode === 'auto') {
      unsub = CvLoad.subscribe(function (s) { globalPct = s.active || s.pct ? s.pct : null; });
    }

    function layout() {
      var w = svg.getBoundingClientRect().width || 300;
      if (Math.abs(w - W) < 0.5) return;
      W = w;
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + hpx);
      var x0 = PAD, x1 = W - PAD;
      [edge, steel, halo, glow].forEach(function (n) { n.setAttribute('x1', x0); n.setAttribute('x2', x0); });
      edge.setAttribute('x2', x1);
      steel.setAttribute('x2', x1);
      var tk = '';
      for (var i = 1; i < 4; i++) {
        var x = x0 + (x1 - x0) * i / 4;
        tk += '<line x1="' + x + '" x2="' + x + '" y1="' + (lineY - 3.5 * u) + '" y2="' + (lineY + 3.5 * u) + '" stroke="var(--cvl-track,#9EA2B5)" stroke-width="' + (1.4 * u) + '" stroke-linecap="round" opacity=".8"/>';
      }
      ticks.innerHTML = tk;
      if (kind === 'eater') {
        // мобы через каждые ~26u между стартом и сундуком
        var start = x0 + 34 * u, end = x1 - 26 * u, step = 26 * u, html = '';
        mobs = [];
        gMobs.innerHTML = '';
        for (var x = start, k = 0; x < end; x += step, k++) {
          var g = el('g', { transform: 'translate(' + x + ',' + lineY + ') scale(' + u + ')' });
          g.innerHTML = '<g class="cvl-bob">' + mob(MOB_COLORS[k % MOB_COLORS.length]) + '</g>';
          gMobs.appendChild(g);
          mobs.push({ x: x, g: g, inner: g.firstChild, eaten: false, k: k });
        }
        gPrize.setAttribute('transform', 'translate(' + (x1 - 10 * u) + ',' + (lineY - 1.5 * u) + ') scale(' + u + ')');
        gPrize.innerHTML = chest(false);
        gPrize.__open = false;
      }
    }

    function setArt(c, art, frame) {
      if (c.frame === frame && c.art === art) return;
      var a = art(frame);
      c.far.innerHTML = a.far;
      c.main.innerHTML = a.main;
      c.lift.setAttribute('transform', 'translate(0,' + a.lift + ')');
      c.frame = frame;
      c.art = art;
    }

    function place(c, x, flip) {
      c.outer.setAttribute('transform', 'translate(' + x + ',' + lineY + ') scale(' + (flip ? -u : u) + ',' + u + ')');
    }

    function eaterHappy(f) { return eater(f, true); }
    function hareFlip(f) { return hare(f); }

    function frameAt(t) { return reduce ? 1 : Math.floor(t / STEP) % 2; }

    function render() {
      raf = 0;
      if (destroyed) return;
      if (!box.isConnected) { destroy(); return; }
      layout();
      var t = now(), x0 = PAD, x1 = W - PAD, L = x1 - x0;
      var frame = frameAt(t - t0);
      var p;
      if (mode === 'loop') {
        p = null;
      } else {
        if (mode === 'auto' && !finishing) {
          target = globalPct != null ? globalPct / 100 : 0.95 * (1 - Math.exp(-(t - t0) / 2600));
        }
        if (finishing) target = 1;
        shownP += (target - shownP) * Math.min(1, 0.16);
        if (Math.abs(target - shownP) < 0.002) shownP = target;
        p = shownP;
      }
      var done = finishing && p >= 0.999;
      if (done && !finishedAt) finishedAt = t;

      if (kind === 'chase') {
        var dogX, hareX;
        if (p == null) {
          var ph = ((t - t0) % LAP) / LAP;
          dogX = x0 - 24 * u + ph * (L + 48 * u + GAP * u);
          hareX = dogX + GAP * u;
          glow.setAttribute('x1', Math.max(x0, dogX - L * 0.25));
          glow.setAttribute('x2', Math.max(x0, Math.min(x1, dogX)));
        } else {
          var gap = (GAP - (GAP - 27) * p * p) * u;
          var span = L - 24 * u - 16 * u - 27 * u;
          dogX = x0 + 24 * u + p * span;
          hareX = dogX + gap;
          glow.setAttribute('x1', x0);
          glow.setAttribute('x2', Math.max(x0, x0 + p * L));
        }
        if (done) {
          setArt(A, dog, 1);
          setArt(B, hareFlip, 1);
          place(A, dogX, false);
          place(B, hareX - 3 * u, true);  // заяц обернулся: пойман
          var k = Math.min(1, (t - finishedAt) / 400);
          gFx.innerHTML = '<g transform="translate(' + (dogX + 14 * u) + ',' + (lineY - (34 + 6 * k) * u) + ') scale(' + (u * (0.6 + 0.6 * k)) + ')">' + heart() + '</g>' +
            '<g transform="translate(' + (dogX - 6 * u) + ',' + (lineY - 32 * u) + ') scale(' + (u * 0.7 * k) + ')">' + sparkle('#FFE89A') + '</g>' +
            '<g transform="translate(' + (hareX + 8 * u) + ',' + (lineY - 30 * u) + ') scale(' + (u * 0.6 * k) + ')">' + sparkle('#7CFFCB') + '</g>';
        } else {
          setArt(A, dog, frame);
          setArt(B, hare, (frame + 1) % 2);
          place(A, dogX, false);
          place(B, hareX, false);
          gFx.innerHTML = '';
        }
      } else {
        var ex;
        if (p == null) {
          var ph2 = ((t - t0) % LAP) / LAP;
          ex = x0 - 20 * u + ph2 * (L + 40 * u);
          glow.setAttribute('x1', Math.max(x0, ex - L * 0.25));
          glow.setAttribute('x2', Math.max(x0, Math.min(x1, ex)));
        } else {
          ex = x0 + 16 * u + p * (L - 16 * u - 30 * u);
          glow.setAttribute('x1', x0);
          glow.setAttribute('x2', Math.max(x0, x0 + p * L));
        }
        var fxs = '';
        for (var i = 0; i < mobs.length; i++) {
          var m = mobs[i], eaten = ex + 10 * u >= m.x;
          if (p == null && ex < x0) eaten = false;
          if (eaten !== m.eaten) {
            m.eaten = eaten;
            m.g.style.display = eaten ? 'none' : '';
            if (eaten) m.at = t;
          }
          if (eaten && m.at && t - m.at < 320) {
            var q = (t - m.at) / 320;
            fxs += '<g opacity="' + (1 - q) + '" transform="translate(' + m.x + ',' + (lineY - (8 + 10 * q) * u) + ') scale(' + (u * (0.5 + 0.5 * q)) + ')">' + sparkle('#FFE89A') + '</g>';
          }
          if (!eaten && !reduce) {
            m.inner.setAttribute('transform', 'translate(0,' + (((Math.floor((t - t0) / STEP) + m.k) % 2) ? -1.2 : 0) + ')');
          }
        }
        if (done) {
          // приз съеден: едок доходит до сундука, сундук исчезает, вокруг искры
          var k2 = Math.min(1, (t - finishedAt) / 450);
          ex += 16 * u * k2;
          setArt(A, k2 < 0.5 ? eater : eaterHappy, k2 < 0.5 ? 0 : 1);
          if (!gPrize.__open) { gPrize.innerHTML = chest(true); gPrize.__open = true; }
          gPrize.style.opacity = String(1 - k2);
          fxs += '<g transform="translate(' + (x1 - 10 * u) + ',' + (lineY - (20 + 10 * k2) * u) + ') scale(' + (u * (0.5 + 0.7 * k2)) + ')">' + sparkle('#FFE89A') + '</g>' +
            '<g transform="translate(' + (x1 - 20 * u) + ',' + (lineY - 26 * u) + ') scale(' + (u * 0.5 * k2) + ')">' + sparkle('#7CFFCB') + '</g>';
        } else {
          setArt(A, eater, frame);
          if (gPrize.__open) { gPrize.innerHTML = chest(false); gPrize.__open = false; gPrize.style.opacity = ''; }
        }
        gFx.innerHTML = fxs;
        place(A, ex, false);
      }

      var shownPct = p == null ? null : Math.round(p * 100);
      var txt = shownPct == null ? '' : shownPct + '%';
      if (pct.textContent !== txt) pct.textContent = txt;
      if (shownPct != null) box.setAttribute('aria-valuenow', String(shownPct));

      if (finishing && finishedAt && t - finishedAt >= FINISH) {
        var f = finishing;
        finishing = null;
        f();
        if (opts.keepFinal) return;  // остаётся на финальном кадре
      }
      schedule();
    }

    function schedule() {
      if (raf || destroyed) return;
      raf = (G.requestAnimationFrame || function (cb) { return setTimeout(cb, 16); })(render);
    }

    function destroy() {
      destroyed = true;
      if (unsub) unsub();
      if (raf && G.cancelAnimationFrame) G.cancelAnimationFrame(raf);
      if (box.parentNode) box.parentNode.removeChild(box);
    }

    schedule();
    return {
      el: box,
      kind: kind,
      set: function (v) {
        if (v == null) { mode = 'auto'; return; }
        if (mode !== 'set') { mode = 'set'; if (unsub) { unsub(); unsub = null; } }
        target = Math.max(0, Math.min(1, v / 100));
        schedule();
      },
      label: function (s) { lab.textContent = s || ''; },
      done: function () {
        if (mode === 'loop') { mode = 'set'; shownP = 0.85; }
        return new Promise(function (res) { finishing = res; finishedAt = 0; schedule(); });
      },
      reset: function () { finishing = null; finishedAt = 0; shownP = 0; target = 0; t0 = now(); schedule(); },
      destroy: destroy
    };
  }

  // ── полоса загрузки вверху страницы ──
  function cvLoadStrip(opts) {
    opts = opts || {};
    injectCss();
    if (!G.document || !G.document.body) return null;
    var wrap = G.document.createElement('div');
    wrap.className = 'cvl-strip cvl-hidden';
    wrap.setAttribute('aria-hidden', 'true');
    G.document.body.appendChild(wrap);
    var ld = null, showTimer = null, visible = false, ending = false;
    function show() {
      if (visible) return;
      visible = true;
      ld = cvLoader(wrap, { kind: opts.kind || 'auto', size: opts.size || 34, compact: true, keepFinal: true });
      wrap.classList.remove('cvl-hidden');
    }
    function hide() {
      visible = false;
      ending = false;
      wrap.classList.add('cvl-hidden');
      setTimeout(function () { if (!visible && ld) { ld.destroy(); ld = null; } }, 300);
    }
    CvLoad.subscribe(function (s) {
      if (s.active) {
        if (ending && ld) { ld.reset(); ending = false; }
        if (!visible && !showTimer) showTimer = setTimeout(function () { showTimer = null; if (CvLoad.state().active) show(); }, opts.delay != null ? opts.delay : 350);
      } else {
        if (showTimer) { clearTimeout(showTimer); showTimer = null; }
        if (visible && ld && !ending) {
          ending = true;
          ld.done().then(function () { if (ending) hide(); });
        }
      }
    });
    return wrap;
  }

  // ── замена круглых спиннеров ──
  function cvAutoSwap(root, opts) {
    opts = opts || {};
    injectCss();
    var sel = opts.selector || '.animate-spin.rounded-full, .cv-spinner';
    var min = opts.minSize || 28;
    var skip = opts.skip || 'button, a, [role="button"], .cvl-no-swap, .cvl-strip';
    function check(n) {
      if (!n || n.nodeType !== 1 || n.__cvl) return;
      if (!n.matches(sel)) return;
      if (n.closest(skip)) return;
      if (n.children.length) return;
      var r = n.getBoundingClientRect();
      if (r.width && r.width < min) return;
      n.__cvl = true;
      n.classList.add('cvl-host');
      n.setAttribute('role', 'presentation');
      cvLoader(n, { kind: opts.kind || 'auto', size: opts.size || 54, label: opts.label || '' });
    }
    function scan(node) {
      if (!node || node.nodeType !== 1) return;
      check(node);
      if (node.querySelectorAll) {
        var list = node.querySelectorAll(sel);
        for (var i = 0; i < list.length; i++) check(list[i]);
      }
    }
    scan(root);
    var mo = new MutationObserver(function (recs) {
      for (var i = 0; i < recs.length; i++) {
        var r = recs[i];
        if (r.type === 'attributes') { check(r.target); continue; }
        for (var j = 0; j < r.addedNodes.length; j++) scan(r.addedNodes[j]);
      }
    });
    mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    return function () { mo.disconnect(); };
  }

  // ── статичный кадр (превью, тесты, серверные картинки) ──
  function snapshot(kind, p, frame, width) {
    var W = width || 320, u = 1, x0 = PAD, x1 = W - PAD, L = x1 - x0, y = LINE_Y;
    var s = '<svg xmlns="' + NS + '" viewBox="0 0 ' + W + ' 54" width="' + W + '" height="54">';
    s += '<line x1="' + x0 + '" x2="' + x1 + '" y1="' + y + '" y2="' + y + '" stroke="#21253C" stroke-width="5" stroke-linecap="round"/>';
    s += '<line x1="' + x0 + '" x2="' + x1 + '" y1="' + y + '" y2="' + y + '" stroke="#9EA2B5" stroke-width="3" stroke-linecap="round"/>';
    s += '<line x1="' + x0 + '" x2="' + (x0 + p * L) + '" y1="' + y + '" y2="' + y + '" stroke="#7CFFCB" stroke-width="8" stroke-linecap="round" opacity=".28"/>';
    s += '<line x1="' + x0 + '" x2="' + (x0 + p * L) + '" y1="' + y + '" y2="' + y + '" stroke="#7CFFCB" stroke-width="3" stroke-linecap="round"/>';
    function put(x, art, flip) {
      return '<g transform="translate(' + x + ',' + y + ') scale(' + (flip ? -1 : 1) + ',1)"><g transform="translate(0,' + art.lift + ')">' + art.far + art.main + '</g></g>';
    }
    var fin = p >= 1;
    if (kind === 'chase') {
      var gap = GAP - (GAP - 27) * p * p, dx = x0 + 24 + p * (L - 24 - 16 - 27);
      s += put(dx, dog(fin ? 1 : frame), false) + put(dx + gap - (fin ? 3 : 0), hare(fin ? 1 : (frame + 1) % 2), fin);
      if (fin) s += '<g transform="translate(' + (dx + 14) + ',' + (y - 40) + ') scale(1.2)">' + heart() + '</g>';
    } else {
      var ex = x0 + 16 + p * (L - 46);
      for (var x = x0 + 34, k = 0; x < x1 - 26; x += 26, k++) {
        if (ex + 10 < x) s += '<g transform="translate(' + x + ',' + y + ')">' + mob(MOB_COLORS[k % 3]) + '</g>';
      }
      if (!fin) s += '<g transform="translate(' + (x1 - 10) + ',' + (y - 1.5) + ')">' + chest(false) + '</g>';
      if (fin) { ex += 16; s += '<g transform="translate(' + (x1 - 4) + ',' + (y - 30) + ') scale(1.2)">' + sparkle('#FFE89A') + '</g><g transform="translate(' + (x1 - 30) + ',' + (y - 26) + ') scale(.7)">' + sparkle('#7CFFCB') + '</g>'; }
      s += put(ex, fin ? eater(1, true) : eater(frame), false);
    }
    var label = Math.round(p * 100) + '%';
    s += '<text x="' + (W - 8) + '" y="16" text-anchor="end" font-family="Nunito, sans-serif" font-weight="900" font-size="16" fill="#F2F4FA" stroke="#0A0F2E" stroke-width="3" paint-order="stroke">' + label + '</text>';
    return s + '</svg>';
  }

  // ── <cv-loader> ──
  if (G.customElements && G.HTMLElement && !G.customElements.get('cv-loader')) {
    var CvLoaderEl = function () { return Reflect.construct(G.HTMLElement, [], CvLoaderEl); };
    CvLoaderEl.prototype = Object.create(G.HTMLElement.prototype);
    CvLoaderEl.prototype.constructor = CvLoaderEl;
    Object.setPrototypeOf(CvLoaderEl, G.HTMLElement);
    Object.defineProperty(CvLoaderEl, 'observedAttributes', { get: function () { return ['progress', 'label', 'done']; } });
    CvLoaderEl.prototype.connectedCallback = function () {
      if (this._l) return;
      if (!this.style.display) this.style.display = 'block';
      var pr = this.getAttribute('progress');
      this._l = cvLoader(this, {
        kind: this.getAttribute('kind') || 'auto',
        label: this.getAttribute('label') || '',
        size: Number(this.getAttribute('size')) || H0,
        compact: this.hasAttribute('compact'),
        keepFinal: true,
        progress: pr === 'loop' ? 'loop' : (pr != null && pr !== '' && !isNaN(Number(pr)) ? Number(pr) : undefined)
      });
    };
    CvLoaderEl.prototype.disconnectedCallback = function () { if (this._l) { this._l.destroy(); this._l = null; } };
    CvLoaderEl.prototype.attributeChangedCallback = function (name, _o, v) {
      if (!this._l) return;
      if (name === 'progress' && v != null && v !== '' && !isNaN(Number(v))) this._l.set(Number(v));
      if (name === 'label') this._l.label(v);
      if (name === 'done' && v != null) this._l.done();
    };
    G.customElements.define('cv-loader', CvLoaderEl);
  }

  G.CvLoaders = {
    cvLoader: cvLoader, CvLoad: CvLoad, cvLoadStrip: cvLoadStrip, cvAutoSwap: cvAutoSwap, snapshot: snapshot,
    // данные рисунков для генератора Kotlin; геометрия сцены — те же числа, что в render()
    _art: { dog: dog, hare: hare, eater: eater, mob: mobArt, chest: chestArt, sparkle: sparkleArt, heart: heartArt, MOB_COLORS: MOB_COLORS, OUT: OUT },
    _geom: { H0: H0, LINE_Y: LINE_Y, PAD: PAD, GAP: GAP, STEP: STEP, LAP: LAP, FINISH: FINISH }
  };
  G.cvLoader = G.cvLoader || cvLoader;
  if (typeof module !== 'undefined' && module.exports) module.exports = G.CvLoaders;
})();
