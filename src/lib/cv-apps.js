/*!
 * Cloud VPN — плашка «Vice apps» / «Наши приложения» и окно со всеми нашими приложениями. Без зависимостей.
 *
 *   CvApps.plate(el, { line: 'auto'|'vice'|'cloud', platform: 'auto'|'android'|'windows'|'web',
 *                      current: ['vice-vpn', 'app'], inWebView: false, open: url => …, lang: 'ru'|'en' })
 *     — рисует плашку в el; по нажатию открывает окно со списком (иконка, имя, версия, «Скачать»).
 *   CvApps.open(opts)        — открыть окно сразу (без плашки).
 *   CvApps.load()            — Promise с downloads.json (сеть → запасной адрес → кэш на сутки).
 *   CvApps.list(data, opts)  — список продуктов для линии и платформы (для своих интерфейсов).
 *
 * Линия «vice»: Vice-версия продукта, если она выложена, иначе Cloud (пары — lines.vice в downloads.json; '' — пары
 * нет, только Vice); линия «cloud»: Cloud-продукты. Внизу окна — переход на другую линию.
 * Платформа: android — только APK, windows — exe/zip, web — всё. Текущее приложение (current) не показывается.
 * Ссылки — три источника, как в боте: GitHub, РУ Зеркало (бакет), наш сервер. На Android внутри WebView (inWebView: true)
 * ссылка идёт через https://cabinet.zjd.uk/app/get.html?u=…, чтобы APK скачался во внешнем браузере.
 * open(url) — как открыть ссылку (WebView2: системный браузер через свой мост); по умолчанию — новое окно.
 * sources: ['/api/apps/downloads.json'] — свои адреса downloads.json вместо наших (строгий CSP, своя сеть через прокси);
 * asset: (url) => url — через неё проходят все адреса картинок (например, '/api/apps/img?u=' + encodeURIComponent(url)).
 * Линия 'auto': класс vice / vice-night / vice-day (или data-theme="vice-…") на <html> → vice, иначе cloud.
 * Оформление (look: 'auto'|'vice'|'ff7'|'plain') — по теме хоста, а не по линии: темы Vice → Vice, ff7 («Классика RPG»)
 * → синее окно, обычные dark / light → нейтральное (переменные хоста --cvp-bg, --cvp-surface, --cvp-fg, --cvp-edge,
 * --cvp-accent, --cvp-on-accent; без них — простой тёмный или светлый). Нет классов темы на <html> — по линии, как было.
 */
(function () {
  'use strict';
  var G = typeof globalThis !== 'undefined' ? globalThis : window;
  if (G.CvApps) return;
  var doc = G.document;

  // Только наш сервер: у запасного адреса в бакете нет CORS, из браузера и WebView он не читается (запасной путь есть
  // в Kotlin-версии, CvAppsData.kt). Свои адреса — опцией sources. Без адресов бакета файл годится и для публичных репозиториев.
  var SOURCES = ['https://cabinet.zjd.uk/app/downloads.json'];
  var BASE = 'https://cabinet.zjd.uk/app/';
  var GET = 'https://cabinet.zjd.uk/app/get.html';
  var CACHE_KEY = 'cv_apps_downloads_v1';
  var DAY = 24 * 3600 * 1000;
  // порядок Cloud-продуктов (как на странице загрузок и в боте)
  var ORDER = ['app', 'windows', 'zapret', 'social', 'social-win', 'messenger', 'messenger-win', 'mail', 'mail-win',
    'wallet', 'love', 'addon', 'cloudbrowser', 'browser-android', 'chihua'];
  // запасные пары, если в downloads.json нет lines.vice
  var VICE_PAIRS = { 'vice-vpn': 'app', 'vice-vpn-win': 'windows', 'vice-zapret': 'zapret', 'vice-club': 'social',
    'vice-club-win': 'social-win', 'vice-messenger': 'messenger', 'vice-messenger-win': 'messenger-win', 'vice-mail': 'mail',
    'vice-mail-win': 'mail-win', 'vice-wallet': 'wallet', 'vice-addon': 'addon', 'vice-browser': 'cloudbrowser',
    'vice-browser-android': 'browser-android', miami: 'chihua', 'vice-wave': '', 'vice-wave-win': '', 'vice-love': 'love' };
  var ICON_CLOUD = { app: 'cloudvpn-icon.png', windows: 'cloudvpn-icon.png', zapret: 'zapret/icon.png', social: 'social/icon.png',
    'social-win': 'social/icon.png', messenger: 'messenger/icon.png', 'messenger-win': 'messenger/icon.png', mail: 'mail/icon.png',
    'mail-win': 'mail/icon.png', wallet: 'wallet/icon.png', addon: 'extension-icon.png', cloudbrowser: 'cloudbrowser/icon.png',
    'browser-android': 'cloudbrowser/icon.png', chihua: 'chihua/icon.png', love: 'love/icon.png' };
  var ICON_VICE = { 'vice-vpn': 'vice-vpn', 'vice-vpn-win': 'vice-vpn', 'vice-addon': 'vice-vpn', 'vice-zapret': 'vice-zapret',
    'vice-club': 'vice-club', 'vice-club-win': 'vice-club', 'vice-messenger': 'vice-messenger', 'vice-messenger-win': 'vice-messenger',
    'vice-mail': 'vice-mail', 'vice-mail-win': 'vice-mail', 'vice-wallet': 'vice-wallet', 'vice-browser': 'vice-browser',
    'vice-browser-android': 'vice-browser', miami: 'miami', 'vice-wave': 'vice-wave', 'vice-wave-win': 'vice-wave', 'vice-love': 'vice-love' };

  var T = {
    ru: { vice: 'Vice apps', cloud: 'Наши приложения', sub: 'Все наши приложения — скачать', title: 'Наши приложения',
      download: 'Скачать', close: 'Закрыть', toCloud: 'Оригинальные версии', toVice: 'Vice-версии', github: 'GitHub',
      bucket: 'РУ Зеркало', server: 'Наш сервер', empty: 'Для этого устройства пока ничего нет.', fail: 'Не удалось загрузить список. Проверьте связь.',
      loading: 'Загрузка…', hint: 'Если одна ссылка не открывается — попробуйте другую.' },
    en: { vice: 'Vice apps', cloud: 'Our apps', sub: 'All our apps — download', title: 'Our apps', download: 'Download',
      close: 'Close', toCloud: 'Original versions', toVice: 'Vice versions', github: 'GitHub', bucket: 'RU mirror',
      server: 'Our server', empty: 'Nothing for this device yet.', fail: 'Could not load the list. Check the connection.',
      loading: 'Loading…', hint: 'If one link does not open, try another.' }
  };

  function lang(o) {
    var l = (o && o.lang) || (G.navigator && G.navigator.language) || 'ru';
    return /^ru|^uk|^be|^kk/i.test(l) ? 'ru' : 'en';
  }
  function isViceTheme() {
    var r = doc && doc.documentElement;
    if (!r) return false;
    var th = r.getAttribute('data-theme') || '';
    return r.classList.contains('vice') || r.classList.contains('vice-night') || r.classList.contains('vice-day') || th.indexOf('vice') === 0;
  }
  function isDayTheme() {
    var r = doc && doc.documentElement;
    if (!r) return false;
    var th = r.getAttribute('data-theme') || '';
    return r.classList.contains('vice-day') || r.classList.contains('light') || th === 'light' || th === 'vice-day';
  }
  /** Vice — только при темах Vice, ff7 — только при «Классике RPG», обычные тёмная/светлая — нейтральное. */
  function lookOf(o, line) {
    if (o.look === 'vice' || o.look === 'ff7' || o.look === 'plain') return o.look;
    var r = doc && doc.documentElement;
    if (!r) return line === 'vice' ? 'vice' : 'ff7';
    var c = r.classList, th = r.getAttribute('data-theme') || '';
    if (c.contains('vice') || c.contains('vice-night') || c.contains('vice-day') || th.indexOf('vice') === 0) return 'vice';
    if (c.contains('ff7') || th === 'ff7') return 'ff7';
    if (c.contains('dark') || c.contains('light') || th === 'dark' || th === 'light') return 'plain';
    return line === 'vice' ? 'vice' : 'ff7';
  }
  function lookCls(o, line) { var k = lookOf(o, line); return 'cva--' + k + (k === 'plain' && isDayTheme() ? ' cva--day' : ''); }
  function lineOf(o) { return o.line === 'vice' || o.line === 'cloud' ? o.line : (isViceTheme() ? 'vice' : 'cloud'); }
  function platformOf(o) {
    if (o.platform && o.platform !== 'auto') return o.platform;
    var r = doc && doc.documentElement;
    if (r && r.classList.contains('native-app')) return 'android';
    if (G.__CVPN_EMBED || (G.chrome && G.chrome.webview)) return 'windows';
    return 'web';
  }

  // ── данные ──
  function readCache() {
    try { var c = JSON.parse(G.localStorage.getItem(CACHE_KEY) || 'null'); return c && c.data ? c : null; } catch (e) { return null; }
  }
  function writeCache(data) {
    try { G.localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), data: data })); } catch (e) { /* */ }
  }
  var inflight = null;
  function load(force, o) {
    var srcs = (o && o.sources && o.sources.length) ? o.sources : SOURCES;
    if (typeof force === 'object' && force) { srcs = force.sources && force.sources.length ? force.sources : SOURCES; force = !!force.force; }
    var c = readCache();
    if (!force && c && Date.now() - c.t < DAY) return Promise.resolve(c.data);
    if (inflight) return inflight;
    var i = 0;
    function next() {
      if (i >= srcs.length) return Promise.reject(new Error('no source'));
      var url = srcs[i++];
      var ctl = G.AbortController ? new G.AbortController() : null;
      var timer = ctl ? setTimeout(function () { ctl.abort(); }, 9000) : 0;
      // cvSilent: общая полоса загрузки (cv-loader.js) не дёргается из-за фонового запроса
      return G.fetch(url, { cache: 'no-store', signal: ctl ? ctl.signal : undefined, cvSilent: true })
        .then(function (r) { clearTimeout(timer); if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
        .then(function (d) { if (!d || !d.products) throw new Error('bad'); return d; })
        .catch(function () { clearTimeout(timer); return next(); });
    }
    inflight = next().then(function (d) { writeCache(d); inflight = null; return d; },
      function (e) { inflight = null; if (c) return c.data; throw e; });
    return inflight;
  }

  function published(p) { return p && p.files && p.files.length; }
  function fileFits(f, platform) {
    var n = (f.name || '').toLowerCase();
    if (platform === 'android') return /\.apk$/.test(n);
    if (platform === 'windows') return /\.(exe|zip|msi)$/.test(n);
    return true;
  }
  /** Продукты для линии и платформы: [{ key, title, version, files, icon }] */
  function list(data, o) {
    o = o || {};
    var prods = data.products || {}, line = lineOf(o), platform = platformOf(o);
    var pairs = (data.lines && data.lines.vice) || VICE_PAIRS;
    var cur = {}; [].concat(o.current || []).forEach(function (k) { cur[k] = 1; });
    var viceOf = {}, keys = [];
    for (var v in pairs) if (published(prods[v]) && pairs[v]) viceOf[pairs[v]] = v;
    var isVice = {}; for (var vv in pairs) isVice[vv] = 1;
    var cloudKeys = ORDER.slice();
    for (var k in prods) if (!isVice[k] && cloudKeys.indexOf(k) < 0) cloudKeys.push(k);
    cloudKeys.forEach(function (k) {
      if (line === 'vice' && viceOf[k]) keys.push(viceOf[k]);
      else if (published(prods[k])) keys.push(k);
    });
    if (line === 'vice') for (var only in pairs) if (!pairs[only] && published(prods[only])) keys.push(only);
    var out = [];
    keys.forEach(function (key) {
      if (cur[key] || cur[pairs[key]] || cur[viceOf[key]]) return;
      var p = prods[key], files = (p.files || []).filter(function (f) { return fileFits(f, platform); });
      if (!files.length) return;
      var vice = !!isVice[key];
      out.push({ key: key, title: String(p.title || key).replace(/^[^\wА-Яа-яЁё]+\s*/u, ''), emoji: (String(p.title || '').match(/^\S+/) || [''])[0],
        version: p.version || '', files: files, vice: vice,
        icon: asset(o, vice ? BASE + 'vice/' + (ICON_VICE[key] || key) + '-256.png' : BASE + (ICON_CLOUD[key] || 'cloudvpn-icon.png')) });
    });
    return out;
  }

  function asset(o, url) { return o && typeof o.asset === 'function' ? o.asset(url) : url; }

  function linkFor(url, name, o) {
    if (o.inWebView && /\.apk$/i.test(name || '')) return GET + '?u=' + encodeURIComponent(url) + '&n=' + encodeURIComponent(name || '');
    return url;
  }

  // ── стили ──
  var CSS = '' +
    '.cva-plate{display:flex;align-items:center;gap:12px;width:100%;box-sizing:border-box;padding:12px 14px;border-radius:16px;cursor:pointer;font:700 15px/1.25 var(--cva-font,inherit);text-align:left;border:0;color:inherit}' +
    '.cva-plate .cva-stack{display:flex;flex:none}.cva-plate .cva-stack img,.cva-plate .cva-stack i{width:34px;height:34px;border-radius:10px;margin-left:-10px;box-shadow:0 0 0 2px var(--cva-ring,#0b0626);object-fit:cover;background:#1b0b4a;display:grid;place-items:center;font-style:normal}' +
    '.cva-plate .cva-stack :first-child{margin-left:0}' +
    '.cva-plate b{display:block;font-size:17px}.cva-plate small{display:block;opacity:.8;font-weight:600;font-size:12.5px;margin-top:2px}.cva-plate .cva-go{margin-left:auto;font-size:22px;opacity:.9}' +
    '.cva--vice.cva-plate{color:#fff;background:linear-gradient(180deg,rgba(255,255,255,.14),rgba(255,255,255,0) 45%),linear-gradient(90deg,#2a0b6a,#4a0f7a 55%,#2a0b6a);box-shadow:inset 0 0 0 1px rgba(0,229,255,.85),0 0 0 2px #ff2bd6,0 0 18px rgba(255,43,214,.45),0 0 40px rgba(138,43,255,.3)}' +
    '.cva--vice.cva-plate b{font-family:var(--cva-display,inherit);letter-spacing:.02em;text-shadow:0 0 6px #ff2bd6,0 0 16px rgba(255,43,214,.7)}' +
    '.cva--ff7.cva-plate{color:#eef3ff;background:linear-gradient(180deg,#24409e,#14247a);box-shadow:0 0 0 1px #21253c,inset 0 0 0 2px #bcc2d6,0 6px 16px rgba(0,0,20,.35)}' +
    '.cva-plate:hover{filter:brightness(1.08)}.cva-plate:focus-visible{outline:3px solid #00e5ff;outline-offset:2px}' +
    '.cva-back{position:fixed;inset:0;z-index:2147483200;background:rgba(3,0,16,.62);display:flex;align-items:flex-end;justify-content:center;-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}' +
    '@media (min-width:640px){.cva-back{align-items:center}}' +
    '.cva-sheet{width:min(560px,100%);max-height:min(86vh,760px);display:flex;flex-direction:column;border-radius:20px 20px 0 0;overflow:hidden;font:600 15px/1.35 var(--cva-font,system-ui,-apple-system,Segoe UI,Roboto,sans-serif)}' +
    '@media (min-width:640px){.cva-sheet{border-radius:20px}}' +
    '.cva--vice.cva-sheet{color:#fff6fd;background:linear-gradient(180deg,rgba(255,255,255,.1),rgba(255,255,255,0) 18%),linear-gradient(180deg,#22105c,#0c0628);box-shadow:inset 0 0 0 1px rgba(0,229,255,.8),0 0 0 2px #ff2bd6,0 0 30px rgba(255,43,214,.45)}' +
    '.cva--ff7.cva-sheet{color:#eef3ff;background:linear-gradient(180deg,#1b2f86,#0b1550);box-shadow:inset 0 0 0 3px #bcc2d6,0 0 0 1px #21253c}' +
    '.cva-head{display:flex;align-items:center;gap:10px;padding:16px 16px 10px}.cva-head h2{margin:0;font-size:20px;flex:1}' +
    '.cva--vice .cva-head h2{font-family:var(--cva-display,inherit);text-shadow:0 0 8px #ff2bd6,0 0 22px rgba(255,43,214,.6)}' +
    '.cva-x{border:0;background:rgba(255,255,255,.12);color:inherit;width:36px;height:36px;border-radius:50%;font-size:20px;cursor:pointer}' +
    '.cva-body{overflow:auto;padding:4px 12px 8px}.cva-item{display:grid;grid-template-columns:52px 1fr auto;gap:12px;align-items:center;padding:10px 6px;border-bottom:1px solid rgba(255,255,255,.1)}' +
    '.cva-item img,.cva-item .cva-emo{width:52px;height:52px;border-radius:14px;object-fit:cover;background:rgba(255,255,255,.08);display:grid;place-items:center;font-size:26px}' +
    '.cva-name{font-weight:800}.cva-ver{opacity:.7;font-size:12.5px}' +
    '.cva-dl{border:0;border-radius:999px;padding:9px 16px;font:800 14px/1 inherit;cursor:pointer;white-space:nowrap}' +
    '.cva--vice .cva-dl{color:#12062e;background:linear-gradient(180deg,rgba(255,255,255,.42),rgba(255,255,255,0) 50%),linear-gradient(90deg,#ff2bd6,#ff7a1a);box-shadow:0 0 12px rgba(255,43,214,.55)}' +
    '.cva--ff7 .cva-dl{color:#fff;background:#2f8cff}' +
    // нейтральное оформление (обычные тёмная/светлая темы хоста)
    '.cva--plain.cva-plate{color:var(--cvp-fg,#eef1f8);background:var(--cvp-bg,#1a1f2b);box-shadow:inset 0 0 0 1px var(--cvp-edge,rgba(255,255,255,.12))}' +
    '.cva--plain.cva-sheet{color:var(--cvp-fg,#eef1f8);background:var(--cvp-surface,#141924);box-shadow:inset 0 0 0 1px var(--cvp-edge,rgba(255,255,255,.12))}' +
    '.cva--plain.cva--day.cva-plate{color:var(--cvp-fg,#14213d);background:var(--cvp-bg,#fff);box-shadow:inset 0 0 0 1px var(--cvp-edge,rgba(0,0,0,.12))}' +
    '.cva--plain.cva--day.cva-sheet{color:var(--cvp-fg,#14213d);background:var(--cvp-surface,#fff);box-shadow:inset 0 0 0 1px var(--cvp-edge,rgba(0,0,0,.12))}' +
    '.cva--plain .cva-dl{color:var(--cvp-on-accent,#fff);background:var(--cvp-accent,#2f8cff)}.cva--plain.cva-plate .cva-stack img{background:transparent;box-shadow:none}' +
    '.cva--plain .cva-switch{color:var(--cvp-accent,#2f8cff)}' +
    '.cva--plain.cva--day .cva-item{border-bottom-color:rgba(0,0,0,.1)}.cva--plain.cva--day .cva-x{background:rgba(0,0,0,.07)}' +
    '.cva--plain.cva--day .cva-item img,.cva--plain.cva--day .cva-item .cva-emo{background:rgba(0,0,0,.05)}' +
    '.cva--plain.cva--day .cva-src a{background:rgba(0,0,0,.04);box-shadow:inset 0 0 0 1px rgba(0,0,0,.15)}.cva--plain.cva--day .cva-src a:hover{background:rgba(0,0,0,.08)}' +
    '.cva-files{grid-column:1/-1;display:none;padding:2px 0 8px}.cva-item.is-open .cva-files{display:block}' +
    '.cva-file{margin:6px 0 2px;font-size:13px;opacity:.85}.cva-src{display:flex;flex-wrap:wrap;gap:6px}' +
    '.cva-src a{flex:1 1 30%;min-width:96px;text-align:center;padding:9px 10px;border-radius:10px;text-decoration:none;font-weight:800;font-size:13.5px;color:inherit;background:rgba(255,255,255,.1);box-shadow:inset 0 0 0 1px rgba(255,255,255,.22)}' +
    '.cva--vice .cva-src a{box-shadow:inset 0 0 0 1px rgba(0,229,255,.6)}.cva-src a:hover{background:rgba(255,255,255,.18)}' +
    '.cva-foot{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 16px calc(14px + env(safe-area-inset-bottom,0px));font-size:13px;opacity:.95}' +
    '.cva-switch{border:0;background:none;color:inherit;font:800 14px/1 inherit;text-decoration:underline;cursor:pointer;padding:6px 0}' +
    '.cva--vice .cva-switch{color:#6ff2ff}.cva-note{opacity:.75;padding:20px 8px;text-align:center}' +
    '@media (prefers-reduced-motion:no-preference){.cva-sheet{animation:cva-in .22s ease-out}}@keyframes cva-in{from{transform:translateY(24px);opacity:0}}';
  function injectCss() {
    if (!doc || doc.getElementById('cva-css')) return;
    var s = doc.createElement('style');
    s.id = 'cva-css';
    s.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(s);
  }
  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function iconNode(it) {
    var img = el('img');
    img.alt = '';
    img.loading = 'lazy';
    img.src = it.icon;
    img.onerror = function () { var f = el('span', 'cva-emo', it.emoji || '•'); if (img.parentNode) img.parentNode.replaceChild(f, img); };
    return img;
  }

  // ── окно ──
  var openSheet = null;
  function open(o) {
    o = o || {};
    injectCss();
    if (openSheet) openSheet.close();
    var t = T[lang(o)], line = lineOf(o);
    var back = el('div', 'cva-back'), sheet = el('div', 'cva-sheet ' + lookCls(o, line));
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    var head = el('div', 'cva-head'), h = el('h2', '', line === 'vice' ? t.vice : t.title), x = el('button', 'cva-x', '×');
    x.setAttribute('aria-label', t.close);
    head.appendChild(h);
    head.appendChild(x);
    var body = el('div', 'cva-body'), foot = el('div', 'cva-foot'), sw = el('button', 'cva-switch', line === 'vice' ? t.toCloud : t.toVice);
    foot.appendChild(el('span', '', t.hint));
    foot.appendChild(sw);
    sheet.appendChild(head);
    sheet.appendChild(body);
    sheet.appendChild(foot);
    back.appendChild(sheet);
    doc.body.appendChild(back);
    var prevFocus = doc.activeElement;
    function close() {
      if (back.parentNode) back.parentNode.removeChild(back);
      doc.removeEventListener('keydown', onKey);
      openSheet = null;
      if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) { /* */ }
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    doc.addEventListener('keydown', onKey);
    back.addEventListener('click', function (e) { if (e.target === back) close(); });
    x.onclick = close;
    sw.onclick = function () { var o2 = {}; for (var k in o) o2[k] = o[k]; o2.line = line === 'vice' ? 'cloud' : 'vice'; open(o2); };
    function go(url) {
      if (o.open) o.open(url);
      else G.open(url, '_blank', 'noopener');
    }
    function render(data) {
      body.innerHTML = '';
      var items = list(data, { line: line, platform: o.platform, current: o.current, asset: o.asset });
      if (!items.length) { body.appendChild(el('div', 'cva-note', t.empty)); return; }
      items.forEach(function (it) {
        var row = el('div', 'cva-item'), mid = el('div'), btn = el('button', 'cva-dl', t.download);
        row.appendChild(iconNode(it));
        mid.appendChild(el('div', 'cva-name', it.title));
        mid.appendChild(el('div', 'cva-ver', it.version));
        row.appendChild(mid);
        row.appendChild(btn);
        var files = el('div', 'cva-files');
        it.files.forEach(function (f) {
          if (it.files.length > 1) files.appendChild(el('div', 'cva-file', f.label || f.name));
          var src = el('div', 'cva-src');
          [['github', t.github], ['bucket', t.bucket], ['server', t.server]].forEach(function (s) {
            if (!f[s[0]]) return;
            var a = el('a', '', s[1]);
            a.href = linkFor(f[s[0]], f.name, o);
            a.target = '_blank';
            a.rel = 'noopener';
            a.onclick = function (e) { e.preventDefault(); go(a.href); };
            src.appendChild(a);
          });
          files.appendChild(src);
        });
        row.appendChild(files);
        btn.onclick = function () { row.classList.toggle('is-open'); };
        body.appendChild(row);
      });
    }
    body.appendChild(el('div', 'cva-note', t.loading));
    load(false, o).then(render, function () { body.innerHTML = ''; body.appendChild(el('div', 'cva-note', t.fail)); });
    setTimeout(function () { try { x.focus(); } catch (e) { /* */ } }, 30);
    openSheet = { close: close };
    return openSheet;
  }

  // ── плашка ──
  function plate(host, o) {
    o = o || {};
    injectCss();
    var t = T[lang(o)];
    var b = el('button', 'cva-plate');
    b.type = 'button';
    function paint() {
      var line = lineOf(o);
      b.className = 'cva-plate ' + lookCls(o, line);
      b.innerHTML = '';
      var st = el('span', 'cva-stack');
      var icons = line === 'vice' ? ['miami', 'vice-vpn', 'vice-wallet'].map(function (k) { return BASE + 'vice/' + k + '-64.png'; })
        : ['cloudvpn-icon-64.png', 'messenger/icon.png', 'wallet/icon.png'].map(function (k) { return BASE + k; });
      icons.forEach(function (u) { var i = el('img'); i.alt = ''; i.src = asset(o, u); i.onerror = function () { i.style.visibility = 'hidden'; }; st.appendChild(i); });
      var txt = el('span');
      txt.appendChild(el('b', '', line === 'vice' ? t.vice : t.cloud));
      txt.appendChild(el('small', '', t.sub));
      b.appendChild(st);
      b.appendChild(txt);
      b.appendChild(el('span', 'cva-go', '›'));
    }
    paint();
    b.onclick = function () { open(o); };
    if (o.replace !== false) host.innerHTML = '';
    host.appendChild(b);
    // тема сменилась — плашка перекрашивается (линия или оформление 'auto')
    var mo = null;
    if ((!o.line || o.line === 'auto' || !o.look || o.look === 'auto') && G.MutationObserver) {
      mo = new G.MutationObserver(paint);
      mo.observe(doc.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    }
    load(false, o).catch(function () { /* прогрев кэша */ });
    return { el: b, repaint: paint, destroy: function () { if (mo) mo.disconnect(); if (b.parentNode) b.parentNode.removeChild(b); } };
  }

  G.CvApps = { plate: plate, open: open, load: load, list: list, linkFor: linkFor, _pairs: VICE_PAIRS, _order: ORDER };
  if (typeof module !== 'undefined' && module.exports) module.exports = G.CvApps;
})();
