const orig = globalThis.fetch;
let n = 0;
let heads = 0;
globalThis.fetch = (...a) => {
  n++;
  return orig(...a);
};
process.on('exit', () => console.error('FETCH_COUNT ' + n));
