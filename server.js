#!/usr/bin/env node
'use strict';
// Project Launcher — lokalny serwer bez zależności zewnętrznych (Node >= 16).
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const PORT = Number(process.env.PORT) || 4777;
const HOST = '127.0.0.1';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const MARKER = '.project-launcher-id';
const WIN = process.platform === 'win32';
const PY = WIN ? 'python' : 'python3';
const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', 'target', '__pycache__', '.venv', 'venv',
  '.idea', '.vscode', '.DS_Store', '.next', '.cache', MARKER]);
const HINTS = ['package.json', 'pyproject.toml', 'requirements.txt', 'setup.py', 'Cargo.toml', 'go.mod', 'Makefile',
  'docker-compose.yml', 'docker-compose.yaml', 'compose.yaml', 'pom.xml', 'build.gradle', 'composer.json', 'Gemfile',
  'deno.json', 'index.html', 'main.py', 'app.py', 'README.md', 'readme.md', '.git'];

/* ---------- utils ---------- */
const httpErr = (status, error) => Object.assign(new Error(error), { status });
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const key = p => (WIN ? p.toLowerCase() : p);
const norm = p => path.resolve(String(p || '').trim().replace(/^~(?=$|[\\/])/, os.homedir()));
const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

/* ---------- storage ---------- */
let db = { roots: [], projects: [] };
function load() {
  try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { /* nowy plik */ }
  db.roots = db.roots || []; db.projects = db.projects || [];
}
function save() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

/* ---------- identyfikacja projektu ---------- */
const readMarker = d => { try { return fs.readFileSync(path.join(d, MARKER), 'utf8').trim() || null; } catch { return null; } };
const writeMarker = (d, id) => { try { fs.writeFileSync(path.join(d, MARKER), id + '\n'); return true; } catch { return false; } };

function listNames(d) {
  try { return fs.readdirSync(d).filter(n => !IGNORE.has(n)).sort(); } catch { return []; }
}
function gitRoot(d) {
  if (!fs.existsSync(path.join(d, '.git'))) return null;
  try {
    const r = spawnSync('git', ['rev-list', '--max-parents=0', 'HEAD'], { cwd: d, encoding: 'utf8', timeout: 3000 });
    return (r.stdout || '').trim().split('\n')[0] || null;
  } catch { return null; }
}
function fingerprintOf(d) {
  const files = listNames(d);
  return { files, fingerprint: sha(files.join('\n')), git: gitRoot(d) };
}
const jaccard = (a, b) => {
  if (!a.length || !b.length) return 0;
  const A = new Set(a); let inter = 0;
  for (const x of b) if (A.has(x)) inter++;
  return inter / (A.size + new Set(b).size - inter);
};

/* ---------- skan folderów ---------- */
function subdirs(d) {
  try {
    return fs.readdirSync(d, { withFileTypes: true })
      .filter(e => e.isDirectory() && !IGNORE.has(e.name) && !e.name.startsWith('.'))
      .map(e => path.join(d, e.name));
  } catch { return []; }
}
const isProjectDir = d => HINTS.some(h => fs.existsSync(path.join(d, h)));
function findProjects(root, depth = 2) {
  const out = [];
  (function walk(d, lvl) {
    for (const c of subdirs(d)) {
      if (out.length >= 500) return;
      if (isProjectDir(c)) out.push(c);
      else if (lvl < depth) walk(c, lvl + 1);
    }
  })(root, 1);
  return out;
}

/* ---------- opis z README i komenda ---------- */
function readmeDescription(dir) {
  let file;
  try { file = fs.readdirSync(dir).find(f => /^readme(\.(md|markdown|txt|rst))?$/i.test(f)); } catch { /* */ }
  if (!file) return '';
  let t;
  try { t = fs.readFileSync(path.join(dir, file), 'utf8'); } catch { return ''; }
  t = t.replace(/^\uFEFF/, '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
    .replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '');
  const paras = []; let cur = []; let code = false;
  for (const raw of t.split(/\r?\n/)) {
    const l = raw.trim();
    if (l.startsWith('```')) { code = !code; continue; }
    if (code) continue;
    if (!l || /^#{1,6}\s/.test(l) || /^[=\-*_]{3,}$/.test(l) || /^!\[.*\]\(.*\)$/.test(l) || /^\[!\[/.test(l) || /^\|/.test(l)) {
      if (cur.length) { paras.push(cur.join(' ')); cur = []; }
      continue;
    }
    cur.push(l);
  }
  if (cur.length) paras.push(cur.join(' '));
  const clean = s => s.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>]/g, '').replace(/\s+/g, ' ').trim();
  let d = clean(paras.map(clean).find(p => p.length > 15) || paras[0] || '');
  if (d.length > 400) d = d.slice(0, 397).replace(/\s+\S*$/, '') + '…';
  return d;
}
function detectCommand(dir) {
  const has = f => isFile(path.join(dir, f));
  if (has('package.json')) {
    try {
      const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      const s = pj.scripts || {};
      const pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : (has('bun.lockb') || has('bun.lock')) ? 'bun' : 'npm';
      for (const k of ['dev', 'start', 'serve']) if (s[k]) return `${pm} run ${k}`;
      if (pj.main) return `node ${pj.main}`;
    } catch { /* */ }
    return 'npm start';
  }
  if (has('manage.py')) return `${PY} manage.py runserver`;
  for (const f of ['main.py', 'app.py', 'run.py']) if (has(f)) return `${PY} ${f}`;
  if (has('Cargo.toml')) return 'cargo run';
  if (has('go.mod')) return 'go run .';
  for (const f of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yaml']) if (has(f)) return 'docker compose up';
  if (has('Makefile')) {
    try { if (/^run\s*:/m.test(fs.readFileSync(path.join(dir, 'Makefile'), 'utf8'))) return 'make run'; } catch { /* */ }
  }
  if (has('index.html')) return `${PY} -m http.server 8000`;
  return '';
}
const prettyName = d => {
  const n = path.basename(d).replace(/[-_]+/g, ' ').trim() || path.basename(d);
  return n.charAt(0).toUpperCase() + n.slice(1);
};

/* ---------- rejestr projektów ---------- */
function refreshAuto(p) {
  p.edited = p.edited || {};
  if (!p.edited.description) p.description = readmeDescription(p.path);
  if (!p.edited.command) p.command = detectCommand(p.path);
}
function refreshIdentity(p) {
  const fp = fingerprintOf(p.path);
  p.files = fp.files; p.fingerprint = fp.fingerprint; p.git = fp.git;
  p.verifiedAt = new Date().toISOString();
}
function statusOf(p) {
  if (!isDir(p.path)) return 'missing';
  const m = readMarker(p.path);
  if (m && m !== p.id) return 'mismatch';
  return 'ok';
}
function addProject(dir, { explicit = false } = {}) {
  dir = norm(dir);
  if (!isDir(dir)) throw httpErr(400, 'Folder nie istnieje: ' + dir);
  const same = db.projects.find(p => key(p.path) === key(dir));
  if (same) return null;
  let id = readMarker(dir);
  const known = id && db.projects.find(p => p.id === id);
  if (known) {
    if (!isDir(known.path)) {              // ten sam projekt, przeniesiony
      if (!explicit) return null;          // przy skanie tylko sugerujemy (UI pokaże propozycję)
      known.path = dir; refreshIdentity(known); save(); return known;
    }
    id = null;                              // kopia folderu — nowy identyfikator
  }
  if (!id) id = crypto.randomUUID();
  writeMarker(dir, id);
  const p = { id, name: prettyName(dir), path: dir, description: '', command: '', edited: {}, added: new Date().toISOString() };
  refreshAuto(p); refreshIdentity(p);
  db.projects.push(p); save();
  return p;
}
function rescan() {
  let added = 0;
  for (const r of db.roots) {
    if (!isDir(r)) continue;
    for (const d of findProjects(r)) { if (addProject(d)) added++; }
  }
  for (const p of db.projects) {
    if (statusOf(p) === 'ok') {
      if (!readMarker(p.path)) writeMarker(p.path, p.id);
      refreshAuto(p); refreshIdentity(p);
    }
  }
  sugCache.clear(); save();
  return added;
}

/* ---------- sugestie nowej ścieżki ---------- */
const sugCache = new Map();
function suggest(p) {
  const c = sugCache.get(p.id);
  if (c && Date.now() - c.t < 30000) return c.list;
  const bases = new Set([...db.roots, path.dirname(p.path), path.dirname(path.dirname(p.path))]);
  const dirs = new Set();
  for (const b of bases) if (isDir(b)) for (const d of findProjects(b)) dirs.add(d);
  const list = [];
  let n = 0;
  for (const d of dirs) {
    if (++n > 400) break;
    if (key(d) === key(p.path)) continue;
    if (db.projects.some(o => o.id !== p.id && key(o.path) === key(d))) continue;
    const m = readMarker(d);
    if (m && m !== p.id) continue;
    let score = 0; const why = [];
    if (m === p.id) { score = 100; why.push('ten sam identyfikator'); }
    else {
      const j = jaccard(p.files || [], listNames(d));
      if (j > 0) { score += Math.round(j * 60); why.push(`zawartość ${Math.round(j * 100)}% zgodna`); }
      if (path.basename(d).toLowerCase() === path.basename(p.path).toLowerCase()) { score += 25; why.push('ta sama nazwa folderu'); }
      if (p.git && gitRoot(d) === p.git) { score += 60; why.push('ten sam pierwszy commit git'); }
    }
    score = Math.min(score, 100);
    if (score >= 50) list.push({ path: d, score, why });
  }
  list.sort((a, b) => b.score - a.score);
  const top = list.slice(0, 3);
  sugCache.set(p.id, { t: Date.now(), list: top });
  return top;
}

/* ---------- uruchamianie ---------- */
const running = new Map();
const LOG_MAX = 100000;
function appendLog(r, s) { r.log += s; if (r.log.length > LOG_MAX) r.log = r.log.slice(-LOG_MAX); }
function startProject(p) {
  const cur = running.get(p.id);
  if (cur && cur.alive) throw httpErr(409, 'Już uruchomiony');
  if (!p.command) throw httpErr(400, 'Brak komendy uruchomieniowej');
  if (statusOf(p) !== 'ok') throw httpErr(400, 'Ścieżka projektu jest niedostępna lub wskazuje inny projekt');
  const child = spawn(p.command, {
    cwd: p.path, shell: true, detached: !WIN, windowsHide: true,
    env: { ...process.env, FORCE_COLOR: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const r = { child, pid: child.pid, alive: true, exitCode: null, startedAt: Date.now(), log: `$ ${p.command}\n` };
  running.set(p.id, r);
  child.stdout.on('data', b => appendLog(r, b.toString()));
  child.stderr.on('data', b => appendLog(r, b.toString()));
  child.on('error', e => { appendLog(r, `\n[błąd uruchomienia: ${e.message}]\n`); r.alive = false; r.exitCode = -1; });
  child.on('exit', (code, sig) => { r.alive = false; r.exitCode = code; appendLog(r, `\n[zakończono: ${sig || code}]\n`); });
}
function killTree(r) {
  if (!r || !r.alive) return;
  try {
    if (WIN) spawnSync('taskkill', ['/pid', String(r.pid), '/T', '/F']);
    else {
      try { process.kill(-r.pid, 'SIGTERM'); } catch { r.child.kill('SIGTERM'); }
      setTimeout(() => { if (r.alive) { try { process.kill(-r.pid, 'SIGKILL'); } catch { /* */ } } }, 5000).unref();
    }
  } catch { /* */ }
}
function stopAll() { for (const r of running.values()) killTree(r); }

/* ---------- API ---------- */
function state() {
  return {
    platform: process.platform, home: os.homedir(),
    roots: db.roots.map(r => ({ path: r, exists: isDir(r) })),
    projects: db.projects.map(p => {
      const status = statusOf(p); const r = running.get(p.id);
      return {
        id: p.id, name: p.name, path: p.path, description: p.description, command: p.command,
        edited: p.edited || {}, status, verifiedAt: p.verifiedAt,
        running: r ? { alive: r.alive, pid: r.pid, startedAt: r.startedAt, exitCode: r.exitCode } : null,
        suggestions: status === 'ok' ? [] : suggest(p),
      };
    }),
  };
}
const getProject = id => { const p = db.projects.find(x => x.id === id); if (!p) throw httpErr(404, 'Nie ma takiego projektu'); return p; };

const routes = [];
const route = (m, re, fn) => routes.push([m, re, fn]);

route('GET', /^\/api\/state$/, () => state());
route('GET', /^\/api\/browse$/, (b, q) => {
  const d = norm(q.get('path') || os.homedir());
  if (!isDir(d)) throw httpErr(400, 'To nie jest folder');
  const dirs = [];
  try { for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory() && !e.name.startsWith('.')) dirs.push(e.name); } catch { /* brak uprawnień */ }
  dirs.sort((a, b) => a.localeCompare(b));
  const parent = path.dirname(d);
  return { path: d, parent: parent === d ? null : parent, dirs, isProject: isProjectDir(d) };
});
route('POST', /^\/api\/roots$/, b => {
  const d = norm(b.path);
  if (!isDir(d)) throw httpErr(400, 'Folder nie istnieje: ' + d);
  if (!db.roots.some(r => key(r) === key(d))) db.roots.push(d);
  save();
  return { added: rescan() };
});
route('DELETE', /^\/api\/roots$/, b => {
  const d = norm(b.path);
  db.roots = db.roots.filter(r => key(r) !== key(d)); save(); return {};
});
route('POST', /^\/api\/rescan$/, () => ({ added: rescan() }));
route('POST', /^\/api\/projects$/, b => {
  const p = addProject(b.path, { explicit: true });
  if (!p) throw httpErr(409, 'Ten folder jest już na liście');
  return { id: p.id };
});
route('PATCH', /^\/api\/projects\/([\w-]+)$/, (b, q, m) => {
  const p = getProject(m[1]); p.edited = p.edited || {};
  for (const f of ['name', 'description', 'command']) {
    if (!(f in b)) continue;
    if (b[f] === null) { p.edited[f] = false; if (f === 'name') p.name = prettyName(p.path); else if (isDir(p.path)) refreshAuto(p); }
    else { p[f] = String(b[f]); p.edited[f] = true; }
  }
  save(); return {};
});
route('DELETE', /^\/api\/projects\/([\w-]+)$/, (b, q, m) => {
  const p = getProject(m[1]); killTree(running.get(p.id)); running.delete(p.id);
  db.projects = db.projects.filter(x => x !== p); save(); return {};
});
route('POST', /^\/api\/projects\/([\w-]+)\/relocate$/, (b, q, m) => {
  const p = getProject(m[1]); const d = norm(b.path);
  if (!isDir(d)) throw httpErr(400, 'Folder nie istnieje: ' + d);
  if (db.projects.some(o => o.id !== p.id && key(o.path) === key(d))) throw httpErr(409, 'Ta ścieżka należy do innego projektu');
  const mk = readMarker(d);
  if (mk && mk !== p.id && db.projects.some(o => o.id === mk)) throw httpErr(409, 'W tym folderze jest inny zarejestrowany projekt');
  p.path = d; writeMarker(d, p.id);
  p.edited = p.edited || {};
  if (!p.edited.name) p.name = prettyName(d);
  refreshAuto(p); refreshIdentity(p); sugCache.delete(p.id); save(); return {};
});
route('POST', /^\/api\/projects\/([\w-]+)\/start$/, (b, q, m) => { startProject(getProject(m[1])); return {}; });
route('POST', /^\/api\/projects\/([\w-]+)\/stop$/, (b, q, m) => { killTree(running.get(getProject(m[1]).id)); return {}; });
route('GET', /^\/api\/projects\/([\w-]+)\/log$/, (b, q, m) => {
  const r = running.get(getProject(m[1]).id);
  return r ? { text: r.log, alive: r.alive, exitCode: r.exitCode } : { text: '', alive: false, exitCode: null };
});

/* ---------- HTTP ---------- */
function guard(req) {
  // ochrona przed DNS rebinding i CSRF — serwer uruchamia komendy na dysku
  const host = req.headers.host || '';
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) throw httpErr(403, 'Niedozwolony Host');
  const origin = req.headers.origin;
  if (origin && origin !== 'http://' + host) throw httpErr(403, 'Niedozwolony Origin');
  if (req.method !== 'GET' && req.headers['x-launcher'] !== '1') throw httpErr(403, 'Brak nagłówka X-Launcher');
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 1e6) { reject(httpErr(413, 'Za duże żądanie')); req.destroy(); } });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(httpErr(400, 'Niepoprawny JSON')); } });
  });
}
const send = (res, status, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
};

const server = http.createServer(async (req, res) => {
  try {
    guard(req);
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
    }
    for (const [m, re, fn] of routes) {
      if (m !== req.method) continue;
      const mt = url.pathname.match(re);
      if (!mt) continue;
      const body = req.method === 'GET' ? {} : await readBody(req);
      return send(res, 200, await fn(body, url.searchParams, mt) || {});
    }
    send(res, 404, { error: 'Nie znaleziono' });
  } catch (e) {
    send(res, e.status || 500, { error: e.message || 'Błąd' });
  }
});

load();
for (const a of process.argv.slice(2)) { const d = norm(a); if (isDir(d) && !db.roots.some(r => key(r) === key(d))) db.roots.push(d); }
rescan();
server.listen(PORT, HOST, () => console.log(`Project Launcher: http://localhost:${PORT}  (dane: ${DATA_FILE})`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopAll(); setTimeout(() => process.exit(0), 300); });
process.on('exit', stopAll);
