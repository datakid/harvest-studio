import assert from 'node:assert/strict';
import http from 'node:http';
import { check, finish } from './util.mjs';
import { defaultRequest } from '../api/fetch.js';

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/plain');
  res.end('icon bytes');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const read = async (res) => {
  const chunks = [];
  for await (const c of res.body) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
};

await check('T11.1 the proxy reaches the pinned address with the real request function', async () => {
  const res = await defaultRequest({ url: new URL('http://pinned.test:' + port + '/'), address: '127.0.0.1', family: 4, headers: {}, timeoutMs: 4000 });
  assert.equal(res.status, 200);
  assert.equal(await read(res), 'icon bytes');
});

await check('T11.2 the pinned address is used even when the host name does not resolve', async () => {
  const res = await defaultRequest({ url: new URL('http://does-not-exist.invalid:' + port + '/x'), address: '127.0.0.1', family: 4, headers: { accept: '*/*' }, timeoutMs: 4000 });
  assert.equal(res.status, 200);
  res.destroy();
});

server.close();
finish();
