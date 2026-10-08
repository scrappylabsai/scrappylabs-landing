/* scrappylabs.ai — the terminal.
 *
 * Progressive enhancement over a plain HTML transcript: every "file" (services,
 * contact, blog…) is real markup in #files, so the page reads fine without JS,
 * and crawlers and screen readers get all of it. This script hides #files and
 * prints a copy of a file when its command runs.
 *
 * Anything that isn't a command and reads like a question goes to Scrappy, the
 * AI rep, through the same-origin /scrappy/ proxy (functions/scrappy/[[path]].js).
 * When the rep is closed or unreachable, the terminal prints that in the page and
 * gives the phone and email. It never fails silently.
 *
 * No innerHTML anywhere: output is built from cloned nodes and textContent.
 */
(() => {
  'use strict';
  const root = document.documentElement;
  root.classList.add('js');
  window.__term = true;

  const $ = (s, r = document) => r.querySelector(s);
  const out = $('#out'), files = $('#files'), form = $('#cli'), input = $('#cmd');
  const mirror = $('.mirror'), dock = $('.dock'), motd = $('.motd'), bootEl = $('#boot');
  if (!out || !form || !input) return;

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(pointer: fine)').matches;
  const PS1 = 'guest@scrappylabs:~$';
  const PHONE = '(336) 296-9877', TEL = 'tel:+13362969877', MAIL = 'brian@scrappylabs.ai';
  const FILES = ['services', 'contact', 'about', 'blog', 'demos', 'github', 'ask'];
  const GHOSTS = ['services', 'can you answer my phones after hours?', 'blog', 'demos',
                  'what would an AI receptionist cost me?', 'contact', 'help'];

  const ss = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } },
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null) continue;
      n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return n;
  }
  const cmdLink = (cmd, label) => el('a', { href: '#' + cmd, 'data-cmd': cmd, text: label || cmd });
  const telLink = () => el('a', { href: TEL, 'data-dial': true, text: PHONE });
  const mailLink = () => el('a', { href: 'mailto:' + MAIL, text: MAIL });

  // ── output ───────────────────────────────────────────────────────────────
  function block(cmdText) {
    const b = el('div', { class: 'block' });
    b.append(el('h2', { class: 'echo' },
      el('span', { class: 'ps1', 'aria-hidden': 'true', text: PS1 }), cmdText));
    out.append(b);
    return b;
  }
  function line(b, kids, cls) {
    const p = el('p', { class: cls || null }, kids);
    b.append(p);
    return p;
  }
  function reachHuman(b) {
    line(b, ['Reach a human: ', telLink(), ' · ', mailLink()]);
  }
  function settle(b) {
    const smooth = reduce ? 'auto' : 'smooth';
    const tall = b && b.getBoundingClientRect().height + dock.offsetHeight + 96 > innerHeight;
    (tall ? b : dock).scrollIntoView({ block: tall ? 'start' : 'end', behavior: smooth });
  }

  let lastList = [];
  function showFile(b, id) {
    const src = document.getElementById(id);
    if (!src) return;
    for (const ch of src.children) if (!ch.matches('h2')) b.append(ch.cloneNode(true));
    lastList = [...b.querySelectorAll('.ls:not(.live) li > a')];
    if (location.pathname + location.hash !== '/#' + id) history.replaceState(null, '', '/#' + id);
  }

  // Scrappy's replies arrive as light markdown; the terminal shows plain text
  // with real links for URLs, email and the phone number.
  function clean(t) {
    return String(t)
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1 ($2)')
      .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1')
      .replace(/`([^`]+)`/g, '$1').replace(/^#{1,6}\s+/gm, '')
      .trim();
  }
  function linkify(t) {
    const frag = document.createDocumentFragment();
    const re = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|([\w.+-]+@[\w-]+\.[\w.-]*\w)|(\(?336\)?[\s.-]?296[\s.-]?9877)/g;
    let i = 0, m;
    while ((m = re.exec(t))) {
      frag.append(t.slice(i, m.index));
      if (m[1]) frag.append(el('a', { href: m[1], target: '_blank', rel: 'noopener', text: m[1] }));
      else if (m[2]) frag.append(el('a', { href: 'mailto:' + m[2], text: m[2] }));
      else frag.append(el('a', { href: TEL, 'data-dial': true, text: m[3] }));
      i = m.index + m[0].length;
    }
    frag.append(t.slice(i));
    return frag;
  }

  let skip = false; // any key or tap finishes the current animation
  async function typeInto(node, text) {
    if (reduce) { node.append(linkify(text)); return; }
    const step = Math.max(2, Math.ceil(text.length / 90));
    for (let i = step; i < text.length && !skip; i += step) {
      node.textContent = text.slice(0, i);
      await frame();
    }
    node.replaceChildren(linkify(text));
  }

  function spinner(b, label) {
    const glyphs = '|/-\\';
    const p = line(b, [el('span', { class: 'sr', text: label + '…' })], 'spin');
    const vis = el('span', { 'aria-hidden': 'true' });
    p.append(vis);
    let k = 0;
    const tick = () => { vis.textContent = glyphs[k++ % 4] + ' ' + label; };
    tick();
    const id = setInterval(tick, 90);
    return { stop() { clearInterval(id); p.remove(); } };
  }

  // ── Scrappy (the AI rep) ─────────────────────────────────────────────────
  let sid = ss.get('sl-sid') || '';
  const convo = [];
  let health = null;

  async function fetchT(url, opts, ms) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    try { return await fetch(url, { ...opts, signal: ac.signal }); } finally { clearTimeout(t); }
  }
  async function repOpen() {
    if (health && Date.now() - health.at < 60000) return health.open;
    try {
      const r = await fetchT('/scrappy/api/health', { cache: 'no-store' }, 6000);
      const j = await r.json();
      health = { open: !!j.open, voice: !!(j.open && j.backend), at: Date.now() };
    } catch {
      health = { open: false, voice: false, at: Date.now() };
    }
    return health.open;
  }
  // The voice leg idles off on its own. While it is down, the voice
  // links hide themselves and `voice` says so, instead of sending people to a
  // dead mic. Comes back by itself when the backend does.
  async function checkVoice() {
    await repOpen();
    for (const n of files.querySelectorAll('[data-voice]')) n.hidden = !health.voice;
    return health.voice;
  }
  async function ask(b, q) {
    q = q.trim().slice(0, 500);
    if (!q) { showFile(b, 'ask'); return; }
    const sp = spinner(b, 'scrappy is thinking');
    settle(b);
    if (!(await repOpen())) {
      sp.stop();
      line(b, 'scrappy is asleep right now (the live rep is switched off).', 'err');
      reachHuman(b);
      return;
    }
    let j;
    try {
      const r = await fetchT('/scrappy/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: q, session_id: sid, history: convo.slice(-10), persona: 'scrappy' }),
      }, 45000);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      j = await r.json();
    } catch (e) {
      sp.stop();
      line(b, `connection dropped (${e.name === 'AbortError' ? 'timed out' : e.message}).`, 'err');
      reachHuman(b);
      return;
    }
    sp.stop();
    if (j.session_id) { sid = j.session_id; ss.set('sl-sid', sid); }
    const reply = clean(j.reply || '');
    if (!reply) { line(b, 'scrappy went quiet. try asking again?', 'err'); return; }
    convo.push({ role: 'user', content: q }, { role: 'assistant', content: reply });
    const p = el('p', { class: 'reply' },
      el('span', { class: 'who', 'aria-hidden': 'true', text: 'scrappy> ' }),
      el('span', { class: 'sr', text: 'Scrappy says: ' + reply }));
    const vis = el('span', { 'aria-hidden': 'true' });
    p.append(vis);
    b.append(p);
    await typeInto(vis, reply);
  }

  // ── commands ─────────────────────────────────────────────────────────────
  const C = Object.create(null);
  const HELP = [];
  function def(names, help, fn) {
    const c = { name: names[0], help, fn };
    for (const n of names) C[n] = c;
    if (help) HELP.push(c);
  }
  const fileCmd = (id) => (b) => showFile(b, id);

  def(['services', 'svc'], 'what we build', fileCmd('services'));
  def(['contact', 'call', 'hire', 'email', 'phone'], 'phone, email, a free working session', fileCmd('contact'));
  def(['about', 'brian', 'founder'], "who's behind this", fileCmd('about'));
  def(['blog', 'posts', 'writing', 'log'], 'field notes, teardowns, long reads', fileCmd('blog'));
  def(['demos', 'demo', 'lab'], 'things you can poke at', fileCmd('demos'));
  def(['github', 'code', 'git', 'oss'], 'open-source work', fileCmd('github'));
  def(['ask', 'scrappy'], 'ask scrappy, our AI rep (or just type a question)',
    (b, args) => ask(b, args.join(' ')));
  def(['voice', 'talk'], 'talk to scrappy out loud', async (b) => {
    if (!(await checkVoice())) {
      line(b, "the voice line is down right now. type your question here instead, and scrappy answers in text.", 'err');
      reachHuman(b);
      return;
    }
    line(b, ['opening the voice line → ', el('a', { href: '/scrappy/', text: '/scrappy/' })]);
    await sleep(reduce ? 0 : 500);
    location.href = '/scrappy/';
  });
  def(['open'], 'open item <n> from the last list', (b, args) => {
    const n = parseInt(args[0], 10);
    const a = lastList[n - 1];
    if (!a) { line(b, `open: no item ${args[0] || ''}. run blog or demos first, then open 1.`, 'err'); return; }
    line(b, ['opening ', a.textContent.trim(), ' …'], 'dim');
    if (a.target === '_blank') window.open(a.href, '_blank', 'noopener');
    else location.href = a.href;
  });
  def(['clear', 'cls'], 'clear the screen', () => {
    out.replaceChildren();
    motd.hidden = true;
    bootEl.replaceChildren();
    history.replaceState(null, '', '/');
    return 'cleared';
  });
  def(['help', '?', 'man', 'info'], 'this list', (b, args, raw) => {
    if (/^man\b/.test(raw) && args[0] && args[0] !== 'scrappylabs') {
      const c = C[args[0].toLowerCase()];
      line(b, c && c.help ? `${c.name} — ${c.help}` : `No manual entry for ${args[0]}`, c ? null : 'err');
      return;
    }
    if (/^man\b/.test(raw) && args[0] === 'scrappylabs') {
      for (const id of ['services', 'contact', 'about']) showFile(b, id);
      line(b, ['SEE ALSO ', cmdLink('blog'), '(1), ', cmdLink('demos'), '(1), ', cmdLink('github'), '(1)'], 'dim');
      return;
    }
    const dl = el('dl', { class: 'kv' });
    for (const c of HELP) dl.append(el('dt', null, cmdLink(c.name)), el('dd', { text: c.help }));
    b.append(dl);
    line(b, '↑ ↓ history · tab completes · → takes the suggestion · a few commands are undocumented', 'dim');
  });

  def(['ls', 'dir'], null, (b, args) => {
    const items = [['services.txt', 'services'], ['contact.vcf', 'contact'], ['about.md', 'about'],
                   ['blog/', 'blog'], ['demos/', 'demos'], ['github/', 'github']];
    if (args.some((a) => /^-\w*l/.test(a))) {
      for (const [name, cmd] of items) {
        const d = name.endsWith('/');
        line(b, [`${d ? 'drwxr-xr-x' : '-rw-r--r--'}  brian  wranglers  `, cmdLink(cmd, name)]);
      }
      return;
    }
    const p = line(b, []);
    items.forEach(([name, cmd], i) => p.append(i ? '   ' : '', cmdLink(cmd, name)));
  });
  def(['cat', 'less', 'more', 'cd', 'head', 'tail', 'vi', 'vim', 'nano', 'emacs'], null, (b, args, raw) => {
    const verb = raw.split(/\s+/)[0];
    const arg = args[0] || '';
    if (verb === 'cd' && (!arg || arg === '~' || arg === '..' || arg === '/')) {
      line(b, arg === '..' ? "you're already home." : 'home sweet home.');
      return;
    }
    const target = arg.replace(/^~?\.?\//, '').replace(/(\.txt|\.vcf|\.md|\/|@)$/, '');
    if (/^(vi|vim|nano|emacs)$/.test(verb) && !target) {
      line(b, `${verb}: respect. but nothing here is editable. try help.`);
      return;
    }
    if (FILES.includes(target)) { showFile(b, target); return; }
    line(b, `${verb}: ${args[0] || ''}: No such file or directory`, 'err');
  });
  def(['whoami'], null, (b) => line(b, ['guest. the founder is a different story: ', cmdLink('about')]));
  def(['pwd'], null, (b) => line(b, '/home/guest'));
  def(['echo'], null, (b, args) => line(b, args.join(' ')));
  def(['date'], null, (b) => line(b, new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short' }).format(new Date()) + ' in Asheville'));
  def(['uname'], null, (b, args) => line(b, args.includes('-a')
    ? 'ScrappyLabs scrappylabs 1993.10-wrangled #1 SMP PREEMPT asheville-nc x86_64 GNU/Linux'
    : 'ScrappyLabs'));
  def(['history'], null, (b) => {
    hist.forEach((h, i) => line(b, `${String(i + 1).padStart(4)}  ${h}`));
  });
  def(['sudo', 'su'], null, (b) => {
    line(b, '[sudo] password for guest: ', 'dim');
    line(b, 'guest is not in the sudoers file. This incident will be reported.', 'err');
    line(b, ['(to Brian. he will laugh. you could ', cmdLink('contact', 'hire him'), ' instead.)'], 'dim');
  });
  def(['rm'], null, (b) => line(b, 'rm: permission denied. nice try.', 'err'));
  def(['exit', 'logout', 'quit', ':q', ':q!', ':wq'], null, (b) => {
    line(b, 'logout');
    line(b, ["there's no escape. there is a phone, though: ", telLink()]);
  });
  def(['ping'], null, (b) => line(b, 'PONG. Brian usually answers within one business day.', 'ok'));
  def(['coffee', 'brew'], null, (b) => line(b, "HTTP 418: I'm a teapot.", 'err'));
  def(['hack', 'hacker', 'hackerman'], null, async (b) => {
    line(b, 'ACCESS GRANTED', 'ok');
    await sleep(reduce ? 0 : 600);
    line(b, ['…kidding. we are the good guys. here is what we build: ', cmdLink('services')]);
  });
  def(['sl'], null, async (b) => {
    const train = el('div', { class: 'train', 'aria-hidden': 'true' }, el('pre', { text: TRAIN }));
    b.append(train);
    line(b, [el('span', { class: 'sr', text: 'A steam locomotive rolls across the screen. ' }),
      'sl: you meant ls. or ScrappyLabs. either way, choo choo.'], 'dim');
    settle(b);
  });
  def(['legal', 'privacy', 'terms'], null, (b) => line(b, [
    el('a', { href: '/privacy', text: 'privacy' }), ' · ', el('a', { href: '/tos', text: 'terms' }), ' · ',
    el('a', { href: '/sms', text: 'sms terms' })]));

  const GREET = /^(hi|hello|hey|yo|sup|howdy|hola|thanks|thank you|ty)\b/i;
  const hist = [];
  let hIdx = 0;

  async function run(raw) {
    const text = raw.trim();
    const b = block(text);
    if (!text) { settle(b); return; }
    if (hist[hist.length - 1] !== text) hist.push(text);
    hIdx = hist.length;
    const [name, ...args] = text.split(/\s+/);
    const c = C[name.toLowerCase()];
    try {
      if (c) {
        if ((await c.fn(b, args, text)) === 'cleared') return;
      } else if (/\s/.test(text) || /\?$/.test(text) || GREET.test(text)) {
        await ask(b, text);
      } else {
        line(b, [`${name}: command not found. try `, cmdLink('help'), ', or ask a question in plain English.'], 'err');
      }
    } catch (e) {
      line(b, `error: ${e && e.message ? e.message : e}`, 'err');
    }
    settle(b);
  }

  // one thing at a time: boot, typed commands, chips, replies
  let queue = Promise.resolve();
  let busy = 0;
  const enqueue = (job) => {
    busy++;
    queue = queue.then(job).catch(() => {}).finally(() => { busy--; skip = false; newPrompt(); });
    return queue;
  };

  // chips and in-page command links "type" their command, then run it
  async function typeCommand(cmd) {
    input.value = '';
    if (!reduce) {
      for (let i = 1; i <= cmd.length && !skip; i++) {
        input.value = cmd.slice(0, i);
        paint();
        await sleep(Math.min(28, 260 / cmd.length));
      }
    }
    input.value = '';
    await run(cmd);
  }

  // ── the prompt: a real <input> under a painted mirror with a block cursor ─
  let ghost = '';
  let focused = false;
  function paint() {
    const v = input.value;
    const at = Math.min(input.selectionStart ?? v.length, v.length);
    mirror.replaceChildren(
      v.slice(0, at),
      el('span', { class: 'cur', text: v[at] || ' ' }),
      v.slice(at + 1));
    if (!v && ghost) mirror.append(el('span', { class: 'ghost', text: ghost }));
  }
  function newPrompt() {
    ghost = GHOSTS[(hist.length + 1) % GHOSTS.length];
    paint();
  }
  ['input', 'keyup', 'click', 'select'].forEach((ev) => input.addEventListener(ev, paint));
  document.addEventListener('selectionchange', () => { if (document.activeElement === input) paint(); });
  input.addEventListener('focus', () => { focused = true; form.classList.add('focus'); paint(); });
  input.addEventListener('blur', () => { focused = false; form.classList.remove('focus'); paint(); });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value;
    input.value = '';
    paint();
    enqueue(() => run(v));
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' && hist.length) {
      e.preventDefault();
      hIdx = Math.max(0, hIdx - 1);
      input.value = hist[hIdx] || '';
    } else if (e.key === 'ArrowDown' && hist.length) {
      e.preventDefault();
      hIdx = Math.min(hist.length, hIdx + 1);
      input.value = hist[hIdx] || '';
    } else if (e.key === 'ArrowRight' && !input.value && ghost) {
      e.preventDefault();
      input.value = ghost;
    } else if (e.key === 'Tab' && input.value && !/\s/.test(input.value)) {
      const pre = input.value.toLowerCase();
      const hits = [...new Set(HELP.map((c) => c.name).concat(Object.keys(C)))]
        .filter((n) => n.startsWith(pre) && /^[a-z]/.test(n));
      if (!hits.length) return;            // let Tab move focus as usual
      e.preventDefault();
      if (hits.length === 1) input.value = hits[0] + ' ';
      else {
        const b = block(input.value);
        line(b, hits.join('   '), 'dim');
        settle(b);
      }
    } else if (e.ctrlKey && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      enqueue(() => run('clear'));
    } else if (e.ctrlKey && e.key.toLowerCase() === 'c' && input.selectionStart === input.selectionEnd) {
      e.preventDefault();
      const b = block(input.value + '^C');
      input.value = '';
      settle(b);
    } else {
      return;
    }
    requestAnimationFrame(() => { input.setSelectionRange(input.value.length, input.value.length); paint(); });
  });

  // typing anywhere goes to the prompt; Escape or any tap skips animations
  document.addEventListener('keydown', (e) => {
    if (busy) skip = true;
    const t = e.target;
    if (t === input || e.ctrlKey || e.metaKey || e.altKey) return;
    if (t.closest && t.closest('input, textarea, select, [contenteditable]')) return;
    if (e.key.length === 1 && e.key !== ' ') input.focus({ preventScroll: true });
  });
  document.addEventListener('pointerdown', () => { if (busy) skip = true; });
  $('#tty').addEventListener('click', (e) => {
    if (e.target.closest('a, button, input, label') || String(getSelection())) return;
    if (fine) input.focus({ preventScroll: true });
  });
  form.addEventListener('click', () => input.focus({ preventScroll: true }));

  // links with data-cmd run in the terminal; on desktop a phone link prints the
  // contact card instead of popping the OS "pick an app to call" dialog
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a');
    if (!a) return;
    const cmd = a.getAttribute('data-cmd');
    if (cmd) {
      e.preventDefault();
      const mouse = e.detail > 0;  // keyboard activation keeps focus where it is
      enqueue(() => typeCommand(cmd).then(() => { if (fine && mouse) input.focus({ preventScroll: true }); }));
    } else if (fine && a.protocol === 'tel:' && !a.hasAttribute('data-dial')) {
      e.preventDefault();
      enqueue(() => typeCommand('contact'));
    }
  });
  addEventListener('hashchange', () => {
    const id = location.hash.slice(1);
    if (FILES.includes(id)) enqueue(() => typeCommand(id));
  });

  // ── boot ─────────────────────────────────────────────────────────────────
  const BOOT = [
    ['hd', 'ScrappyLabs BIOS v26.10  (c) 1993-2026'],
    ['', 'cpu: 1x caffeinated founder', 'OK'],
    ['', 'memory: 640K (ought to be enough)', 'OK'],
    ['', 'mounting /dev/agents', 'OK'],
    ['', 'phone desk on ' + PHONE, 'UP'],
    ['', 'babysitter (safety layer)', 'WATCHING'],
    ['hd', 'login: guest'],
  ];
  async function boot() {
    const first = !ss.get('sl-booted') && !reduce;
    if (first) {
      ss.set('sl-booted', '1');
      for (const [cls, label, st] of BOOT) {
        if (skip) break;
        bootEl.append(el('div', { class: 'ln ' + cls },
          el('span', { class: 'lbl', text: label }),
          st ? el('span', { class: 'dots' }) : null,
          st ? el('span', { class: 'st', text: st }) : null));
        await sleep(cls === 'hd' ? 160 : 95);
      }
    }
    root.classList.remove('booting');
    if (first && !skip) await sleep(120);
    const id = location.hash.slice(1) || location.pathname.replace(/^\/|\/$/g, '');
    if (FILES.includes(id)) await typeCommand(id);
    if (fine) input.focus({ preventScroll: true });
  }

  // tmux clock: Asheville time, because "is he awake?" is a fair question
  const clock = $('#clock');
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  const tickClock = () => { if (clock) clock.textContent = 'AVL ' + fmt.format(new Date()); };
  tickClock();
  setInterval(tickClock, 20000);

  const TRAIN = String.raw`      ====        ________                ___________
  _D _|  |_______/        \__I_I_____===__|_________|
   |(_)---  |   H\________/ |   |        =|___ ___|       _________________
   /     |  |   H  |  |     |   |         ||_| |_||     _|                \_____A
  |      |  |   H  |__--------------------| [___] |   =|      SCRAPPYLABS       |
  | ________|___H__/__|_____/[][]~\_______|       |   -|                        |
  |/ |   |-----------I_____I [][] []  D   |=======|____|________________________|_
__/ =| o |=-~~\  /~~\  /~~\  /~~\ ____Y___________|__|__________________________|_
 |/-=|___|=    ||    ||    ||    |_____/~\___/          |_D__D__D_|  |_D__D__D_|
  \_/      \O=====O=====O=====O_/      \_/               \_/   \_/    \_/   \_/      `;

  newPrompt();
  checkVoice();
  enqueue(boot);
})();
