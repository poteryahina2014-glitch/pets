// Журнал ошибок на этом устройстве (решение Юли 24.11.2026): что сломалось — видно в «?» → «Ошибки: N» → «Скопировать».
// ОДИН И ТОТ ЖЕ файл в пяти приложениях: Задачи, Корзинка, Где что лежит, Питомцы, Таверна. Правишь — скопировать
// во все пять (проверка перед коммитом не пропустит разошедшиеся копии). Грузится самым первым скриптом.
// Сам ловит: необработанные сбои, console.error, отказы базы и пропавшую связь (через fetch), незагрузившиеся файлы.
// Не записывает: адреса с параметрами, тела запросов, заголовки (там ключи), значения из сообщений, почту, ключи.
(function () {
  const MAX = 30, DAYS = 30, LEN = 300, DAY = 864e5;
  const app = location.pathname.split('/').filter(x => x && !/\.html?$/i.test(x)).pop() || 'local';
  const KEY = 'errlog:' + app;
  const rawError = console.error;
  const rawFetch = window.fetch;

  // ---------- что пишем: без личного ----------
  function clean(s, hideQuoted) {
    s = String(s == null ? '' : s).slice(0, 2000).replace(/\s+/g, ' ');
    s = s.replace(/\b(?:https?|wss?|blob|file):\/*[^\s"'<>]+/gi, u => { try { return new URL(u).hostname || '‹адрес›'; } catch (e) { return '‹адрес›'; } });
    s = s.replace(/\bdata:[\w/+.-]+[;,]\S*/gi, '‹данные›');
    s = s.replace(/[^\s"'<>()=]+@[^\s"'<>()]+\.[^\s"'<>()]+/g, '‹почта›');
    s = s.replace(/eyJ[\w-]{5,}(\.[\w-]*){0,2}/g, '‹ключ›').replace(/\b(sb|sk|ghp|pk)[_-][\w-]{8,}/gi, '‹ключ›').replace(/\b(Bearer|apikey|password|token\s*[:=])\s*[:=]?\s*\S+/gi, '$1 ‹ключ›').replace(/(парол[а-я]*)\s*[:=]?\s*\S+/gi, '$1 ‹…›');
    s = s.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '‹id›').replace(/[\w+/=-]{40,}/g, '‹…›').replace(/\d[\d\s().-]{6,}\d/g, '‹число›');
    if (hideQuoted) s = s.replace(/"[^"]*"|'[^']*'|“[^”]*”|«[^»]*»/g, '«…»').replace(/["'“«].*$/, '«…');
    else s = s.replace(/"[^"]*[а-яёіїєґ][^"]*"|'[^']*[а-яёіїєґ][^']*'|“[^”]*[а-яёіїєґ][^”]*”|«[^»]*[а-яёіїєґ][^»]*»/gi, '«…»');
    return s.trim().slice(0, LEN);
  }
  // Место в программе: файл:строка:столбец, не больше трёх
  function place(stack) {
    return [...String(stack || '').matchAll(/([\w-]+\.(?:js|html))(?:\?[^:\s)]*)?:(\d+):(\d+)/g)]
      .filter(m => m[1] !== 'errlog.js').slice(0, 3).map(m => `${m[1]}:${m[2]}:${m[3]}`).join(' ← ');
  }
  function textOf(e, where) {
    const name = e && e.name, msg = e && e.message != null ? e.message : typeof e === 'string' ? e : '';
    const t = clean((name && !String(msg).startsWith(name) ? name + ': ' : '') + msg, name === 'SyntaxError') || 'без описания';
    return [t, place(e && e.stack) || where || ''].filter(Boolean).join(' · ').slice(0, LEN);
  }
  // Не поломка или уже записано через fetch
  function skip(e) {
    if (!e) return false;
    const m = String(e.message || e);
    return e.name === 'AbortError' || /ResizeObserver loop|failed to fetch|networkerror when|load failed|network request failed/i.test(m)
      || (typeof e === 'object' && (('details' in e && 'code' in e) || e.__isAuthError || /^Functions\w*Error$/.test(e.name || '')))
      || /chrome-extension:|moz-extension:/.test(e.stack || '');
  }

  // ---------- хранение ----------
  let mem = [], pending = [], timer = 0, lastSave = 0, broken = false;
  // Повторы складываются: то же самое — счётчик; «нет связи» — одной строкой, новый раз — если тишина дольше минуты.
  function apply(list, ev, now) {
    const same = x => x.k === ev.k && (ev.k === 'net' || ev.k === 'netw' || x.t === ev.t);
    const old = list.find(same), rest = list.filter(x => !same(x));
    const one = { k: ev.k, t: ev.t, at: ev.at, n: 1, v: ev.v };
    if (old) {
      one.n = (old.n || 1) + (ev.k[0] === 'n' && ev.at - old.at < 60000 ? 0 : 1);
      one.from = old.from || old.at;
    }
    return [one, ...rest].filter(x => now - x.at < DAYS * DAY).slice(0, MAX);
  }
  function read() {
    if (broken) return mem;
    try {
      const a = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(a) ? a.filter(x => x && typeof x.t === 'string' && typeof x.k === 'string' && x.at > 0) : [];
    } catch (e) {
      if (!(e instanceof SyntaxError)) broken = true; // памяти нет — журнал живёт, пока открыта страница
      return mem;
    }
  }
  function list() { const now = Date.now(); return pending.reduce((l, ev) => apply(l, ev, now), read()).filter(x => now - x.at < DAYS * DAY); }
  function save() {
    clearTimeout(timer); timer = 0;
    if (!pending.length) return;
    mem = list(); pending = []; lastSave = Date.now();
    try { if (!broken) localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { broken = true; }
  }
  function add(k, t) {
    try {
      pending.push({ k, t: String(t).slice(0, LEN), at: Date.now(), v: window.APP_VERSION || '' });
      if (pending.length > 50) pending.shift();
      if (Date.now() - lastSave > 1000) save(); else if (!timer) timer = setTimeout(save, 1000);
    } catch (e) { /* журнал не должен ломать приложение */ }
  }
  addEventListener('pagehide', save);

  // ---------- откуда берём ----------
  let fatal = false;
  addEventListener('error', ev => {
    try {
      const el = ev.target;
      if (el && el !== window && el.tagName) { // файл не загрузился; картинки не пишем
        if (el.tagName !== 'SCRIPT' && el.tagName !== 'LINK') return;
        const u = new URL(el.src || el.href, location.href);
        if (el.tagName === 'SCRIPT') fatal = true;
        return add('file', u.origin === location.origin ? u.pathname.split('/').pop() : u.hostname);
      }
      if (!ev.filename || /extension:/.test(ev.filename) || skip(ev.error)) return;
      fatal = true;
      add('js', textOf(ev.error || ev.message, place(`${ev.filename}:${ev.lineno}:${ev.colno}`)));
    } catch (e) { /* см. add */ }
  }, true);
  addEventListener('unhandledrejection', ev => {
    try { if (skip(ev.reason)) return; fatal = true; add('js', textOf(ev.reason)); } catch (e) { /* см. add */ }
  });
  console.error = function (...a) {
    try { const e = a.find(x => x instanceof Error) || a[0]; if (e && !skip(e)) add('js', textOf(e)); } catch (e) { /* см. add */ }
    return rawError.apply(console, a);
  };
  function target(url) {
    const p = url.pathname, m = p.match(/\/(rest|auth|functions|storage)\/v1\/(.*)$/);
    if (!m) return { kind: 'file', name: url.origin === location.origin ? p.split('/').pop() || app : url.hostname };
    return { kind: { rest: 'db', auth: 'auth', functions: 'fn', storage: 'db' }[m[1]], name: clean(m[1] === 'storage' ? 'storage' : m[2].split('/').slice(0, 2).join('/')) };
  }
  if (rawFetch) window.fetch = function (input, init) {
    const p = rawFetch.apply(window, arguments);
    try {
      const to = target(new URL(input && input.url || input, location.href));
      const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      p.then(r => {
        if (r.ok) return;
        const done = b => {
          b = b && typeof b === 'object' ? b : {};
          const code = String(b.code || b.error_code || b.error || '');
          if (to.kind === 'auth' && /invalid_credentials|invalid_grant/.test(code + (b.error_code || ''))) return; // неверный пароль — не поломка
          const msg = clean(b.message || b.msg || '', /^(22|P0)/.test(code));
          add(to.kind, [`${method} ${to.name}`, r.status, [clean(code, true), msg].filter(Boolean).join(' ')].filter(Boolean).join(' · '));
        };
        if (to.kind === 'file') return add('file', `${to.name} · ${r.status}`);
        r.clone().json().then(done, () => done(null)).catch(() => { });
      }, e => {
        if (e && e.name === 'AbortError') return;
        const write = to.kind === 'fn' || (to.kind === 'db' && method !== 'GET' && method !== 'HEAD');
        add(write ? 'netw' : 'net', `${method} ${to.name} · ${clean(e && e.message)}`);
      }).catch(() => { });
    } catch (e) { /* см. add */ }
    return p;
  };

  // ---------- показ ----------
  const TITLES = { js: 'Сбой в программе', db: 'База отказала', auth: 'Вход: ошибка', fn: 'Сервер отказал', file: 'Не загрузился файл', net: 'Нет связи', netw: 'Нет связи, не записалось' };
  const TABLES = {
    tasks: 'задачи', task_log: 'отметки', sections: 'разделы', memos: 'памятки', memo_log: 'памятки', 'rpc/memo_done': 'памятки', reads: 'чтение', read_folders: 'чтение',
    payments: 'платежи', prefs: 'уведомления', push_subs: 'уведомления', claude_limit: 'лимит Claude', 'rpc/complete_task': 'отметка', 'rpc/miss_task': 'отметка', 'rpc/undo_last': 'отметка',
    k_items: 'товары', k_groups: 'группы', k_stores: 'магазины', w_places: 'места', w_items: 'вещи', w_rules: 'правила',
    p_pets: 'профиль', p_weights: 'вес', p_periods: 'что используем', p_blocks: 'что используем', p_pics: 'картинки', p_visits: 'ветклиника', p_notes: 'заметки', p_meds: 'лекарства', p_schemes: 'схемы', p_runs: 'схемы', p_steps: 'схемы',
    t_cards: 'карточки', t_texts: 'тексты', t_lessons: 'уроки', t_log: 'оценки', t_books: 'книги', t_chapters: 'главы',
  };
  function title(x) {
    const tab = x.k === 'db' || x.k === 'netw' ? TABLES[(x.t.split(' ')[1] || '')] : '';
    return (TITLES[x.k] || 'Ошибка') + (tab ? ': ' + tab : '');
  }
  const p2 = n => String(n).padStart(2, '0');
  function when(ms) {
    const d = new Date(ms), t = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
    return (d.toDateString() === new Date().toDateString() ? 'сегодня' : `${p2(d.getDate())}.${p2(d.getMonth() + 1)}`) + ' ' + t;
  }
  function day(ms) { const d = new Date(ms); return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`; }
  function report() {
    const ua = navigator.userAgent, os = (ua.match(/Android[ \d.]*|iPhone|iPad|Windows|Mac OS|Linux/) || ['?'])[0].trim(), br = (ua.match(/(Edg|OPR|Firefox|Chrome|Version)\/\d+/) || ['?'])[0];
    return [`Журнал ошибок · ${document.title} · версия ${window.APP_VERSION || '?'}`, `${day(Date.now())} · ${os} · ${br} · экран ${innerWidth}×${innerHeight}`, '',
      ...list().map((x, i) => `${i + 1}. ${day(x.at)}${x.n > 1 ? ` ×${x.n}, с ${day(x.from || x.at)}` : ''} · ${title(x)} · ${x.t}${x.v ? ` · в. ${x.v}` : ''}`)].join('\n');
  }
  async function copy() {
    const s = report();
    try { await navigator.clipboard.writeText(s); return true; } catch (e) { /* ниже — старый способ */ }
    const t = document.createElement('textarea');
    t.value = s; t.style.cssText = 'position:fixed;left:0;top:0;opacity:0';
    document.body.appendChild(t); t.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { /* скажем «Не вышло» */ }
    t.remove();
    return ok;
  }
  async function copyBtn(b) {
    const ok = await copy(), was = 'Скопировать';
    b.textContent = ok ? 'Скопировано' : 'Не вышло';
    setTimeout(() => { b.textContent = was; }, 1500);
  }
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  function css() {
    if (document.getElementById('errlogCss')) return;
    const s = mk('style'); s.id = 'errlogCss';
    s.textContent = `.ver:has(+[data-errlog]){flex:1 1 0;min-width:86px}
.errlog{flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:8px}
.errlog .it{flex:none;background:var(--card,var(--surface-2));border:1px solid var(--border,var(--line));border-radius:12px;padding:9px 12px}
.errlog .a{display:flex;gap:8px;align-items:baseline}.errlog b{flex:1;font-weight:600}
.errlog time{color:var(--muted);font-size:12.5px;white-space:nowrap}.errlog .n{color:var(--warn,var(--need));font-size:13px;white-space:nowrap}
.errlog code{display:block;margin-top:2px;font:12px/1.4 Consolas,ui-monospace,monospace;color:var(--muted);overflow-wrap:anywhere}
.errlog .none{color:var(--muted);text-align:center;margin-top:60px}
.errfoot{justify-content:space-between!important;flex:none}.errfoot .cp{min-width:132px;justify-content:center;text-align:center}
.errbar{position:fixed;z-index:9999;left:10px;right:10px;bottom:calc(14px + env(safe-area-inset-bottom,0px));max-width:520px;margin:0 auto;display:flex;gap:10px;align-items:center;padding:12px;border-radius:14px;border:1px solid var(--bad,var(--danger,#c0392b));background:var(--top,var(--surface,#fff));color:var(--text,var(--ink,#222))}.errbar span{flex:1}.errbar .cp{min-width:122px;justify-content:center;text-align:center}`;
    document.head.appendChild(s);
  }
  // Журнал встаёт в то же окно справки (размер не меняется), «← Справка» возвращает её как была.
  function show(btn) {
    const box = btn.closest('.sheet,.modal'); if (!box) return;
    css();
    const was = [...box.childNodes], foot = mk('div', btn.parentElement.className + ' errfoot'), body = mk('div', 'errlog help'), items = list();
    for (const x of items) {
      const it = mk('div', 'it'), a = mk('div', 'a');
      a.append(mk('b', '', title(x)));
      if (x.n > 1) a.append(mk('span', 'n', '×' + x.n));
      a.append(mk('time', '', when(x.at)));
      it.append(a, mk('code', '', x.t));
      body.append(it);
    }
    if (!items.length) body.append(mk('div', 'none', 'Ошибок нет'));
    const back = mk('button', 'btn', '← Справка'), cp = mk('button', 'btn main pri cp', 'Скопировать');
    back.type = cp.type = 'button'; cp.disabled = !items.length;
    const scroll = box.querySelector('.help-list,.help'), at = [box.scrollTop, scroll ? scroll.scrollTop : 0];
    back.onclick = () => { box.replaceChildren(...was); box.scrollTop = at[0]; if (scroll) scroll.scrollTop = at[1]; };
    cp.onclick = () => copyBtn(cp);
    foot.append(back, cp);
    box.replaceChildren(mk(box.querySelector('h3') ? 'h3' : 'h2', '', 'Журнал ошибок'), body, foot);
    box.scrollTop = 0;
  }
  document.addEventListener('click', ev => { const b = ev.target.closest && ev.target.closest('[data-errlog]'); if (b) show(b); });

  // Программа не запустилась (экран пустой, до справки не добраться) — полоска с «Скопировать».
  function blank() {
    const a = document.getElementById('app'), m = document.getElementById('main');
    return a ? !a.childElementCount : m ? !m.childElementCount || /^\s*Загружаю…/.test(m.textContent) : false;
  }
  function checkStart() {
    if (!fatal || !blank() || document.querySelector('.errbar')) return;
    css();
    const bar = mk('div', 'errbar'), cp = mk('button', 'btn cp', 'Скопировать'), re = mk('button', 'btn main pri', 'Обновить');
    bar.setAttribute('role', 'alert');
    cp.onclick = () => copyBtn(cp); re.onclick = () => location.reload();
    bar.append(mk('span', '', 'Программа не запустилась'), cp, re);
    document.body.appendChild(bar);
    const t = setInterval(() => { if (!blank()) { bar.remove(); clearInterval(t); } }, 1000);
  }
  addEventListener('load', () => [4000, 15000].forEach(ms => setTimeout(checkStart, ms)));

  window.ERRLOG = { list, add, save, report, clean, apply, checkStart, KEY, button: () => { css(); return `<button type="button" class="btn" data-errlog>Ошибки: ${list().length}</button>`; } };
})();
