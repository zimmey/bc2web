/*
 * BC2 Player Watch
 *
 * Watches a fixed Battlefield: Bad Company 2 server via the bflist.io API and
 * shows whether any of one-or-more watched players is online, as a colored dot
 * plus the full roster:
 *
 *   green   a watched player is on the target server
 *   yellow  a watched player is online, but on a different server
 *   red     target server is up, but no watched player is on it
 *   grey    target server is offline (not in the server list)
 *
 * A normal check is a single direct request to the last-known ip:port. The
 * full server list is only fetched when needed: to re-locate the server by
 * GUID after a 404 (persisting the new ip:port), or to check whether a watched
 * player is on another server.
 *
 * The watched player(s) live in the URL query string (?player=a,b,c) so links
 * are shareable/bookmarkable. The target server is fixed (constants below); its
 * auto-discovered ip:port is cached in localStorage so the app self-heals if
 * the server ever changes address.
 */

'use strict';

// Fixed target server. Edit here to point the page at a different server.
const SERVER = {
  guid: 'a29658-5436dd8-25091f8-865ea20',
  api:  'https://api.bflist.io/v2/bfbc2',
  ip:   '64.188.124.238', // default / fallback address (self-heals via GUID)
  port: '19569',
};

const els = {
  dot:     document.getElementById('dot'),
  title:   document.getElementById('title'),
  sub:     document.getElementById('sub'),
  roster:  document.getElementById('roster'),
  mapName: document.getElementById('map-name'),
  team1:   document.querySelector('#team1 .players'),
  team2:   document.querySelector('#team2 .players'),
  team1Head: document.getElementById('team1-head'),
  team2Head: document.getElementById('team2-head'),
  config:  document.getElementById('config'),
  refresh: document.getElementById('refresh'),
  gear:    document.getElementById('gear'),
  updated: document.getElementById('updated'),
  cancel:  document.getElementById('cfg-cancel'),
  input:   document.getElementById('cfg-player'),
};

// Watched players (state).
let playerStr = '';     // normalized, comma-joined, for display
let players = [];       // names as entered
let watched = new Set();// lowercased names, for matching
let conn = loadConn();  // { ip, port } — self-heals
let busy = false;

/* ---------- config: URL <-> state ---------- */

function setPlayers(str) {
  players = String(str || '').split(',').map((s) => s.trim()).filter(Boolean);
  watched = new Set(players.map((s) => s.toLowerCase()));
  playerStr = players.join(', ');
}

function readUrl() {
  const q = new URLSearchParams(location.search);
  setPlayers(q.get('player') || '');
}

// The watched players are the only thing in the URL, so links stay shareable.
function writeUrl({ replace = false } = {}) {
  const q = new URLSearchParams();
  if (players.length) q.set('player', players.join(','));
  const qs = q.toString();
  const url = location.pathname + (qs ? '?' + qs : '');
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
}

function loadConn() {
  try {
    const c = JSON.parse(localStorage.getItem('bc2:' + SERVER.guid) || 'null');
    if (c && c.ip && c.port) return { ip: c.ip, port: String(c.port) };
  } catch (e) { /* ignore */ }
  return { ip: SERVER.ip, port: SERVER.port };
}

function saveConn() {
  try { localStorage.setItem('bc2:' + SERVER.guid, JSON.stringify(conn)); }
  catch (e) { /* private mode / storage disabled — GUID re-find still works */ }
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

const directUrl = () => `${SERVER.api}/servers/${conn.ip}:${conn.port}`;
const listUrl   = () => `${SERVER.api}/servers?perPage=100`;

function matches(p) {
  return !!(p && p.name) && watched.has(p.name.toLowerCase());
}

function anyWatchedOn(server) {
  return ((server && server.players) || []).some(matches);
}

// Watched players actually on a server, in their real-roster casing.
function presentNames(server) {
  return ((server && server.players) || []).filter(matches).map((p) => p.name);
}

/* ---------- check flow ---------- */

async function poll() {
  if (busy) return;
  busy = true;
  setLoading(true);

  if (!players.length) {
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
    if (anyWatchedOn(direct.data)) {
      finish(setGreen(direct.data));
    } else {
      // Nobody watched here; one list fetch to see if they're elsewhere.
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

  // Locate our target by GUID and find the first server with a watched player.
  let target = null;
  let playerServer = null;
  for (const s of servers) {
    if (s.guid === SERVER.guid) target = s;
    if (!playerServer && anyWatchedOn(s)) playerServer = s;
  }

  if (reason === 'yellow-check') {
    // Target confirmed up via the direct query; decide yellow vs red.
    if (playerServer && playerServer.guid !== SERVER.guid) return setYellow(playerServer);
    return setRed(knownServer);
  }

  // reason === 'direct-miss'
  if (target) {
    updateConnection(target.ip, target.port); // persist any ip/port change
    if (anyWatchedOn(target)) return setGreen(target);
    if (playerServer && playerServer.guid !== SERVER.guid) return setYellow(playerServer);
    return setRed(target);
  }
  // Target server is offline (not in the list).
  if (playerServer) return setYellow(playerServer);
  return setGrey();
}

function updateConnection(ip, port) {
  const portStr = String(port);
  let changed = false;
  if (ip && conn.ip !== ip) { conn.ip = ip; changed = true; }
  if (portStr && conn.port !== portStr) { conn.port = portStr; changed = true; }
  if (changed) saveConn();
}

/* ---------- status -> view model ---------- */

function playerCount(s) {
  if (s == null) return '';
  const n = (s.numPlayers != null) ? s.numPlayers : ((s.players || []).length);
  const m = (s.maxPlayers != null) ? s.maxPlayers : '?';
  return `${n}/${m}`;
}

// "alice is …" for one present name, "alice, bob are …" for several.
function phrase(names, singular, plural) {
  return names.length === 1
    ? `${names[0]} ${singular}`
    : `${names.join(', ')} ${plural}`;
}

const setGreen = (s) =>
  view('green', s.name,
    `${phrase(presentNames(s), 'is online', 'are online')} · ${playerCount(s)}`, s);

const setYellow = (s) =>
  view('yellow', s.name,
    `${phrase(presentNames(s), 'is on a different server', 'are on a different server')} · ${playerCount(s)}`, s);

const setRed = (s) =>
  view('red', s.name,
    `${players.length === 1 ? `${players[0]} is not on the server` : 'None of the watched players are on the server'} · ${playerCount(s)}`, s);

const setGrey  = () => view('grey', 'Target server offline', 'Server not found in the list', null);
const setError = () => view('grey', 'Connection error', 'Could not reach bflist.io', null);

function view(status, title, sub, server) {
  return { status, title, sub, server };
}

/* ---------- rendering ---------- */

function finish(vm) {
  render(vm);
  busy = false;
  setLoading(false);
  els.updated.textContent = 'updated ' + new Date().toLocaleTimeString();
  document.title = players.length
    ? `${dotChar(vm.status)} ${playerStr} — BC2 Player Watch`
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
    els.mapName.textContent = mapText(vm.server);
    const [h1, h2] = teamHeads(vm.server);
    els.team1Head.textContent = h1;
    els.team2Head.textContent = h2;
    fillTeam(els.team1, vm.server, 1);
    fillTeam(els.team2, vm.server, 2);
    els.roster.hidden = false;
  } else {
    els.roster.hidden = true;
  }
}

// "<map> (<gameType>)", e.g. "Valparaiso (RUSH)".
function mapText(server) {
  const name = server.mapLabel || server.map || 'Unknown';
  return server.gameType ? `${name} (${server.gameType})` : name;
}

// Header text for both teams, e.g. ["Team 1 (300 Tickets)", "Team 2 (239 Tickets)"].
//
// Rush is special: the defenders' ticket value is an "unlimited" sentinel (the
// large number), while the attackers hold the meaningful, decreasing
// reinforcement count (the small one). Whichever side reports more tickets is
// the defender, so we label roles instead of printing two raw ticket counts.
function teamHeads(server) {
  const teams = server.teams || [];
  const t1 = teams[0] && teams[0].tickets;
  const t2 = teams[1] && teams[1].tickets;
  const isRush = String(server.gameType || '').toUpperCase() === 'RUSH';

  if (isRush && t1 != null && t2 != null && t1 !== t2) {
    const team1Defends = t1 > t2;
    return team1Defends
      ? ['Team 1 (Defending)', `Team 2 (Attacking · ${Math.round(t2)})`]
      : [`Team 1 (Attacking · ${Math.round(t1)})`, 'Team 2 (Defending)'];
  }
  return [ticketHead(1, t1), ticketHead(2, t2)];
}

function ticketHead(n, tickets) {
  return tickets != null ? `Team ${n} (${Math.round(tickets)} Tickets)` : `Team ${n}`;
}

function fillTeam(ul, server, teamNo) {
  ul.textContent = '';
  const all = server.players || [];
  // Team 1 is team===1; "Team 2" is everything else.
  const teamPlayers = all.filter((p) => teamNo === 1 ? p.team === 1 : p.team !== 1);

  if (!teamPlayers.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '—';
    ul.appendChild(li);
    return;
  }
  for (const p of teamPlayers) {
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
  els.input.value = playerStr;
}

els.gear.addEventListener('click', () => {
  els.config.hidden = !els.config.hidden;
  if (!els.config.hidden) { fillForm(); els.input.focus(); }
});

els.config.addEventListener('submit', (e) => {
  e.preventDefault();
  setPlayers(els.input.value);
  writeUrl();
  els.config.hidden = true;
  poll();
});

els.cancel.addEventListener('click', () => {
  fillForm();              // discard any edits
  els.config.hidden = true;
});

els.refresh.addEventListener('click', () => {
  els.refresh.classList.remove('spin');
  void els.refresh.offsetWidth; // restart the animation
  els.refresh.classList.add('spin');
  poll();
});

// Back/forward navigation between shared links re-reads the watched players.
window.addEventListener('popstate', () => {
  readUrl();
  poll();
});

/* ---------- go ---------- */

readUrl();
writeUrl({ replace: true }); // normalize the URL on first load
if (!players.length) {
  // First-time setup: surface the form. Once a player is set it stays
  // collapsed behind the ⚙ button.
  fillForm();
  els.config.hidden = false;
}
poll();
