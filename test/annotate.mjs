const escapeData = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProp = (s) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

export const annotate = (file, text) => {
  const lines = text.split('\n');
  const failures = [];
  lines.forEach((line, i) => {
    if (!line.startsWith('FAIL')) return;
    const detail = [];
    for (let j = i + 1; j < lines.length && !/^(PASS|FAIL|\d+ passed)/.test(lines[j]) && detail.length < 10; j++) if (lines[j].trim() !== '') detail.push(lines[j].trim());
    failures.push([line, ...detail].join('\n'));
  });
  const messages = failures.length ? failures : [lines.filter((l) => l.trim() !== '').slice(-15).join('\n')];
  return messages.map((m) => '::error file=test/' + escapeProp(file) + ',title=' + escapeProp(file) + '::' + escapeData(m.slice(0, 1500)));
};
