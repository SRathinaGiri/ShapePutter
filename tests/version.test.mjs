// Every release must bump the version everywhere, including the service-worker cache name;
// otherwise installed PWAs keep serving the old cache. Ported from 3D Labyrinth. Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERSION } from '../js/config.js';

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const MODULES = ['app', 'config', 'levels', 'physics', 'rules', 'renderer', 'board', 'materials', 'controls', 'hud3d', 'audio', 'ui', 'link', 'pad', 'progress'];

test('version is identical in config, service worker, manifest, index.html and controller.html', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  const sw = read('sw.js').match(/CACHE_VERSION = 'shapeputter-v([\d.]+)'/);
  assert.ok(sw, 'CACHE_VERSION not found in sw.js');
  assert.equal(sw[1], VERSION, 'sw.js CACHE_VERSION not bumped');
  assert.equal(JSON.parse(read('manifest.json')).version, VERSION, 'manifest.json version not bumped');
  for (const page of ['index.html', 'controller.html']) {
    const html = read(page).replace(/peerjs\.min\.js\?v=[\d.]+/g, ''); // bundled library keeps its own version
    const tags = [...html.matchAll(/v=?(\d+\.\d+\.\d+)/g)].map(m => m[1]);
    assert.ok(tags.length >= 3, `expected version tags in ${page}`);
    for (const t of tags) assert.equal(t, VERSION, `${page} still references v${t}`);
  }
});

test('service worker pre-caches every JS module and the controller page', () => {
  const sw = read('sw.js');
  for (const m of MODULES) assert.ok(sw.includes(`'./js/${m}.js'`), `sw.js does not cache js/${m}.js`);
  assert.ok(sw.includes("'./controller.html'"), 'sw.js does not cache controller.html');
});

test('import maps pin every module to the current version (no stale-module mixing after updates)', () => {
  const html = read('index.html');
  const imports = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
  for (const mod of MODULES.filter(m => m !== 'app' && m !== 'pad')) {
    assert.equal(imports[`./js/${mod}.js`], `./js/${mod}.js?v=${VERSION}`, `import map entry for ${mod}.js`);
  }
  assert.ok(html.indexOf('type="importmap"') < html.indexOf('type="module"'), 'import map must come before the module script');
  const pad = read('controller.html');
  const padImports = JSON.parse(pad.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
  for (const mod of ['config', 'controls', 'link']) assert.equal(padImports[`./js/${mod}.js`], `./js/${mod}.js?v=${VERSION}`);
  assert.match(read('sw.js'), /cache: 'reload'/, 'service worker must pre-cache from the network');
});

test('every module a page imports is in its import map', () => {
  const check = (page, entry) => {
    const map = JSON.parse(read(page).match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
    const seen = new Set(), todo = [entry];
    while (todo.length) {
      const f = todo.pop();
      if (seen.has(f)) continue;
      seen.add(f);
      for (const m of read(`js/${f}.js`).matchAll(/from '\.\/(\w+)\.js'/g)) {
        assert.ok(map[`./js/${m[1]}.js`], `${page}: js/${m[1]}.js (imported by ${f}.js) is missing from the import map`);
        todo.push(m[1]);
      }
    }
  };
  check('index.html', 'app');
  check('controller.html', 'pad');
});

test('bundled PeerJS is the licensed npm build, loaded before the modules and cached', () => {
  const lib = read('js/lib/peerjs.min.js');
  const note = read('js/lib/peerjs.LICENSE.txt');
  assert.ok(note.includes('peerjs@1.5.5') && note.includes('MIT'), 'licence/provenance note missing');
  assert.ok(/window\.Peer=/.test(lib), 'not the PeerJS browser bundle');
  for (const page of ['index.html', 'controller.html']) {
    const html = read(page);
    assert.ok(html.indexOf('peerjs.min.js') > -1 && html.indexOf('peerjs.min.js') < html.indexOf('type="module"'), `${page} must load PeerJS before the game modules`);
  }
  assert.ok(read('sw.js').includes("'./js/lib/peerjs.min.js'"));
});

test('privacy: PeerJS TURN relays are switched off (STUN only)', () => {
  const link = read('js/link.js');
  assert.match(link, /config:\s*\{\s*iceServers:\s*LINK\.ICE\s*\}/, 'link.js must override PeerJS default iceServers');
  assert.doesNotMatch(link, /turn:/i, 'no TURN server may be configured without approval');
});

test('privacy: the only outside hosts are the approved pairing server and STUN', () => {
  // Approved for Shape Putter on 2026-10-23 (same as 3D Labyrinth): PeerJS public signalling + Google STUN.
  const allowed = new Set(['0.peerjs.com', 'stun.l.google.com']);
  const files = [...MODULES.map(m => `js/${m}.js`), 'sw.js', 'index.html', 'controller.html', 'css/styles.css'];
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/(?:wss?|https?|stun|turn):\/\/([a-z0-9.-]+)/gi)) {
      assert.ok(allowed.has(m[1].toLowerCase()), `${f} contacts an unapproved host: ${m[0]}`);
    }
    for (const m of src.matchAll(/(?:HOST|urls)\s*:\s*['"](?:stun:)?([a-z0-9.-]+)/gi)) {
      assert.ok(allowed.has(m[1].toLowerCase()), `${f} configures an unapproved host: ${m[1]}`);
    }
    assert.doesNotMatch(src, /fonts\.googleapis|cdnjs|jsdelivr|unpkg/i, `${f} loads something from a CDN`);
  }
});

test('PWA is installable: PNG 192/512 icons (any + maskable) exist, are listed and pre-cached', () => {
  const m = JSON.parse(read('manifest.json'));
  assert.equal(m.display, 'standalone');
  assert.ok(m.start_url && m.scope && m.id, 'start_url, scope and id required');
  const sw = read('sw.js');
  for (const purpose of ['any', 'maskable']) {
    for (const size of ['192x192', '512x512']) {
      const icon = m.icons.find(i => i.type === 'image/png' && i.sizes === size && i.purpose === purpose);
      assert.ok(icon, `manifest lacks a ${size} ${purpose} PNG icon`);
      const png = readFileSync(new URL(`../${icon.src.replace('./', '')}`, import.meta.url));
      assert.equal(png.readUInt32BE(16), +size.split('x')[0], `${icon.src} is not ${size}`);
      assert.ok(sw.includes(`'${icon.src}'`), `sw.js does not cache ${icon.src}`);
    }
  }
});

test('service worker only deletes its own old caches (other apps share the github.io origin)', () => {
  const sw = read('sw.js');
  const activate = sw.slice(sw.indexOf("addEventListener('activate'"), sw.indexOf("addEventListener('message'"));
  assert.match(activate, /startsWith\(CACHE_PREFIX\)/, 'activate must filter cache names by our prefix');
  assert.doesNotMatch(activate, /labyrinth/i, 'must never touch 3D Labyrinth caches');
  assert.match(sw, /CACHE_PREFIX = 'shapeputter-'/);
});
