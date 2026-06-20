/*
 * BC2 Player Watch
 *
 * Watches a Battlefield: Bad Company 2 server via the bflist.io API and shows
 * whether a given player is online, as a colored dot plus the full roster:
 *
 *   green   player is on the target server
 *   yellow  player is online, but on a different server
 *   red     target server is up, but the player is not on it
 *   grey    target server is offline (not in the server list)
 *
 * A normal check is a single direct request to the last-known ip:port. The
 * full server list is only fetched when needed: to re-locate the server by
 * GUID after a 404 (persisting the new ip:port), or to check whether the
 * player is on another server.
 *
 * Config lives in the URL query string so links are shareable/bookmarkable.
 * The auto-discovered ip:port is also cached in localStorage (keyed by GUID).
 */

'use strict';

const DEFAULTS = {
  player:   '',
  guid:     'a29658-5436dd8-25091f8-865ea20',
  ip:       '64.188.124.238',
  port:     '19569',
  api:      'https://api.bflist.io/v2/bfbc2',
};

const els = {
  card:     document.getElementById('card'),
  dot:      document.getElementById('dot'),
  title:    document.getElementById('title'),
  sub:      document.getElementById('sub'),
  roster:   document.getElementById('roster'),
  team1:    document.querySelector('#team1 .players'),
  team2:    document.querySelector('#team2 .players'),
  config:   document.getElementById('config'),
  refresh:  document.getElementById('refresh'),
  gear:     document.getElementById('gear'),
  updated:  document.getElementById('updated'),
  reset:    document.getElementById('cfg-reset'),
  cfg: {
    player:   document.getElementById('cfg-player'),
    guid:     document.getElementById('cfg-guid'),
    ip:       document.getElementById('cfg-ip'),
    port:     document.getElementById('cfg-port'),
    api:      document.getElementById('cfg-api'),
  },
};

let cfg = readConfig();
let busy = false;

/* ---------- config: URL <-> state ---------- */

function readConfig() {
  const q = new URLSearchParams(location.search);
  const c = {
    player:   q.get('player') || DEFAULTS.player,
    guid:     q.get('guid')   || DEFAULTS.guid,
    api:      q.get('api')    || DEFAULTS.api,
  };
  // ip/port: explicit URL params win; otherwise use the address we last
  // auto-discovered for this GUID; otherwise the built-in default.
  const cached = loadCached(c.guid);
  c.ip   = q.get('ip')   || (cached && cached.ip)   || DEFAULTS.ip;
  c.port = q.get('port') || (cached && cached.port) || DEFAULTS.port;
  return c;
}

// Reflect non-default settings into the URL so the link is shareable. ip/port
// are omitted unless they differ from the default (they self-heal via GUID).
function writeConfig(c, { replace = false } = {}) {
  const q = new URLSearchParams();
  if (c.player !== DEFAULTS.player)     q.set('player', c.player);
  if (c.guid !== DEFAULTS.guid)         q.set('guid', c.guid);
  if (c.ip !== DEFAULTS.ip)             q.set('ip', c.ip);
  if (c.port !== DEFAULTS.port)         q.set('port', c.port);
  if (c.api !== DEFAULTS.api)           q.set('api', c.api);
  const qs = q.toString();
  const url = location.pathname + (qs ? '?' + qs : '');
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
}

function loadCached(guid) {
  try { return JSON.parse(localStorage.getItem('bc2:' + guid) || 'null'); }
  catch (e) { return null; }
}

function saveCached(guid, ip, port) {
  try { localStorage.setItem('bc2:' + guid, JSON.stringify({ ip, port })); }
  catch (e) { /* private mode / storage disabled — fine, GUID re-find still works */ }
}

/* ---------- networking ---------- */

async function fetchJson(url) {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return { ok: false, notFound: res.status === 404, data: null };
    return { ok: true, notFound: false, data: await res.json() };
  } catch (e) {
    return { ok: false, notFound: false, data: null };
  }
}

const directUrl = () => `${cfg.api}/servers/${cfg.ip}:${cfg.port}`;
const listUrl   = () => `${cfg.api}/servers?perPage=100`;

function matches(p) {
  return !!(p && p.name) &&
    p.name.toLowerCase() === String(cfg.player).trim().toLowerCase();
}

function findPlayer(server) {
  const players = (server && server.players) || [];
  return players.find(matches) || null;
}

/* ---------- check flow ---------- */

async function poll() {
  if (busy) return;
  busy = true;
  setLoading(true);

  if (!String(cfg.player).trim()) {
    // No player chosen yet: show the target server's roster with a prompt.
    const direct = await fetchJson(directUrl());
    const server = (direct.data && direct.data.guid) ? direct.data : null;
    finish(view('grey',
      server ? server.name : 'BC2 Player Watch',
      'Set a player to watch below, or add ?player=NAME to the URL',
      server));
    return;
  }

  const direct = await fetchJson(directUrl());

  if (direct.data && direct.data.guid) {
    // Server responded directly: assume online, check its roster.
    if (findPlayer(direct.data)) {
      finish(setGreen(direct.data));
    } else {
      // Player not here; one list fetch to see if they're elsewhere.
      finish(await pollList('yellow-check', direct.data));
    }
  } else {
    // 404 or unreachable: re-locate the server via the list.
    finish(await pollList('direct-miss', null));
  }
}

async function pollList(reason, knownServer) {
  const list = await fetchJson(listUrl());
  const servers = (list.data && list.data.servers) ? list.data.servers : null;

  if (!servers) {
    // List unreachable. Degrade gracefully.
    if (reason === 'yellow-check' && knownServer) return setRed(knownServer);
    return setError();
  }

  // Locate our target by GUID and scan everyone for the watched player.
  let target = null;
  let playerServer = null;
  for (const s of servers) {
    if (s.guid === cfg.guid) target = s;
    if (!playerServer && findPlayer(s)) playerServer = s;
  }

  if (reason === 'yellow-check') {
    // Target confirmed up via the direct query; decide yellow vs red.
    if (playerServer && playerServer.guid !== cfg.guid) return setYellow(playerServer);
    return setRed(knownServer);
  }

  // reason === 'direct-miss'
  if (target) {
    updateConnection(target.ip, target.port); // persist any ip/port change
    if (findPlayer(target)) return setGreen(target);
    if (playerServer && playerServer.guid !== cfg.guid) return setYellow(playerServer);
    return setRed(target);
  }
  // Target server is offline (not in the list).
  if (playerServer) return setYellow(playerServer);
  return setGrey();
}

function updateConnection(ip, port) {
  const portStr = String(port);
  let changed = false;
  if (ip && cfg.ip !== ip) { cfg.ip = ip; changed = true; }
  if (portStr && cfg.port !== portStr) { cfg.port = portStr; changed = true; }
  if (changed) {
    saveCached(cfg.guid, cfg.ip, cfg.port);
    writeConfig(cfg, { replace: true });
  }
}

/* ---------- status -> view model ---------- */

function playerCount(s) {
  if (s == null) return '';
  const n = (s.numPlayers != null) ? s.numPlayers : ((s.players || []).length);
  const m = (s.maxPlayers != null) ? s.maxPlayers : '?';
  return `${n}/${m}`;
}

const setGreen  = (s) => view('green',  s.name, `${cfg.player} is online · ${playerCount(s)}`, s);
const setYellow = (s) => view('yellow', s.name, `${cfg.player} is on a different server · ${playerCount(s)}`, s);
const setRed    = (s) => view('red',    s.name, `${cfg.player} is not on the server · ${playerCount(s)}`, s);
const setGrey   = ()  => view('grey',  'Target server offline', 'Server not found in the list', null);
const setError  = ()  => view('grey',  'Connection error', 'Could not reach bflist.io', null);

function view(status, title, sub, server) {
  return { status, title, sub, server };
}

/* ---------- rendering ---------- */

function finish(vm) {
  render(vm);
  busy = false;
  setLoading(false);
  els.updated.textContent = 'updated ' + new Date().toLocaleTimeString();
  const who = String(cfg.player).trim();
  document.title = who
    ? `${dotChar(vm.status)} ${who} — BC2 Player Watch`
    : 'BC2 Player Watch';
}

function dotChar(s) {
  return { green: '🟢', yellow: '🟡', red: '🔴', grey: '⚪' }[s] || '⚪';
}

function render(vm) {
  els.dot.dataset.status = vm.status;
  els.title.textContent = vm.title;
  els.sub.textContent = vm.sub;

  if (vm.server) {
    fillTeam(els.team1, vm.server, 1);
    fillTeam(els.team2, vm.server, 2);
    els.roster.hidden = false;
  } else {
    els.roster.hidden = true;
  }
}

function fillTeam(ul, server, teamNo) {
  ul.textContent = '';
  const all = server.players || [];
  // Team 1 is team===1; "Team 2" is everything else.
  const players = all.filter((p) => teamNo === 1 ? p.team === 1 : p.team !== 1);

  if (!players.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '—';
    ul.appendChild(li);
    return;
  }
  for (const p of players) {
    const li = document.createElement('li');
    if (matches(p)) li.className = 'me';
    if (p.tag) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = `[${p.tag}] `;
      li.appendChild(tag);
    }
    li.appendChild(document.createTextNode(p.name));
    ul.appendChild(li);
  }
}

function setLoading(on) {
  els.dot.classList.toggle('loading', on);
}

/* ---------- config form wiring ---------- */

function fillForm() {
  els.cfg.player.value = cfg.player;
  els.cfg.guid.value   = cfg.guid;
  els.cfg.ip.value     = cfg.ip;
  els.cfg.port.value   = cfg.port;
  els.cfg.api.value    = cfg.api;
}

els.gear.addEventListener('click', () => {
  els.config.hidden = !els.config.hidden;
  if (!els.config.hidden) fillForm();
});

els.config.addEventListener('submit', (e) => {
  e.preventDefault();
  cfg = {
    player: els.cfg.player.value.trim() || DEFAULTS.player,
    guid:   els.cfg.guid.value.trim()   || DEFAULTS.guid,
    ip:     els.cfg.ip.value.trim()     || DEFAULTS.ip,
    port:   els.cfg.port.value.trim()   || DEFAULTS.port,
    api:    els.cfg.api.value.trim()    || DEFAULTS.api,
  };
  writeConfig(cfg);
  els.config.hidden = true;
  poll();
});

els.reset.addEventListener('click', () => {
  cfg = { ...DEFAULTS };
  fillForm();
});

els.refresh.addEventListener('click', () => {
  els.refresh.classList.remove('spin');
  void els.refresh.offsetWidth; // restart the animation
  els.refresh.classList.add('spin');
  poll();
});

// Back/forward navigation between shared links re-reads the config.
window.addEventListener('popstate', () => {
  cfg = readConfig();
  poll();
});

/* ---------- go ---------- */

writeConfig(cfg, { replace: true }); // normalize the URL on first load
if (!String(cfg.player).trim()) {
  // First-time setup: surface the form. Once a player is set it stays
  // collapsed behind the ⚙ button.
  fillForm();
  els.config.hidden = false;
}
poll();
