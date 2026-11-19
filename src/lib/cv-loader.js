/*!
 * Cloud VPN — загрузчики «пёс догоняет зайца» и «облачко-едок» с процентом.
 * Нарисовано с нуля (SVG-фигуры), без картинок и чужой графики. Без зависимостей.
 *
 * Подключение: <script src="cv-loader.js"></script> или import './cv-loader.js' (Vite/webpack).
 * Всё доступно через globalThis.CvLoaders = { cvLoader, CvLoad, cvLoadStrip, cvAutoSwap, snapshot }.
 *
 *   const l = cvLoader(el, { kind: 'chase' | 'eater' | 'car' | 'boat' | 'jetski' | 'auto', label: 'Загрузка', size: 54 });
 *   Темы Vice (класс vice-night / vice-day на <html>): 'auto' даёт маслкар, уходящий от полиции по закатному шоссе,
 *   и катер — по очереди; при data-brand="miami" (или классе miami) — чихуахуа в очках на гидроцикле.
 *   % горит на неоновой вывеске в конце пути; компактный вид (полоса, «пилюля») — неоновый % справа.
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

  // '#RRGGBBAA' → цвет + прозрачность отдельным атрибутом (так понимают и старые WebView)
  function paint(attr, c) {
    if (c.length === 9) return ' ' + attr + '="' + c.slice(0, 7) + '" ' + attr + '-opacity="' + Math.round(parseInt(c.slice(7), 16) / 2.55) / 100 + '"';
    return ' ' + attr + '="' + c + '"';
  }

  function draw(shapes, ow) {
    if (ow == null) ow = 2.4;
    var o = '', f = '';
    for (var i = 0; i < shapes.length; i++) {
      var s = shapes[i];
      if (s.k === 'l') {
        if (!s.no && ow > 0) o += geo(s) + ' fill="none" stroke="' + OUT + '" stroke-width="' + (s.w + ow) + '" stroke-linecap="round" stroke-linejoin="round"/>';
        f += geo(s) + ' fill="none"' + paint('stroke', s.f) + ' stroke-width="' + s.w + '" stroke-linecap="round" stroke-linejoin="round"/>';
      } else {
        if (!s.no && ow > 0) o += geo(s) + ' fill="' + OUT + '" stroke="' + OUT + '" stroke-width="' + ow + '" stroke-linejoin="round"/>';
        f += geo(s) + paint('fill', s.f) + '/>';
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

  // ════════ Vice: маслкар уходит от полиции по закатному шоссе, катер, чихуахуа на гидроцикле ════════
  // Своя рисовка «в духе» неонового закатного побережья — без чужих машин, логотипов и персонажей.
  // Цвет '#RRGGBBAA' — с прозрачностью (так же уходит в Kotlin).
  var VG = {
    HY: 30,          // горизонт
    CURB: 34,        // бордюр: где стоят пальмы у дороги
    LANE_Y: 50.5,    // разметка — по ней же светится пройденный путь
    SUN_R: 11,
    PALM_H: 24, PALM_GAP: 64, PALM_V: 0.03,      // пальмы: высота, шаг, скорость (u/мс)
    LANE_DASH: 6, LANE_GAP: 6, LANE_V: 0.09,      // штрихи разметки и их скорость
    RADIUS: 9,
    SIGN_W: 34, SIGN_H: 15, SIGN_TOP: 3, SIGN_RIGHT: 3,
    START: 26, END: 32, END_JETSKI: 48, END_COMPACT: 22, POLICE_GAP: 46
  };
  var PALM_SC = [1, 0.8, 1.12, 0.9];
  var VICE = {
    night: {
      sky: ['#1B0A3E', '#3A0F66', '#7A1E7E', '#E8457E', '#FF8A3D'], skyAt: [0, 0.3, 0.58, 0.82, 1],
      sun: ['#FFE27A', '#FFB347', '#FF6A5C', '#FF3EA5'], sea: ['#4A1673', '#1B0B3A'], horizon: '#2EF2E0',
      road: '#1D0E3B', curb: '#3A1468', lane: '#FFD45E', trail: '#FF3EA5', trail2: '#2EF2E0', palm: '#16062E',
      signBg: '#140A33', signEdge: '#FF3EA5', signText: '#FFF4FB', signGlow: '#FF3EA5', edge: '#FF3EA5', text: '#FFF4FB'
    },
    day: {
      sky: ['#7FD3EE', '#B9E6F2', '#FFE3D1', '#FFC0A0', '#FFB37A'], skyAt: [0, 0.3, 0.58, 0.82, 1],
      sun: ['#FFF2B0', '#FFD45E', '#FFA36B', '#FF7FA8'], sea: ['#3CC9C0', '#1E8F9A'], horizon: '#FFFFFF',
      road: '#5B5470', curb: '#F2D2B6', lane: '#FFFFFF', trail: '#E8327F', trail2: '#11A6A0', palm: '#1E5F66',
      signBg: '#2B1740', signEdge: '#E8327F', signText: '#FFFFFF', signGlow: '#FF6FB5', edge: '#11A6A0', text: '#2B1740'
    }
  };

  function r2(v) { return Math.round(v * 100) / 100; }
  // лист пальмы: изогнутая жилка, лист сужается к концу, нижний край зубчатый
  function frondD(Tx, Ty, aDeg, L, fw, droop, n) {
    var a = aDeg * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a);
    var Ex = Tx + dx * L, Ey = Ty + dy * L * 0.6 + L * droop;
    var Cx = Tx + dx * L * 0.55, Cy = Ty + dy * L * 0.55 - L * 0.22;
    var up = [], lo = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n, mt = 1 - t;
      var px = mt * mt * Tx + 2 * mt * t * Cx + t * t * Ex, py = mt * mt * Ty + 2 * mt * t * Cy + t * t * Ey;
      var tx = 2 * mt * (Cx - Tx) + 2 * t * (Ex - Cx), ty = 2 * mt * (Cy - Ty) + 2 * t * (Ey - Cy);
      var ln = Math.sqrt(tx * tx + ty * ty) || 1, nx = -ty / ln, ny = tx / ln;
      if (ny < 0) { nx = -nx; ny = -ny; }
      var w = fw * Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + t * 0.95)), 0.75);
      up.push([px - nx * w * 0.35, py - ny * w * 0.35]);
      var kk = i % 2 === 0 ? 1 : 0.42;
      lo.push([px + nx * w * kk, py + ny * w * kk]);
    }
    var pts = up.concat(lo.reverse());
    return 'M' + pts.map(function (q) { return r2(q[0]) + ' ' + r2(q[1]); }).join('L') + 'Z';
  }
  // пальма: начало — основание ствола
  function palmArt(color) {
    var h = VG.PALM_H, Tx = h * 0.2, Ty = -h, Cx = h * 0.024, Cy = -h * 0.5, w0 = h * 0.05, w1 = h * 0.026;
    var trunk = 'M' + r2(-w0) + ' 0Q' + r2(Cx - w0 * 0.8) + ' ' + r2(Cy) + ' ' + r2(Tx - w1) + ' ' + r2(Ty + h * 0.02) +
      'L' + r2(Tx + w1) + ' ' + r2(Ty + h * 0.02) + 'Q' + r2(Cx + w0 * 0.8) + ' ' + r2(Cy) + ' ' + r2(w0) + ' 0Z';
    var s = [P(trunk, color)];
    [-178, -150, -122, -96, -70, -44, -18, 6].forEach(function (a) {
      var side = Math.abs(Math.cos(a * Math.PI / 180));
      s.push(P(frondD(Tx, Ty, a, h * 0.5 * (0.7 + 0.35 * side), h * 0.085, 0.18 + 0.5 * side, 12), color));
    });
    return art([[[], 0], [s, 0]], 0);
  }

  function wheels(f, tire, rim) {
    var a = f === 0;
    return {
      tires: [C(-12, -4.6, 4.6, tire), C(12.5, -4.6, 4.6, tire)],
      rims: [C(-12, -4.6, 2.5, rim), C(12.5, -4.6, 2.5, rim),
        Ln(a ? 'M-12 -6.9L-12 -2.3M-14.3 -4.6L-9.7 -4.6' : 'M-13.6 -6.2L-10.4 -3M-13.6 -3L-10.4 -6.2', tire, 0.7, true),
        Ln(a ? 'M12.5 -6.9L12.5 -2.3M10.2 -4.6L14.8 -4.6' : 'M10.9 -6.2L14.1 -3M10.9 -3L14.1 -6.2', tire, 0.7, true)]
    };
  }

  // Маслкар: длинный капот, фастбэк, розовый с белой полосой. Смотрит вправо; начало — земля между колёсами.
  var CAR = { body: '#FF3EA5', shade: '#C42A80', win: '#1E8FA8', glint: '#C9FFFA', chrome: '#E8ECFF', tire: '#120830', rim: '#D6ECFF' };
  function car(frame) {
    var c = CAR, w = wheels(frame, c.tire, c.rim);
    var far = [P('M22 -12.6L42 -15.6L42 -7.6L22 -10.4Z', '#FFF3B030')];
    if (frame === 0) far.push(C(-25, -6.6, 1.7, '#FFFFFF66')); else far.push(C(-27.5, -7.6, 2.3, '#FFFFFF40'));
    var body = [
      P('M-21 -5.5L-21 -10.5Q-20.5 -13 -17 -13.5L-7 -14.2L-2.5 -19.6Q-1.6 -20.6 0 -20.6L8 -20.6Q9.6 -20.6 10.6 -19.4L14 -14.6L19.5 -14Q22 -13.6 22 -11L22 -5.5Z', c.body),
      R(20.6, -8.2, 3, 2, 0.8, c.chrome), R(-22.6, -8.2, 3, 2, 0.8, c.chrome)
    ].concat(w.tires);
    var det = [
      R(-21, -8.4, 43, 2.9, 1, c.shade),
      P('M-1.2 -14.6L1.4 -18.6Q1.9 -19.2 2.6 -19.2L5.6 -19.2L5.6 -14.6Z', c.win),
      P('M7 -14.6L7 -19.2L8.6 -19.2Q9.4 -19.2 9.9 -18.5L12.6 -14.6Z', c.win),
      Ln('M2.4 -18.3L4.2 -15.5', c.glint, 0.7, true),
      Ln('M-20 -11.3L21 -11.3', '#FFFFFF', 0.9, true),
      E(21.1, -11.7, 1.1, 0.9, '#FFF3B0'), R(-21.6, -12.7, 1.3, 2.4, 0.4, '#FF2B4A')
    ].concat(w.rims);
    return art([[far, 0], [body, 2], [det, 0]], frame === 0 ? -0.5 : 0);
  }

  // Полицейская машина: чёрно-белая, мигалка красная/синяя — меняется каждые полшага.
  function police(frame) {
    var w = wheels(frame, '#120830', '#C9CEDD'), red = frame === 0;
    var far = [C(red ? -0.3 : 4.3, -21.6, 5, red ? '#FF2B4A55' : '#2E7BFF55')];
    var body = [
      P('M-20 -5.5L-20 -11Q-20 -13.2 -17 -13.4L-9 -13.8L-5 -19.4Q-4.2 -20.2 -3 -20.2L7.5 -20.2Q8.8 -20.2 9.6 -19.2L13 -14L19 -13.4Q21 -13 21 -10.8L21 -5.5Z', '#1E1A3A'),
      R(-2.6, -22.8, 9.2, 2.6, 0.8, '#1E1A3A'),
      R(19.6, -8.2, 3, 2, 0.8, '#C9CEDD'), R(-21.6, -8.2, 3, 2, 0.8, '#C9CEDD')
    ].concat(w.tires);
    var det = [
      R(-9.5, -13.6, 21, 6.4, 1, '#F2F4FA'),
      P('M-4 -14L-1.6 -18.6L3.2 -18.6L3.2 -14Z', '#2A4A7A'), P('M4.6 -14L4.6 -18.6L8 -18.6L10.8 -14Z', '#2A4A7A'),
      R(-2.2, -22.4, 4.2, 1.8, 0.6, red ? '#FF2B4A' : '#6A1020'), R(2, -22.4, 4.2, 1.8, 0.6, red ? '#1C3A80' : '#2E7BFF'),
      P('M1 -12.2L1.5 -10.9L2.9 -10.9L1.8 -10.1L2.2 -8.8L1 -9.6L-0.2 -8.8L0.2 -10.1L-0.9 -10.9L0.5 -10.9Z', '#F4C552'),
      E(20.2, -11.6, 1, 0.8, '#FFF3B0')
    ].concat(w.rims);
    return art([[far, 0], [body, 2], [det, 0]], frame === 0 ? -0.4 : 0);
  }

  // Катер: белый корпус с розовой полосой, брызги за кормой. Начало — ватерлиния.
  function boat(frame) {
    var a = frame === 0;
    var far = a ? [P('M-21 -2L-35 -5L-30 -0.4Z', '#FFFFFFCC'), C(-27, -3.4, 2.2, '#FFFFFF88'), C(26.5, -1.4, 1.4, '#FFFFFFAA')]
      : [P('M-21 -1.6L-38 -3.4L-31 0Z', '#FFFFFFAA'), C(-31, -4.6, 1.8, '#FFFFFF77'), C(27.5, -2.4, 1.1, '#FFFFFF88')];
    var body = [
      P('M-21 -9L18 -9Q24 -8.6 27.4 -6L23.4 -1.4Q21.4 0 17 0L-19 0Q-21 0 -21 -2Z', '#F2F4FA'),
      R(-23, -12.4, 4.4, 6.4, 1, '#1E1A3A'),
      P('M1.6 -9L5.6 -14.4L9 -14.4L10.6 -9Z', '#2EF2E0')
    ];
    var det = [
      P('M-21 -5.2L25.2 -5.2L23.9 -3.6L-21 -3.6Z', '#FF3EA5'),
      Ln('M-20 -7.2L22.6 -7.2', '#2EF2E0', 0.8, true),
      R(-8, -11.8, 6, 2.8, 1, '#FF3EA5'),
      Ln('M6 -13.4L8.4 -10', '#FFFFFF', 0.6, true)
    ];
    return art([[far, 0], [body, 2], [det, 0]], a ? -0.8 : 0);
  }

  // Чихуахуа в солнечных очках на гидроцикле (талисман Miami Browser).
  var CHI = { fawn: '#E9AE6E', cream: '#FBE0BC', inner: '#FFB3CF', ink: '#1A0A33' };
  function jetski(frame) {
    var a = frame === 0, c = CHI;
    var far = a ? [P('M-14 -1.6L-27 -4.6L-22 -0.2Z', '#FFFFFFCC'), C(-20, -3.6, 1.8, '#FFFFFF88')]
      : [P('M-14 -1.2L-30 -2.8L-24 0Z', '#FFFFFFAA'), C(-24, -4.8, 1.5, '#FFFFFF77')];
    var body = [
      P('M-14 -6L10 -6Q16 -5.6 18.4 -3L15.4 -0.6Q14 0 11 0L-12 0Q-14 0 -14 -1.6Z', '#2EF2E0'),
      R(-9, -8.2, 10, 2.8, 1.2, '#1E1A3A'),
      Ln('M6 -6L9 -12.2', '#1E1A3A', 1.3),
      Ln('M-6.4 -11.6Q-9.4 -14 -8.2 -16.6', c.fawn, 1.5),
      E(-2, -11.6, 4.6, 3.8, c.fawn),
      Ln('M1 -11L8 -12', c.fawn, 1.8),
      P('M-0.4 -19.4L-4.6 -25.8L1.8 -21.2Z', c.fawn), P('M4.2 -20.4L7.4 -26.8L7.2 -19.6Z', c.fawn),
      C(2.6, -17.2, 4.5, c.fawn),
      E(6.4, -15.6, 2.2, 1.7, c.cream)
    ];
    var det = [
      P('M-14 -3.6L16.8 -3.6L15.8 -2.4L-14 -2.4Z', '#FF3EA5'),
      Ln('M7.6 -12.6L10.8 -11.6', '#1E1A3A', 1.2, true),
      P('M-0.6 -20.4L-3 -24L0.8 -21.4Z', c.inner), P('M4.8 -20.6L6.6 -24.6L6.6 -20.2Z', c.inner),
      C(8.4, -15.9, 0.7, c.ink),
      R(1.4, -18.9, 5, 2.1, 0.9, c.ink), Ln('M2.4 -18.4L3.6 -17.4', '#FF6FB5', 0.5, true),
      Ln('M1.4 -18L-1.8 -17.6', c.ink, 0.6, true),
      P('M-1 -13.6L5.6 -13.8L2.4 -10.8Z', '#2EF2E0')
    ];
    return art([[far, 0], [body, 1.8], [det, 0]], a ? -0.7 : 0);
  }

  var VICE_KINDS = { car: 1, boat: 1, jetski: 1 };
  var VICE_ART = {
    car: [car(0), car(1)], police: [police(0), police(1)], boat: [boat(0), boat(1)], jetski: [jetski(0), jetski(1)],
    palmNight: palmArt(VICE.night.palm), palmDay: palmArt(VICE.day.palm),
    sparklePink: sparkleArt('#FF6FB5'), sparkleTeal: sparkleArt('#2EF2E0'), sparkleYellow: sparkleArt('#FFD45E'), heart: heartArt()
  };

  /**
   * Кадр сцены Vice (те же числа — в Kotlin: CvRaceScene.vice). W×H — размер рисунка в px; t — мс от начала;
   * p — 0..1 или null (бег по кругу); fin — мс после 100% в режиме «готово» или null; sign — рисовать вывеску с %.
   */
  function viceScene(kind, W, H, t, p, fin, reduce, sign) {
    var u = H / H0, x0 = PAD * u, x1 = W - PAD * u, L = x1 - x0;
    var step = reduce ? 1 : Math.floor(t / STEP) % 2;
    var water = kind !== 'car';
    var lineY = LINE_Y * u;
    var gap = VG.PALM_GAP * u, off = reduce ? 0 : t * VG.PALM_V * u;
    var i0 = Math.floor(off / gap), palms = [];
    for (var j = 0, px = x0 + 18 * u - (off - i0 * gap); px < x1 + 30 * u; j++, px += gap) {
      palms.push(px, PALM_SC[(i0 + j) % PALM_SC.length]);
    }
    var period = (VG.LANE_DASH + VG.LANE_GAP) * u;
    var laneOff = reduce ? 0 : (t * VG.LANE_V * u) % period;
    var endX = x1 - (sign ? (kind === 'jetski' ? VG.END_JETSKI : VG.END) : VG.END_COMPACT) * u, startX = x0 + VG.START * u;
    var hx, trailFrom = x0, trailTo;
    if (p == null) {
      var ph = (t % LAP) / LAP;
      hx = x0 - 30 * u + ph * (L + 60 * u + (kind === 'car' ? VG.POLICE_GAP * u : 0));
      trailTo = Math.max(x0, Math.min(x1, hx - 20 * u));
      trailFrom = Math.max(x0, trailTo - L * 0.3);
    } else {
      hx = startX + p * (endX - startX);
      trailTo = Math.max(x0, Math.min(x1, x0 + p * L));
    }
    var done = fin != null && p != null, k = done ? Math.min(1, fin / 500) : 0;
    var items = [], A = VICE_ART;
    if (kind === 'car') {
      items.push({ art: A.police[step], x: hx - VG.POLICE_GAP * u - 26 * u * k, y: lineY, s: u, alpha: 1 - 0.55 * k });
      items.push({ art: A.car[done ? 1 : step], x: hx, y: lineY, s: u });
    } else if (kind === 'boat') {
      items.push({ art: A.boat[done ? 1 : step], x: hx, y: lineY, s: u });
    } else {
      items.push({ art: A.jetski[done ? 1 : step], x: hx, y: lineY, s: u * 1.2 });
    }
    if (done) {
      // искры — под вывеской и слева от героя, чтобы не закрывать процент
      items.push({ art: A.sparklePink, x: hx - 18 * u, y: lineY - (20 + 4 * k) * u, s: u * (0.5 + 0.6 * k) });
      items.push({ art: A.sparkleTeal, x: hx - 32 * u, y: lineY - 14 * u, s: u * 0.6 * k });
      items.push({ art: A.sparkleYellow, x: hx + 24 * u, y: lineY - 19 * u, s: u * 0.5 * k });
      if (kind === 'jetski') items.push({ art: A.heart, x: hx - 14 * u, y: lineY - (30 + 3 * k) * u, s: u * (0.6 + 0.5 * k) });
    }
    var pctv = p == null ? null : Math.max(0, Math.min(100, Math.round(p * 100)));
    return {
      u: u, x0: x0, x1: x1, W: W, H: H, lineY: lineY, water: water, hy: VG.HY * u, curb: VG.CURB * u, laneY: VG.LANE_Y * u,
      sunX: x0 + L * 0.62, sunR: VG.SUN_R * u, palms: palms, laneOff: laneOff, period: period,
      trailFrom: trailFrom, trailTo: trailTo, items: items, percent: pctv,
      sign: sign ? { x: x1 - (VG.SIGN_RIGHT + VG.SIGN_W) * u, y: VG.SIGN_TOP * u, w: VG.SIGN_W * u, h: VG.SIGN_H * u,
        text: pctv == null ? '• • •' : pctv + '%', flash: done && fin < 700 && Math.floor(fin / 140) % 2 === 1 } : null
    };
  }

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
    '.cvl-vice:not(.cvl-compact) .cvl-pct{display:none}' +
    '.cvl-vice:not(.cvl-compact) .cvl-row{justify-content:flex-start}' +
    '.cvl-vice.cvl-compact .cvl-pct{color:var(--cvl-neon-text,#FFF4FB);font-family:var(--cvl-sign-font,inherit);text-shadow:0 0 3px var(--cvl-neon,#FF3EA5),0 0 9px var(--cvl-neon,#FF3EA5)}' +
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
  var lastVice = 'boat';
  function pickKind(kind) {
    if (kind === 'chase' || kind === 'eater' || VICE_KINDS[kind]) return kind;
    var pref = null;
    try { pref = G.localStorage && G.localStorage.getItem('cv_loader_kind'); } catch (e) { /* */ }
    var look = themeLook();
    if (look.vice) {
      // темы Vice: маслкар и катер по очереди; Miami Browser — всегда чихуахуа на гидроцикле
      if (look.miami) return 'jetski';
      if (VICE_KINDS[pref]) return pref;
      lastVice = lastVice === 'car' ? 'boat' : 'car';
      return lastVice;
    }
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
    if (VICE_KINDS[kind]) return viceLoader(host, opts, kind);
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

  // ── загрузчик Vice (car / boat / jetski): тот же API, что у cvLoader ──
  function themeLook() {
    var d = G.document && G.document.documentElement;
    if (!d) return { vice: false, day: false, miami: false };
    var th = d.getAttribute('data-theme') || '', cl = d.classList;
    var vice = cl.contains('vice') || cl.contains('vice-night') || cl.contains('vice-day') || th.indexOf('vice') === 0;
    return {
      vice: vice,
      day: cl.contains('vice-day') || th === 'vice-day',
      miami: cl.contains('miami') || d.getAttribute('data-brand') === 'miami'
    };
  }

  function gradStops(cols, at) {
    var s = '';
    for (var i = 0; i < cols.length; i++) s += '<stop offset="' + (at ? at[i] : i / (cols.length - 1)) + '" stop-color="' + cols[i] + '"/>';
    return s;
  }

  // Неподвижная часть сцены: небо, солнце с прорезями, горизонт, море или дорога. Строка SVG.
  function viceBackdrop(s, pal, id) {
    var W = s.W, H = s.H, u = s.u, hy = s.hy, sx = s.sunX, sr = s.sunR, sy = hy - 2 * u;
    var d = '<clipPath id="' + id + 'c"><rect x="0" y="0" width="' + W + '" height="' + H + '" rx="' + r2(VG.RADIUS * u) + '"/></clipPath>' +
      '<linearGradient id="' + id + 'k" x1="0" y1="0" x2="0" y2="' + hy + '" gradientUnits="userSpaceOnUse">' + gradStops(pal.sky, pal.skyAt) + '</linearGradient>' +
      '<linearGradient id="' + id + 'n" x1="0" y1="' + (sy - sr) + '" x2="0" y2="' + (sy + sr) + '" gradientUnits="userSpaceOnUse">' + gradStops(pal.sun) + '</linearGradient>' +
      '<linearGradient id="' + id + 'w" x1="0" y1="' + hy + '" x2="0" y2="' + H + '" gradientUnits="userSpaceOnUse">' + gradStops(pal.sea) + '</linearGradient>';
    // солнце — полосами (clipPath из прямоугольников)
    var bands = '', y = sy - sr - 1, y0 = sy - sr * 0.12, span = hy - y0;
    for (var i = 0; i < 4; i++) {
      var yy = y0 + span * (i + 0.35) / 4, th = sr * (0.03 + 0.1 * (i + 0.5) / 4);
      bands += '<rect x="' + r2(sx - sr - 1) + '" y="' + r2(y) + '" width="' + r2(2 * sr + 2) + '" height="' + r2(Math.max(0, yy - y)) + '"/>';
      y = yy + th;
    }
    bands += '<rect x="' + r2(sx - sr - 1) + '" y="' + r2(y) + '" width="' + r2(2 * sr + 2) + '" height="' + r2(Math.max(0, hy - y)) + '"/>';
    d += '<clipPath id="' + id + 'b">' + bands + '</clipPath>';
    var g = '<rect x="0" y="0" width="' + W + '" height="' + r2(hy + 1) + '" fill="url(#' + id + 'k)"/>' +
      '<circle cx="' + r2(sx) + '" cy="' + r2(sy) + '" r="' + r2(sr * 1.55) + '" fill="' + pal.sun[1] + '" opacity=".16"/>' +
      '<circle cx="' + r2(sx) + '" cy="' + r2(sy) + '" r="' + r2(sr) + '" fill="url(#' + id + 'n)" clip-path="url(#' + id + 'b)"/>';
    if (s.water) {
      g += '<rect x="0" y="' + r2(hy) + '" width="' + W + '" height="' + r2(H - hy) + '" fill="url(#' + id + 'w)"/>';
      for (var k = 0; k < 4; k++) {
        var bw = sr * (1.6 - 0.3 * k), by = hy + (1.6 + k * 3.2) * u;
        g += '<rect x="' + r2(sx - bw / 2) + '" y="' + r2(by) + '" width="' + r2(bw) + '" height="' + r2(0.9 * u) + '" rx="' + r2(0.45 * u) + '" fill="' + pal.sun[1 + (k % 3)] + '" opacity="' + (0.8 - 0.15 * k) + '"/>';
      }
    } else {
      g += '<rect x="0" y="' + r2(hy) + '" width="' + W + '" height="' + r2(3 * u) + '" fill="url(#' + id + 'w)"/>' +
        '<rect x="0" y="' + r2(hy + 3 * u) + '" width="' + W + '" height="' + r2(s.curb - hy - 2 * u) + '" fill="' + pal.curb + '"/>' +
        '<rect x="0" y="' + r2(s.curb + u) + '" width="' + W + '" height="' + r2(H - s.curb - u) + '" fill="' + pal.road + '"/>' +
        '<rect x="0" y="' + r2(s.curb + u) + '" width="' + W + '" height="' + r2(0.6 * u) + '" fill="' + pal.trail2 + '" opacity=".55"/>';
    }
    g += '<rect x="0" y="' + r2(hy - 0.4 * u) + '" width="' + W + '" height="' + r2(0.8 * u) + '" fill="' + pal.horizon + '" opacity=".9"/>';
    return { defs: d, back: g };
  }

  function viceLoader(host, opts, kind) {
    var hpx = opts.size || H0, compact = !!opts.compact, id = 'cvl' + (++uid), withSign = !compact;
    var box = G.document.createElement('div');
    box.className = 'cvl cvl-vice' + (compact ? ' cvl-compact' : '') + ' cvl-' + kind;
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
    function syncRow() { if (!compact) row.style.display = lab.textContent ? '' : 'none'; }
    syncRow();

    var svg = el('svg', { height: String(hpx), 'aria-hidden': 'true' });
    svg.style.height = hpx + 'px';
    var defs = el('defs', {}), clip = el('g', {}), back = el('g', {}), gPalms = el('g', {});
    var lane = el('line', {}), halo = el('line', { opacity: '0.35', 'stroke-linecap': 'round' }), trail = el('line', { 'stroke-linecap': 'round' });
    var gSign = el('g', {}), gFx = el('g', {}), border = el('rect', { fill: 'none', opacity: '0.6' });
    svg.appendChild(defs);
    svg.appendChild(clip);
    [back, gPalms, lane, halo, trail, gSign].forEach(function (n) { clip.appendChild(n); });
    function creature() {
      var outer = el('g', {}), lift = el('g', {}), far = el('g', {}), main = el('g', {});
      lift.appendChild(far);
      lift.appendChild(main);
      outer.appendChild(lift);
      clip.appendChild(outer);
      return { outer: outer, lift: lift, far: far, main: main, art: null };
    }
    var cops = kind === 'car' ? creature() : null;
    var hero = creature();
    clip.appendChild(gFx);
    svg.appendChild(border);
    box.appendChild(svg);
    if (opts.replace !== false) host.innerHTML = '';
    host.appendChild(box);

    var mode = opts.progress === 'loop' ? 'loop' : (typeof opts.progress === 'number' ? 'set' : 'auto');
    var target = mode === 'set' ? Math.max(0, Math.min(1, opts.progress / 100)) : 0;
    var shownP = 0, t0 = now(), finishing = null, finishedAt = 0, destroyed = false, raf = 0, W = 0, day = null;
    var unsub = null, globalPct = null, palmNodes = [], signNodes = null;
    function now() { return (G.performance && G.performance.now) ? G.performance.now() : Date.now(); }
    if (mode === 'auto') unsub = CvLoad.subscribe(function (s) { globalPct = s.active || s.pct ? s.pct : null; });

    function pal() { return day ? VICE.day : VICE.night; }

    function layout() {
      var w = svg.getBoundingClientRect().width || 300;
      var d = opts.day != null ? !!opts.day : themeLook().day;
      if (Math.abs(w - W) < 0.5 && d === day) return;
      W = w;
      day = d;
      var P0 = pal(), s = viceScene(kind, W, hpx, 0, 0, null, reduce, withSign), u = s.u;
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + hpx);
      var bd = viceBackdrop(s, P0, id);
      defs.innerHTML = bd.defs;
      clip.setAttribute('clip-path', 'url(#' + id + 'c)');
      back.innerHTML = bd.back;
      border.setAttribute('x', '0.5'); border.setAttribute('y', '0.5');
      border.setAttribute('width', String(Math.max(0, W - 1))); border.setAttribute('height', String(hpx - 1));
      border.setAttribute('rx', String(r2(VG.RADIUS * u))); border.setAttribute('stroke', P0.edge);
      var palmArtNow = day ? VICE_ART.palmDay : VICE_ART.palmNight;
      gPalms.innerHTML = '';
      palmNodes = [];
      var n = Math.ceil(W / (VG.PALM_GAP * u)) + 3;
      for (var i = 0; i < n; i++) {
        var g = el('g', {});
        g.innerHTML = palmArtNow.main;
        gPalms.appendChild(g);
        palmNodes.push(g);
      }
      lane.setAttribute('x1', s.x0); lane.setAttribute('x2', s.x1);
      lane.setAttribute('y1', s.laneY); lane.setAttribute('y2', s.laneY);
      lane.setAttribute('stroke', s.water ? '#FFFFFF' : P0.lane);
      lane.setAttribute('opacity', s.water ? '0.45' : '0.85');
      lane.setAttribute('stroke-width', String(r2((s.water ? 0.8 : 1.1) * u)));
      lane.setAttribute('stroke-dasharray', r2(VG.LANE_DASH * u) + ' ' + r2(VG.LANE_GAP * u));
      [halo, trail].forEach(function (n2) { n2.setAttribute('y1', s.laneY); n2.setAttribute('y2', s.laneY); n2.setAttribute('stroke', P0.trail); });
      halo.setAttribute('stroke-width', String(r2(3.6 * u)));
      trail.setAttribute('stroke-width', String(r2(1.4 * u)));
      gSign.innerHTML = '';
      signNodes = null;
      if (s.sign) {
        var sg = s.sign, cx = sg.x + sg.w / 2, postTop = sg.y + sg.h, postBot = s.water ? s.hy + 2 * u : s.curb + u;
        gSign.innerHTML =
          '<rect x="' + r2(cx - 0.8 * u) + '" y="' + r2(postTop) + '" width="' + r2(1.6 * u) + '" height="' + r2(Math.max(0, postBot - postTop)) + '" fill="' + P0.palm + '"/>' +
          '<rect x="' + r2(sg.x) + '" y="' + r2(sg.y) + '" width="' + r2(sg.w) + '" height="' + r2(sg.h) + '" rx="' + r2(3 * u) + '" fill="none" stroke="' + P0.signGlow + '" stroke-width="' + r2(3 * u) + '" opacity=".3"/>' +
          '<rect class="cvl-sbox" x="' + r2(sg.x) + '" y="' + r2(sg.y) + '" width="' + r2(sg.w) + '" height="' + r2(sg.h) + '" rx="' + r2(3 * u) + '" fill="' + P0.signBg + '" stroke="' + P0.signEdge + '" stroke-width="' + r2(u) + '"/>' +
          '<text class="cvl-sglow" x="' + r2(cx) + '" y="' + r2(sg.y + sg.h * 0.72) + '" text-anchor="middle" font-size="' + r2(9.5 * u) + '" fill="none" stroke="' + P0.signGlow + '" stroke-width="' + r2(2.4 * u) + '" opacity=".45"></text>' +
          '<text class="cvl-stext" x="' + r2(cx) + '" y="' + r2(sg.y + sg.h * 0.72) + '" text-anchor="middle" font-size="' + r2(9.5 * u) + '" fill="' + P0.signText + '" stroke="' + P0.signGlow + '" stroke-width="' + r2(0.5 * u) + '" paint-order="stroke"></text>';
        signNodes = { box: gSign.querySelector('.cvl-sbox'), glow: gSign.querySelector('.cvl-sglow'), text: gSign.querySelector('.cvl-stext'), txt: '' };
        signNodes.glow.style.fontFamily = signNodes.text.style.fontFamily = 'var(--cvl-sign-font, Unbounded, "Arial Black", sans-serif)';
        signNodes.glow.style.fontWeight = signNodes.text.style.fontWeight = '800';
      }
    }

    function setArt(c, a) {
      if (c.art === a) return;
      c.far.innerHTML = a.far;
      c.main.innerHTML = a.main;
      c.lift.setAttribute('transform', 'translate(0,' + a.lift + ')');
      c.art = a;
    }

    function render() {
      raf = 0;
      if (destroyed) return;
      if (!box.isConnected) { destroy(); return; }
      layout();
      var t = now(), p;
      if (mode === 'loop') {
        p = null;
      } else {
        if (mode === 'auto' && !finishing) target = globalPct != null ? globalPct / 100 : 0.95 * (1 - Math.exp(-(t - t0) / 2600));
        if (finishing) target = 1;
        shownP += (target - shownP) * 0.16;
        if (Math.abs(target - shownP) < 0.002) shownP = target;
        p = shownP;
      }
      var done = finishing && p >= 0.999;
      if (done && !finishedAt) finishedAt = t;
      var s = viceScene(kind, W, hpx, t - t0, p, done ? t - finishedAt : null, reduce, withSign), u = s.u, P0 = pal();
      var palmArtNow = day ? VICE_ART.palmDay : VICE_ART.palmNight, gy = s.water ? s.hy + 0.6 * u : s.curb + 0.6 * u;
      for (var i = 0; i < palmNodes.length; i++) {
        var g = palmNodes[i];
        if (i * 2 < s.palms.length) {
          var sc = u * s.palms[i * 2 + 1] * (s.water ? 0.8 : 1);
          g.setAttribute('transform', 'translate(' + r2(s.palms[i * 2]) + ',' + r2(gy) + ') scale(' + r2(sc * 1000) / 1000 + ')');
          g.style.display = '';
        } else g.style.display = 'none';
      }
      void palmArtNow;
      lane.setAttribute('stroke-dashoffset', String(r2(s.laneOff)));
      var tf = s.trailFrom, tt = Math.max(s.trailFrom, s.trailTo);
      [halo, trail].forEach(function (n2) { n2.setAttribute('x1', r2(tf)); n2.setAttribute('x2', r2(tt)); });
      if (signNodes) {
        if (signNodes.txt !== s.sign.text) { signNodes.text.textContent = signNodes.glow.textContent = signNodes.txt = s.sign.text; }
        signNodes.box.setAttribute('fill', s.sign.flash ? P0.signEdge : P0.signBg);
      }
      var heroItem = s.items[kind === 'car' ? 1 : 0];
      if (cops) {
        var pi = s.items[0];
        setArt(cops, pi.art);
        cops.outer.setAttribute('transform', 'translate(' + r2(pi.x) + ',' + r2(pi.y) + ') scale(' + r2(u * 1000) / 1000 + ')');
        cops.outer.style.opacity = pi.alpha != null && pi.alpha < 1 ? String(r2(pi.alpha)) : '';
      }
      setArt(hero, heroItem.art);
      hero.outer.setAttribute('transform', 'translate(' + r2(heroItem.x) + ',' + r2(heroItem.y) + ') scale(' + r2(heroItem.s * 1000) / 1000 + ')');
      var fx = '';
      for (var k = (kind === 'car' ? 2 : 1); k < s.items.length; k++) {
        var it = s.items[k];
        if (it.s <= 0) continue;
        fx += '<g transform="translate(' + r2(it.x) + ',' + r2(it.y) + ') scale(' + r2(it.s * 1000) / 1000 + ')">' + it.art.main + '</g>';
      }
      gFx.innerHTML = fx;
      var txt = s.percent == null ? '' : s.percent + '%';
      if (pct.textContent !== txt) pct.textContent = txt;
      if (s.percent != null) box.setAttribute('aria-valuenow', String(s.percent));
      if (finishing && finishedAt && t - finishedAt >= FINISH) {
        var f = finishing;
        finishing = null;
        f();
        if (opts.keepFinal) return;
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
      label: function (s) { lab.textContent = s || ''; syncRow(); },
      done: function () {
        if (mode === 'loop') { mode = 'set'; shownP = 0.85; }
        return new Promise(function (res) { finishing = res; finishedAt = 0; schedule(); });
      },
      reset: function () { finishing = null; finishedAt = 0; shownP = 0; target = 0; t0 = now(); schedule(); },
      destroy: destroy
    };
  }

  // Статичный кадр сцены Vice строкой SVG (превью, тесты, картинки).
  function viceSnapshot(kind, p, frame, width, day, height) {
    var H = height || H0, W = width || 320;
    var s = viceScene(kind, W, H, (frame || 0) * STEP + 1, p, p >= 1 ? 600 : null, false, true), u = s.u;
    var P0 = day ? VICE.day : VICE.night, id = 'vs' + (++uid), bd = viceBackdrop(s, P0, id);
    var o = '<svg xmlns="' + NS + '" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '"><defs>' + bd.defs + '</defs><g clip-path="url(#' + id + 'c)">' + bd.back;
    var gy = s.water ? s.hy + 0.6 * u : s.curb + 0.6 * u, pa = day ? VICE_ART.palmDay : VICE_ART.palmNight;
    for (var i = 0; i < s.palms.length; i += 2) o += '<g transform="translate(' + r2(s.palms[i]) + ',' + r2(gy) + ') scale(' + r2(u * s.palms[i + 1] * (s.water ? 0.8 : 1) * 1000) / 1000 + ')">' + pa.main + '</g>';
    o += '<line x1="' + s.x0 + '" x2="' + s.x1 + '" y1="' + s.laneY + '" y2="' + s.laneY + '" stroke="' + (s.water ? '#FFFFFF' : P0.lane) + '" opacity="' + (s.water ? 0.45 : 0.85) + '" stroke-width="' + r2((s.water ? 0.8 : 1.1) * u) + '" stroke-dasharray="' + r2(VG.LANE_DASH * u) + ' ' + r2(VG.LANE_GAP * u) + '"/>';
    o += '<line x1="' + r2(s.trailFrom) + '" x2="' + r2(s.trailTo) + '" y1="' + s.laneY + '" y2="' + s.laneY + '" stroke="' + P0.trail + '" stroke-width="' + r2(3.6 * u) + '" opacity=".35" stroke-linecap="round"/>';
    o += '<line x1="' + r2(s.trailFrom) + '" x2="' + r2(s.trailTo) + '" y1="' + s.laneY + '" y2="' + s.laneY + '" stroke="' + P0.trail + '" stroke-width="' + r2(1.4 * u) + '" stroke-linecap="round"/>';
    if (s.sign) {
      var sg = s.sign, cx = sg.x + sg.w / 2, postBot = s.water ? s.hy + 2 * u : s.curb + u, fs = r2(9.5 * u), ty = r2(sg.y + sg.h * 0.72);
      o += '<rect x="' + r2(cx - 0.8 * u) + '" y="' + r2(sg.y + sg.h) + '" width="' + r2(1.6 * u) + '" height="' + r2(postBot - sg.y - sg.h) + '" fill="' + P0.palm + '"/>' +
        '<rect x="' + r2(sg.x) + '" y="' + r2(sg.y) + '" width="' + r2(sg.w) + '" height="' + r2(sg.h) + '" rx="' + r2(3 * u) + '" fill="' + P0.signBg + '" stroke="' + P0.signEdge + '" stroke-width="' + r2(u) + '"/>' +
        '<text x="' + r2(cx) + '" y="' + ty + '" text-anchor="middle" font-family="Unbounded, Arial Black, sans-serif" font-weight="800" font-size="' + fs + '" fill="none" stroke="' + P0.signGlow + '" stroke-width="' + r2(2.4 * u) + '" opacity=".45">' + sg.text + '</text>' +
        '<text x="' + r2(cx) + '" y="' + ty + '" text-anchor="middle" font-family="Unbounded, Arial Black, sans-serif" font-weight="800" font-size="' + fs + '" fill="' + P0.signText + '">' + sg.text + '</text>';
    }
    for (var k = 0; k < s.items.length; k++) {
      var it = s.items[k];
      if (it.s <= 0) continue;
      o += '<g opacity="' + (it.alpha != null ? r2(it.alpha) : 1) + '" transform="translate(' + r2(it.x) + ',' + r2(it.y) + ') scale(' + r2(it.s * 1000) / 1000 + ')"><g transform="translate(0,' + it.art.lift + ')">' + it.art.far + it.art.main + '</g></g>';
    }
    o += '</g><rect x="0.5" y="0.5" width="' + (W - 1) + '" height="' + (H - 1) + '" rx="' + r2(VG.RADIUS * u) + '" fill="none" stroke="' + P0.edge + '" opacity=".6"/></svg>';
    return o;
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
  function snapshot(kind, p, frame, width, day) {
    if (VICE_KINDS[kind]) return viceSnapshot(kind, p, frame, width, day);
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
    _geom: { H0: H0, LINE_Y: LINE_Y, PAD: PAD, GAP: GAP, STEP: STEP, LAP: LAP, FINISH: FINISH },
    _vice: { art: VICE_ART, geom: VG, palmScale: PALM_SC, palettes: VICE, scene: viceScene }
  };
  G.cvLoader = G.cvLoader || cvLoader;
  if (typeof module !== 'undefined' && module.exports) module.exports = G.CvLoaders;
})();
