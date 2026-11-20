/*!
 * Cloud VPN — рекламная плашка (формат ads.json: /root/remnawave-bedolaga-telegram-bot/app/ads/FORMAT.md). Без зависимостей.
 *
 *   CvAds.plate(el, { slot: 'cabinet.home', line: 'auto'|'vice'|'cloud', platform: 'auto'|'android'|'windows'|'web',
 *                     open: url => …, sources: [...], base: 'https://cabinet.zjd.uk/app/ads/', asset: url => url,
 *                     send: body => Promise<boolean>, clickVia: 'auto'|'counter'|'direct', look: 'auto'|'vice'|'ff7'|'plain' })
 *                                                                                                     → { destroy() }
 *   line — какие баннеры показывать (линия Vice или Cloud); look — оформление, по умолчанию по теме хоста (ниже).
 *   base — от чего считать пути картинок (по умолчанию наш сервер, а не адрес, откуда пришёл ads.json);
 *   send — своя отправка показов (тело — JSON-строка); clickVia: 'counter' — всегда click?s=слот (программа сама решит,
 *   что открыть), 'direct' — всегда url.
 *
 * - Данные: https://cabinet.zjd.uk/app/ads/ads.json (свои адреса — sources), кэш на ttl секунд; без сети — последний кэш.
 *   Картинки — относительно ads.json; asset(url) — свой путь для них (строгий CSP, сеть через прокси приложения).
 * - Нет слота в slots или подходящих баннеров → плашки нет (el.hidden = true), без пустой рамки. Закрыть плашку нельзя.
 * - Ротация по правилам слота (interval ≥ 10 с, order weight | round, max), только пока плашка видна и вкладка активна;
 *   смена — кроссфейд 300 мс (без него при prefers-reduced-motion).
 * - Показ = баннер виден ≥ 50 % площади ≥ 1 с. Суммы копятся (localStorage) и уходят POST text/plain на hit не чаще раза
 *   в 10 минут и при уходе страницы в фон. Никаких идентификаторов. Неотправленное живёт 7 суток.
 * - Приватность: все запросы — fetch с credentials:'omit' и referrerPolicy:'no-referrer' (sendBeacon не используется —
 *   он шлёт куки); картинки — <img referrerpolicy="no-referrer">. С опцией sources (сеть через приложение) показы уходят
 *   только через send; без send они копятся, напрямую ничего не отправляется.
 * - Форматы мест: wide 4:1, side 2:1, strip 6:1 (image_strip; иначе image слева на 2/3 и title справа).
 * - Нажатие — open(url) (по умолчанию новое окно): click + '?s=' + слот, если ads.json пришёл с сервера сейчас;
 *   url, если показан кэш (клик тогда считается в пакете как clk).
 * - Маркировка: mark.label → метка «Реклама» (у HTML — в строке заголовка); advertiser / erid → строка «Реклама · … ·
 *   erid: …» полосой под текстом (тогда отдельной метки нет).
 * - Оформление по теме хоста (классы или data-theme на <html>): vice / vice-night / vice-day → Vice; ff7 («Классика RPG»)
 *   → синее окно; dark / light (обычные темы) → нейтральное, цвета из переменных хоста --cvp-bg, --cvp-fg, --cvp-edge,
 *   --cvp-accent, --cvp-on-accent (без них — простой тёмный или светлый). Нет классов темы — как раньше, по линии.
 */
(function () {
  'use strict';
  var G = typeof globalThis !== 'undefined' ? globalThis : window;
  if (G.CvAds) return;
  var doc = G.document;
  var SOURCES = ['https://cabinet.zjd.uk/app/ads/ads.json'];
  var BASE = 'https://cabinet.zjd.uk/app/ads/';
  var CACHE = 'cv_ads_json_v1', HITS = 'cv_ads_hits_v1';
  var FMT = { wide: [4, 1], side: [2, 1], strip: [6, 1] };
  var NOFETCH = { credentials: 'omit', referrerPolicy: 'no-referrer' };
  var ALLOWED = /^(b|strong|i|em|u|s|br|small)$/;
  var reduce = false;
  try { reduce = G.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* */ }
  function now() { return Date.now(); }
  function ls(k, v) {
    try {
      if (v === undefined) return JSON.parse(G.localStorage.getItem(k) || 'null');
      G.localStorage.setItem(k, JSON.stringify(v));
    } catch (e) { /* */ }
    return null;
  }

  // ── данные ──
  var inflight = null, fresh = null;  // fresh: ads.json, полученный с сервера в этой загрузке страницы
  function load(o) {
    var srcs = (o && o.sources && o.sources.length) ? o.sources : SOURCES;
    var c = ls(CACHE);
    var ttl = c && c.data && c.data.ttl ? c.data.ttl * 1000 : 3600e3;
    if (fresh) return Promise.resolve(fresh);
    if (c && now() - c.t < ttl) return Promise.resolve({ data: c.data, base: c.base, server: !!c.server });
    if (inflight) return inflight;
    var i = 0;
    function next() {
      if (i >= srcs.length) return Promise.reject(new Error('no source'));
      var url = srcs[i++];
      return G.fetch(url, { cache: 'no-store', cvSilent: true, credentials: 'omit', referrerPolicy: 'no-referrer' })
        .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
        .then(function (d) { if (!d || !d.ads) throw new Error('bad'); return { data: d, base: url.replace(/[^/]*$/, ''), server: true }; })
        .catch(function () { return next(); });
    }
    inflight = next().then(function (f) {
      ls(CACHE, { t: now(), data: f.data, base: f.base, server: true });
      fresh = f; inflight = null; return f;
    }, function (e) {
      inflight = null;
      if (c && c.data) return { data: c.data, base: c.base, server: false };  // нет сети — старый кэш, клики напрямую
      throw e;
    });
    return inflight;
  }

  function isVice() {
    var r = doc.documentElement, th = r.getAttribute('data-theme') || '';
    return r.classList.contains('vice') || r.classList.contains('vice-night') || r.classList.contains('vice-day') || th.indexOf('vice') === 0;
  }
  function isDay() {
    var r = doc.documentElement, th = r.getAttribute('data-theme') || '';
    return r.classList.contains('vice-day') || r.classList.contains('light') || th === 'light' || th === 'vice-day';
  }
  /** Оформление по теме хоста: Vice — только при темах Vice, ff7 — только при «Классике RPG», обычные тёмная/светлая —
   *  нейтральное. o.look задаёт явно. Без классов темы — по линии (vice → Vice, cloud → ff7), как было. */
  function lookOf(o, line) {
    if (o.look === 'vice' || o.look === 'ff7' || o.look === 'plain') return o.look;
    var r = doc.documentElement, c = r.classList, th = r.getAttribute('data-theme') || '';
    if (c.contains('vice') || c.contains('vice-night') || c.contains('vice-day') || th.indexOf('vice') === 0) return 'vice';
    if (c.contains('ff7') || th === 'ff7') return 'ff7';
    if (c.contains('dark') || c.contains('light') || th === 'dark' || th === 'light') return 'plain';
    return line === 'vice' ? 'vice' : 'ff7';
  }
  function platformOf(o) {
    if (o.platform && o.platform !== 'auto') return o.platform;
    if (doc.documentElement.classList.contains('native-app')) return 'android';
    if (G.__CVPN_EMBED || (G.chrome && G.chrome.webview)) return 'windows';
    return 'web';
  }
  function time(s) { if (!s) return null; var t = Date.parse(s); return isNaN(t) ? null : t; }

  /** План места: { format, interval, order, max, ads } или null — плашку не рисовать. */
  function plan(data, slot, line, platform) {
    if (!data || (data.v || 1) > 1) return null;
    var sc = data.slots && data.slots[slot];
    if (!sc) return null;
    var t = now();
    var ads = (data.ads || []).filter(function (a) {
      if (a.slots && a.slots.length && a.slots.indexOf(slot) < 0) return false;
      if (a.lines && a.lines.length && a.lines.indexOf(line) < 0) return false;
      if (a.platforms && a.platforms.length && a.platforms.indexOf(platform) < 0) return false;
      var f = time(a.from), to = time(a.to);
      if (f != null && t < f) return false;
      if (to != null && t >= to) return false;
      if (a.kind === 'image' && !a.image) return false;
      return true;
    });
    if (!ads.length) return null;
    var rot = data.rotation || {};
    var order = sc.order || rot.order || 'weight', max = sc.max != null ? sc.max : (rot.max || 0);
    if (max > 0 && ads.length > max) {
      ads = order === 'weight' ? ads.slice().sort(function (a, b) { return (b.weight || 1) - (a.weight || 1); }).slice(0, max) : ads.slice(0, max);
      if (order === 'weight') { var keep = {}; ads.forEach(function (a) { keep[a.id] = 1; }); ads = data.ads.filter(function (a) { return keep[a.id]; }); }
    }
    return { format: FMT[sc.format] ? sc.format : 'wide', interval: Math.max(10, sc.interval || rot.interval || 30), order: order, max: max, ads: ads };
  }

  var roundStart = {};
  function pick(p, cur, slot) {
    var ads = p.ads;
    if (ads.length === 1) return ads[0];
    if (p.order === 'round') {
      var i = cur ? ads.indexOf(cur) : -1;
      if (i < 0) {
        if (roundStart[slot] == null) roundStart[slot] = Math.floor(Math.random() * ads.length);
        return ads[roundStart[slot] % ads.length];
      }
      return ads[(i + 1) % ads.length];
    }
    var pool = ads.filter(function (a) { return a !== cur; }), sum = 0;
    pool.forEach(function (a) { sum += Math.max(1, a.weight || 1); });
    var r = Math.random() * sum;
    for (var k = 0; k < pool.length; k++) { r -= Math.max(1, pool[k].weight || 1); if (r <= 0) return pool[k]; }
    return pool[pool.length - 1];
  }

  // ── показы и клики ──
  var lastSend = 0, hitUrl = 'https://cabinet.zjd.uk/api/ads/hit', sender = null, direct = true;
  function count(rev, ad, slot, imp, clk) {
    var h = ls(HITS) || { rev: rev, items: {} };
    if (h.rev !== rev) { flush(true); h = ls(HITS) || { rev: rev, items: {} }; if (h.rev !== rev) h = { rev: rev, items: {} }; }
    var k = ad + '|' + slot, it = h.items[k] || { ad: ad, slot: slot, imp: 0, clk: 0, t: now() };
    it.imp = Math.min(1000, it.imp + imp);
    it.clk = Math.min(50, it.clk + clk);
    h.items[k] = it;
    ls(HITS, h);
    if (now() - lastSend > 600e3) flush(false);
  }
  function flush(beacon) {
    var h = ls(HITS);
    if (!h || !h.items) return;
    var week = now() - 7 * 864e5, rows = [], rest = {};
    for (var k in h.items) {
      var it = h.items[k];
      if (it.t < week) continue;
      if (rows.length < 50) rows.push({ ad: it.ad, slot: it.slot, imp: it.imp, clk: it.clk }); else rest[k] = it;
    }
    if (!rows.length) { ls(HITS, { rev: h.rev, items: rest }); return; }
    lastSend = now();
    var body = JSON.stringify({ rev: h.rev, items: rows });
    var done = function () { ls(HITS, { rev: h.rev, items: rest }); };
    if (sender) { Promise.resolve(sender(body)).then(function (ok) { if (ok) done(); }, function () { /* копим дальше */ }); return; }
    if (!direct || !G.fetch) return;  // сеть через приложение без send — не отправлять в обход
    G.fetch(hitUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: body, keepalive: !!beacon, cvSilent: true,
      credentials: NOFETCH.credentials, referrerPolicy: NOFETCH.referrerPolicy })
      .then(function (r) { if (r.ok) done(); }, function () { /* копим дальше */ });
  }
  if (doc) doc.addEventListener('visibilitychange', function () { if (doc.visibilityState === 'hidden') flush(true); });

  // ── вид ──
  var CSS = '' +
    '.cvad{position:relative;width:100%;overflow:hidden;border-radius:14px;user-select:none;-webkit-user-select:none;font:600 14px/1.3 var(--cvad-font,system-ui,-apple-system,Segoe UI,Roboto,sans-serif)}' +
    '.cvad--wide{aspect-ratio:4/1}.cvad--side{aspect-ratio:2/1}.cvad--strip{aspect-ratio:6/1;border-radius:10px}' +
    '.cvad-rowin{flex:1 1 0;min-height:0;display:flex;align-items:center;overflow:hidden}.cvad-rowin .cvad-img{width:66.7%;height:100%;flex:none}.cvad-rowin .cvad-cap{flex:1;padding:0 10px;font-weight:800;font-size:13px;overflow:hidden;display:-webkit-box;line-height:17px;-webkit-line-clamp:var(--cvad-cap-lines,2);-webkit-box-orient:vertical}' +
    '.cvad-line{flex:1;display:flex;align-items:center;gap:10px;padding:0 12px;min-width:0}.cvad-line b{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:14px}' +
    '.cvad--ff7{background:linear-gradient(180deg,#24409e,#14247a);box-shadow:0 0 0 1px #21253c,inset 0 0 0 2px #bcc2d6;color:#f2f4fa}' +
    '.cvad--plain{background:var(--cvp-bg,#1a1f2b);color:var(--cvp-fg,#eef1f8);box-shadow:inset 0 0 0 1px var(--cvp-edge,rgba(255,255,255,.12))}' +
    '.cvad--plain.cvad--day{background:var(--cvp-bg,#fff);color:var(--cvp-fg,#14213d);box-shadow:inset 0 0 0 1px var(--cvp-edge,rgba(0,0,0,.12))}' +
    '.cvad--vice{background:linear-gradient(180deg,rgba(255,255,255,.1),rgba(255,255,255,0) 40%),linear-gradient(180deg,#22105c,#0c0628);color:#fff6fd;box-shadow:inset 0 0 0 1px rgba(0,229,255,.8),0 0 0 2px #ff2bd6,0 0 16px rgba(255,43,214,.35)}' +
    '.cvad--vice.cvad--day{background:#fff;color:#0b1f4a;box-shadow:inset 0 0 0 1px rgba(255,46,147,.55),0 0 0 2px #18c4ff}' +
    '.cvad-layer{position:absolute;inset:0;display:flex;flex-direction:column;cursor:pointer;transition:opacity .3s ease}' +
    '.cvad-layer[aria-hidden="true"]{opacity:0;pointer-events:none}' +
    '.cvad-img{width:100%;height:100%;object-fit:cover;display:block}.cvad-fill{flex:1 1 0;min-height:0;height:auto}' +
    '.cvad-cap .cvad-label-in{display:inline-block;margin-right:5px;vertical-align:1px;font-size:10px}' +
    // side без image_side: подпись берёт свои 1–2 строки, картинка — остаток места (строка маркировки ничего не закрывает)
    '.cvad-split .cvad-img{height:auto;flex:1 1 0;min-height:0}.cvad-split .cvad-cap{flex:none;display:flex;align-items:center;min-height:min(50%,44px);padding:3px 12px;box-sizing:border-box;font-weight:800}' +
    '.cvad-capt{display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;line-height:1.25;-webkit-line-clamp:2}' +
    '.cvad-html{flex:1;display:flex;flex-direction:column;justify-content:center;gap:3px;padding:7px 12px;min-width:0;overflow:hidden}' +
    '.cvad-head{display:flex;align-items:center;gap:8px;min-width:0}' +
    '.cvad-html b.cvad-t{flex:1;min-width:0;font-size:15px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.cvad-txt{font-size:13px;line-height:17px;opacity:.92;overflow:hidden;display:-webkit-box;-webkit-line-clamp:var(--cvad-lines,2);-webkit-box-orient:vertical}' +
    '.cvad-cta-in{display:none;flex:none}.cvad--m .cvad-cta-in,.cvad--s .cvad-cta-in{display:inline-block}.cvad--m .cvad-cta-bl,.cvad--s .cvad-cta-bl{display:none}' +
    '.cvad--s .cvad-txt,.cvad--notxt .cvad-txt,.cvad--nocta .cvad-cta-in{display:none}.cvad--s b.cvad-t{font-size:13px}.cvad--s .cvad-html{padding:3px 10px}' +
    '.cvad-cta{align-self:flex-start;margin-top:2px;padding:4px 12px;border-radius:999px;font-weight:800;font-size:12.5px;background:rgba(255,255,255,.18)}' +
    '.cvad--vice .cvad-cta{background:linear-gradient(90deg,#ff2bd6,#ff7a1a);color:#12062e}' +
    '.cvad--ff7 .cvad-cta{background:#2f8cff;color:#fff}' +
    '.cvad--plain .cvad-cta{background:var(--cvp-accent,#2f8cff);color:var(--cvp-on-accent,#fff)}' +
    '.cvad-label{position:absolute;top:6px;right:8px;z-index:2;padding:1px 6px;border-radius:5px;font-size:10.5px;font-weight:700;background:rgba(0,0,0,.45);color:#fff;pointer-events:none}' +
    '.cvad-legal{position:absolute;left:0;right:0;bottom:0;z-index:2;padding:2px 8px;font-size:10px;line-height:1.3;color:#fff;background:rgba(0,0,0,.5);display:flex;white-space:nowrap;overflow:hidden;pointer-events:none}' +
    // строка маркировки: «Реклама» и «erid: …» не сжимаются (erid обязан быть виден), многоточием режется только
    // рекламодатель; не помещается и он — скрывается (fitLegal)
    '.cvad-legal span{flex:none}.cvad-legal .cvad-adv{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}.cvad-legal .cvad-adv.cvad-off{display:none}.cvad-legal.cvad-wrap{flex-wrap:wrap}' +
    // у HTML-баннеров метка «Реклама» стоит в строке заголовка, а строка рекламодателя — полосой под текстом,
    // чтобы ничего не закрывать; у картинок — поверх, как раньше
    '.cvad-label-in,.cvad-legal-in{position:static;flex:none}.cvad-label-in{align-self:center}' +
    '.cvad-line .cvad-cta,.cvad-head .cvad-cta{align-self:center;margin-top:0}' +
    '@media (prefers-reduced-motion:reduce){.cvad-layer{transition:none}}';
  function css() {
    if (doc.getElementById('cvad-css')) return;
    var s = doc.createElement('style'); s.id = 'cvad-css'; s.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(s);
  }
  function esc(s) { return String(s || '').replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  /** Разрешены только <b strong i em u s br small> без атрибутов; всё остальное — текстом. */
  function safeHtml(h) {
    return esc(h).replace(/&lt;(\/?)([a-z]+)\s*\/?&gt;/gi, function (m, sl, tag) { tag = tag.toLowerCase(); return ALLOWED.test(tag) ? '<' + sl + tag + '>' : m; });
  }
  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  /** Строка маркировки: «Реклама» · рекламодатель (сжимается) · «erid: …» (не сжимается). */
  function fillLegal(node, m) {
    node.textContent = '';
    node.setAttribute('aria-label', [m.label || 'Реклама', m.advertiser, m.erid ? 'erid: ' + m.erid : ''].filter(Boolean).join(' · '));
    node.appendChild(el('span', '', m.label || 'Реклама'));
    if (m.advertiser) node.appendChild(el('span', 'cvad-adv', '\u00a0· ' + m.advertiser));
    if (m.erid) node.appendChild(el('span', '', '\u00a0· erid: ' + m.erid));
    return node;
  }
  /** Рекламодатель обрезан до 32 px и меньше — не показывать совсем (останется «Реклама · erid: …»); не помещается
   *  и «Реклама · erid: …» — erid переносится на вторую строку (виден целиком). */
  function fitLegal(root) {
    var lgs = root.querySelectorAll('.cvad-legal');
    for (var i = 0; i < lgs.length; i++) {
      var lg = lgs[i], a = lg.querySelector('.cvad-adv'), last = lg.lastChild;
      lg.classList.remove('cvad-wrap');
      if (a) {
        a.classList.remove('cvad-off');
        if (a.offsetParent !== null && a.scrollWidth > a.clientWidth + 1 && a.clientWidth < 32) a.classList.add('cvad-off');
      }
      if (last && last.getBoundingClientRect().right > lg.getBoundingClientRect().right - 7.5) lg.classList.add('cvad-wrap');
    }
  }

  function plate(host, o) {
    o = o || {};
    css();
    var slot = o.slot, destroyed = false, timer = 0, impTimer = 0, visible = false, p = null, feed = null, cur = null;
    var box = el('div', 'cvad'), layers = [el('div', 'cvad-layer'), el('div', 'cvad-layer')], front = 0;
    layers.forEach(function (l) { l.setAttribute('aria-hidden', 'true'); box.appendChild(l); });
    var label = el('span', 'cvad-label');
    box.appendChild(label);
    host.hidden = true;
    if (o.replace !== false) host.innerHTML = '';
    host.appendChild(box);
    function line() { return o.line === 'vice' || o.line === 'cloud' ? o.line : (isVice() ? 'vice' : 'cloud'); }
    function img(rel) { var u = /^https?:/.test(rel) ? rel : (o.base || BASE) + rel; return o.asset ? o.asset(u) : u; }
    function paintBox() { box.className = 'cvad cvad--' + p.format + ' cvad--' + lookOf(o, line()) + (isDay() ? ' cvad--day' : ''); fit(); }
    var ro = G.ResizeObserver ? new G.ResizeObserver(function () { if (p) fit(); }) : null;
    if (ro) ro.observe(box);
    function render(a) {
      var l = layers[1 - front];
      l.innerHTML = '';
      l.className = 'cvad-layer';
      l.style.background = ''; l.style.color = '';
      var side = p.format === 'side', strip = p.format === 'strip';
      var m = a.mark || {}, inflow = a.kind === 'html', rowCap = false;
      // есть строка маркировки (рекламодатель или erid) — она уже начинается с «Реклама», отдельную метку не рисуем
      var hasLegal = !!(m.advertiser || m.erid), showLabel = !!m.label && !hasLegal;
      function labelIn(row) { if (showLabel) row.appendChild(el('span', 'cvad-label cvad-label-in', m.label)); }
      if (a.kind === 'html' && strip) {
        if (a.bg) l.style.background = a.bg;
        if (a.fg) l.style.color = a.fg;
        var ln = el('div', 'cvad-line');
        ln.appendChild(el('b', '', a.title || a.text || ''));
        if (a.cta) ln.appendChild(el('span', 'cvad-cta', a.cta));
        labelIn(ln);
        l.appendChild(ln);
      } else if (a.kind === 'image' && strip) {
        var si = el('img', 'cvad-img'); si.alt = a.title || ''; si.decoding = 'async'; si.referrerPolicy = 'no-referrer';
        if (a.image_strip) { si.src = img(a.image_strip); si.classList.add('cvad-fill'); l.appendChild(si); }
        else {
          // картинка слева на 2/3, справа подпись; метка «Реклама» — перед подписью, а не поверх неё
          var rw = el('div', 'cvad-rowin'), cap = el('div', 'cvad-cap');
          si.src = img(a.image); rw.appendChild(si);
          labelIn(cap); cap.appendChild(doc.createTextNode(a.title || ''));
          rw.appendChild(cap); l.appendChild(rw); rowCap = true;
        }
      } else if (a.kind === 'html') {
        if (a.bg) l.style.background = a.bg;
        if (a.fg) l.style.color = a.fg;
        // раскладка под высоту места (fit): высокое — заголовок, текст, кнопка снизу; среднее — кнопка в строке
        // заголовка, текст на оставшиеся строки; низкое — только заголовок (и кнопка, если хватает ширины)
        var hbox = el('div', 'cvad-html'), head = el('div', 'cvad-head');
        head.appendChild(el('b', 'cvad-t', a.title || a.text || ''));
        if (a.cta) head.appendChild(el('span', 'cvad-cta cvad-cta-in', a.cta));
        labelIn(head);
        hbox.appendChild(head);
        var tx = el('div', 'cvad-txt'); tx.innerHTML = safeHtml(a.html || esc(a.text)); hbox.appendChild(tx);
        if (a.cta) hbox.appendChild(el('span', 'cvad-cta cvad-cta-bl', a.cta));
        l.appendChild(hbox);
      } else {
        var im = el('img', 'cvad-img'); im.alt = a.title || ''; im.decoding = 'async'; im.referrerPolicy = 'no-referrer';
        if (side && a.image_side) im.src = img(a.image_side);
        else {
          im.src = img(a.image);
          if (side) {
            l.classList.add('cvad-split'); l.appendChild(im);
            var sc = el('div', 'cvad-cap'); sc.appendChild(el('span', 'cvad-capt', a.title || '')); l.appendChild(sc); im = null;
          }
        }
        if (im) { im.classList.add('cvad-fill'); l.appendChild(im); }
      }
      // строка маркировки — всегда отдельной полосой снизу: не закрывает ни текст, ни картинку
      if (hasLegal) l.appendChild(fillLegal(el('div', 'cvad-legal cvad-legal-in'), m));
      l.setAttribute('role', 'link');
      l.setAttribute('aria-label', a.title || a.text || '');
      l.tabIndex = 0;
      label.textContent = m.label || '';
      label.style.display = showLabel && !inflow && !rowCap ? '' : 'none';
      layers[front].setAttribute('aria-hidden', 'true');
      l.setAttribute('aria-hidden', 'false');
      front = 1 - front;
      cur = a;
      fit();
      armImpression();
    }
    /** Подогнать HTML-баннер под высоту и ширину места: ничего не обрезается посередине строки. */
    function fit() {
      var r = box.getBoundingClientRect(), h = r.height || (r.width / (p ? FMT[p.format][0] / FMT[p.format][1] : 4)), w = r.width;
      fitLegal(box);
      if (!h) return;
      // подпись к картинке в полосе (strip без image_strip): столько строк, сколько помещается над строкой маркировки
      var capBox = layers[front].querySelector('.cvad-rowin');
      if (capBox) box.style.setProperty('--cvad-cap-lines', String(Math.max(1, Math.floor(capBox.clientHeight / 17))));
      var lgIn = layers[front].querySelector('.cvad-legal-in');
      if (lgIn) h -= lgIn.offsetHeight || 17;
      // метка «Реклама» в строке заголовка занимает ~60 px — кнопке в строке нужно на столько же больше ширины
      var cm = (cur && cur.mark) || {}, labW = cm.label && !cm.advertiser && !cm.erid ? 60 : 0;
      var mode = h >= 96 ? 'l' : h >= 58 ? 'm' : 's';
      var hasCta = !!(cur && cur.cta), inline = mode !== 'l' && hasCta && w - labW >= 200;
      var head = inline ? 24 : 20, cta = mode === 'l' && hasCta ? 32 : 0;
      // 336×84 и 312×78: кнопка в строке заголовка + 2 строки текста; 186×93 (side): без кнопки, 3 строки
      var lines = Math.max(0, Math.floor((h - 14 - head - cta - 3) / 17));
      box.classList.remove('cvad--l', 'cvad--m', 'cvad--s', 'cvad--notxt', 'cvad--nocta');
      box.classList.add('cvad--' + mode);
      if (!lines) box.classList.add('cvad--notxt');
      if (w && w - labW < 200 && mode !== 'l') box.classList.add('cvad--nocta');
      box.style.setProperty('--cvad-lines', String(Math.max(1, lines)));
    }
    function armImpression() {
      clearTimeout(impTimer);
      if (!visible || doc.visibilityState === 'hidden' || !cur) return;
      var shown = cur;
      impTimer = setTimeout(function () { if (cur === shown && visible && doc.visibilityState !== 'hidden') count(feed.data.rev || 0, shown.id, slot, 1, 0); }, 1000);
    }
    function schedule() {
      clearTimeout(timer);
      if (!p || p.ads.length < 2 || !visible || doc.visibilityState === 'hidden') return;
      timer = setTimeout(function () { if (destroyed) return; render(pick(p, cur, slot)); schedule(); }, p.interval * 1000);
    }
    function click(e) {
      if (!cur) return;
      e.preventDefault();
      var u;
      var via = o.clickVia || 'auto';
      if (cur.click && (via === 'counter' || (via === 'auto' && feed.server))) u = cur.click + (cur.click.indexOf('?') < 0 ? '?' : '&') + 's=' + encodeURIComponent(slot);
      else { u = cur.url; count(feed.data.rev || 0, cur.id, slot, 0, 1); }
      if (!u) return;
      if (o.open) o.open(u); else G.open(u, '_blank', 'noopener');
    }
    layers.forEach(function (l) {
      l.addEventListener('click', click);
      l.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') click(e); });
    });
    var io = G.IntersectionObserver ? new G.IntersectionObserver(function (es) {
      var v = es[es.length - 1].intersectionRatio >= 0.5;
      if (v !== visible) { visible = v; armImpression(); schedule(); }
    }, { threshold: [0, 0.5, 1] }) : null;
    function onVis() { armImpression(); schedule(); }
    doc.addEventListener('visibilitychange', onVis);
    var mo = G.MutationObserver ? new G.MutationObserver(function () { if (p) paintBox(); }) : null;
    if (mo) mo.observe(doc.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    if (o.hit) hitUrl = o.hit;
    if (o.send) sender = o.send;
    if (o.sources && o.sources.length && !o.send) direct = false;
    load(o).then(function (f) {
      if (destroyed) return;
      feed = f;
      if (f.data.hit) hitUrl = o.hit || f.data.hit;
      p = plan(f.data, slot, line(), platformOf(o));
      if (!p) { host.hidden = true; return; }
      host.hidden = false;
      paintBox();
      render(pick(p, null, slot));
      if (io) io.observe(box); else { visible = true; armImpression(); schedule(); }
    }, function () { host.hidden = true; });
    return {
      el: box,
      destroy: function () {
        destroyed = true; clearTimeout(timer); clearTimeout(impTimer);
        if (io) io.disconnect(); if (mo) mo.disconnect(); if (ro) ro.disconnect();
        doc.removeEventListener('visibilitychange', onVis);
        if (box.parentNode) box.parentNode.removeChild(box);
        flush(true);
      }
    };
  }

  G.CvAds = { plate: plate, load: load, plan: plan, pick: pick, flush: flush, safeHtml: safeHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = G.CvAds;
})();
