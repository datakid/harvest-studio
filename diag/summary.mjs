import fs from 'node:fs';
const [, , oldDir, newDir, fihDir] = process.argv;
const read = (d) => {
  try {
    return JSON.parse(fs.readFileSync(d + '/harvest-report.json', 'utf8'));
  } catch (e) {
    return null;
  }
};
const index = (r) => new Map(((r && r.items) || []).map((i) => [i.key, i]));
const o = index(read(oldDir));
const n = index(read(newDir));
const f = read(fihDir);
const line = (i) => (i ? i.status + (i.source ? ' via ' + (i.source.type || '') : '') + (i.error ? ' | ' + String(i.error).slice(0, 110) : '') : 'missing');
console.log('LAUNCHER LINKS (34 targets), same list, same runner');
const count = (m) => [...m.values()].reduce((a, i) => ((a[i.status] = (a[i.status] || 0) + 1), a), {});
console.log('old:', JSON.stringify(count(o)));
console.log('new:', JSON.stringify(count(n)));
for (const k of new Set([...o.keys(), ...n.keys()])) {
  const a = o.get(k);
  const b = n.get(k);
  const same = a && b && a.status === b.status;
  console.log((same ? '  same ' : '  DIFF ') + k.padEnd(34) + ' old: ' + line(a) + '\n' + ' '.repeat(43) + ' new: ' + line(b));
}
if (f) {
  console.log('\nFIHRIST SET (new code only)');
  console.log(JSON.stringify(f.summary));
  for (const i of f.items) if (i.status !== 'found') console.log('  ' + i.key.padEnd(34) + ' ' + line(i) + '\n      attempts: ' + JSON.stringify((i.attempts || []).slice(0, 6)).slice(0, 400));
}
