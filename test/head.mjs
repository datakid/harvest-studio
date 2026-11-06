import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { check, finish, studioDir } from './util.mjs';
import { readHead, headScanner, HEAD_LIMIT } from '../core/index.js';
import { bookImage, bmpFrame, buildIco } from './ico-fixtures.mjs';

const enc = new TextEncoder();
const webStream = (chunks) => {
  const state = { pulled: 0, cancelled: false };
  let i = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) return controller.close();
      state.pulled++;
      controller.enqueue(enc.encode(chunks[i++]));
    },
    cancel() {
      state.cancelled = true;
    }
  });
  return { stream, state };
};

await check('the head scanner finds the closing tag across chunks and in any case', () => {
  const seen = headScanner();
  assert.equal(seen(enc.encode('<head></he')), false);
  assert.equal(seen(enc.encode('AD><body>')), true);
});

await check('readHead stops at the closing head tag and cancels the stream', async () => {
  const { stream, state } = webStream(['<html><head>', '<link rel="icon" href="/i.ico">', '</head><body>', ...Array.from({ length: 50 }, () => 'b'.repeat(8192))]);
  const bytes = await readHead(stream);
  assert.ok(new TextDecoder().decode(bytes).includes('</head>'));
  assert.ok(state.pulled <= 4);
  assert.equal(state.cancelled, true);
});

await check('readHead stops at the limit when no closing tag arrives', async () => {
  const { stream } = webStream(Array.from({ length: 60 }, () => 'c'.repeat(8192)));
  const bytes = await readHead(stream);
  assert.equal(bytes.length, HEAD_LIMIT);
});

await check('readHead reads a short body to the end', async () => {
  const { stream } = webStream(['<html>', 'tiny']);
  assert.equal(new TextDecoder().decode(await readHead(stream)), '<html>tiny');
});

await check('readHead accepts node streams as well', async () => {
  const { Readable } = await import('node:stream');
  const bytes = await readHead(Readable.from([Buffer.from('<head></head><body>'), Buffer.from('rest')]));
  assert.ok(new TextDecoder().decode(bytes).startsWith('<head></head>'));
});

await check('the CLI stops downloading a large page once it has the head', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hs-head-'));
  const ico = buildIco([bmpFrame(bookImage(48), { bpp: 32 })]);
  const state = { pageWritten: 0, pageClosedEarly: false, iconServed: false };
  const server = http.createServer((req, res) => {
    if (req.url === '/favicon.ico') {
      state.iconServed = true;
      res.writeHead(200, { 'content-type': 'image/vnd.microsoft.icon' });
      return res.end(Buffer.from(ico));
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.write('<!DOCTYPE html><!-- Netlify --><html><head><link rel="icon" type="image/x-icon" href="favicon.ico"></head><body>');
    let n = 0;
    const timer = setInterval(() => {
      if (res.destroyed || n >= 200) {
        clearInterval(timer);
        if (n < 200) state.pageClosedEarly = true;
        return;
      }
      n++;
      state.pageWritten += 16 * 1024;
      res.write('p'.repeat(16 * 1024));
    }, 5);
    res.on('close', () => {
      clearInterval(timer);
      if (n < 200) state.pageClosedEarly = true;
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  await fs.writeFile(path.join(dir, 'links.json'), JSON.stringify({ categories: [{ id: 'core', label: 'Core', apps: [{ id: 'protocols', title: 'Protocols', url }] }] }));
  const cli = path.join(studioDir, 'cli', 'harvest.mjs');
  const child = spawn(process.execPath, [cli, '--out', path.join(dir, 'out')], { cwd: dir });
  const code = await new Promise((r) => child.on('close', r));
  server.close();
  assert.equal(code, 0);
  assert.equal(state.iconServed, true);
  assert.equal(state.pageClosedEarly, true);
  assert.ok(state.pageWritten < 200 * 16 * 1024, 'page written ' + state.pageWritten);
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'out', 'manifest.v2.json'), 'utf8'));
  assert.equal(manifest.icons.protocols.status, 'found');
});

finish();
