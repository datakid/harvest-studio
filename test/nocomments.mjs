import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { check, finish, studioDir } from './util.mjs';

const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do', 'yield', 'await', 'instanceof']);

export const jsComments = (src) => {
  const found = [];
  let i = 0;
  let line = 1;
  let prev = '';
  let prevWord = '';
  const braces = [];
  const note = (kind) => found.push({ kind, line });
  const bump = (ch) => {
    if (ch === '\n') line++;
  };
  if (src.startsWith('#!')) while (i < src.length && src[i] !== '\n') i++;
  const skipString = (quote) => {
    i++;
    while (i < src.length && src[i] !== quote) {
      if (src[i] === '\\') i++;
      bump(src[i]);
      i++;
    }
    i++;
  };
  const skipTemplate = () => {
    i++;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '`') {
        i++;
        return;
      }
      if (c === '$' && src[i + 1] === '{') {
        i += 2;
        braces.push(1);
        scan(true);
        continue;
      }
      bump(c);
      i++;
    }
  };
  const skipRegex = () => {
    i++;
    let inClass = false;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) break;
      else if (c === '\n') break;
      i++;
    }
    i++;
    while (i < src.length && /[a-z]/i.test(src[i])) i++;
  };
  const scan = (inTemplate) => {
    while (i < src.length) {
      const c = src[i];
      const n = src[i + 1];
      if (c === '\n') {
        line++;
        i++;
        continue;
      }
      if (c === '/' && n === '/') {
        note('line');
        while (i < src.length && src[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && n === '*') {
        note('block');
        i += 2;
        while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
          bump(src[i]);
          i++;
        }
        i += 2;
        continue;
      }
      if (c === '"' || c === "'") {
        skipString(c);
        prev = '"';
        prevWord = '';
        continue;
      }
      if (c === '`') {
        skipTemplate();
        prev = '"';
        prevWord = '';
        continue;
      }
      if (c === '/') {
        const regexAllowed = prev === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || REGEX_KEYWORDS.has(prevWord);
        if (regexAllowed) {
          skipRegex();
          prev = '"';
          prevWord = '';
          continue;
        }
        prev = '/';
        i++;
        continue;
      }
      if (inTemplate && c === '{') braces.push(0);
      if (inTemplate && c === '}') {
        const top = braces.pop();
        i++;
        if (top === 1) return;
        prev = '}';
        continue;
      }
      if (/[A-Za-z0-9_$]/.test(c)) {
        let j = i;
        while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j++;
        prevWord = src.slice(i, j);
        prev = 'a';
        i = j;
        continue;
      }
      if (!/\s/.test(c)) {
        prev = c;
        prevWord = '';
      }
      i++;
    }
  };
  scan(false);
  return found;
};

export const cssComments = (src) => {
  const found = [];
  let line = 1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\n') line++;
    else if (c === '"' || c === "'") {
      for (i++; i < src.length && src[i] !== c; i++) {
        if (src[i] === '\\') i++;
        if (src[i] === '\n') line++;
      }
    } else if (c === '/' && src[i + 1] === '*') {
      found.push({ kind: 'block', line });
      for (i += 2; i < src.length && !(src[i] === '*' && src[i + 1] === '/'); i++) if (src[i] === '\n') line++;
      i++;
    }
  }
  return found;
};

export const htmlComments = (src) => {
  const found = [];
  const lineAt = (offset) => src.slice(0, offset).split('\n').length;
  let rest = src;
  const re = /<(script|style)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  let m;
  while ((m = re.exec(src))) {
    const bodyStart = m.index + m[0].indexOf('>') + 1;
    const base = lineAt(bodyStart) - 1;
    const inner = m[1].toLowerCase() === 'script' ? jsComments(m[2]) : cssComments(m[2]);
    for (const f of inner) found.push({ kind: f.kind, line: f.line + base });
    rest = rest.slice(0, m.index) + m[0].replace(/[^\n]/g, ' ') + rest.slice(m.index + m[0].length);
  }
  for (const m2 of rest.matchAll(/<!--/g)) found.push({ kind: 'html', line: lineAt(m2.index) });
  return found;
};

export const yamlComments = (src) => {
  const found = [];
  src.split('\n').forEach((text, index) => {
    let quote = null;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === '\\' && quote === '"') i++;
        else if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '#' && (i === 0 || /\s/.test(text[i - 1]))) {
        found.push({ kind: 'hash', line: index + 1 });
        break;
      }
    }
  });
  return found;
};

const finder = (file) => {
  const ext = path.extname(file);
  if (ext === '.js' || ext === '.mjs') return jsComments;
  if (ext === '.css') return cssComments;
  if (ext === '.html') return htmlComments;
  if (ext === '.yml' || ext === '.yaml') return yamlComments;
  return null;
};

const ROOTS = ['src', 'core', 'cli', 'api', 'scripts', 'test', '.github'];
const SKIP = new Set(['node_modules', 'fixtures', 'sample-output']);

const walk = (dir) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (SKIP.has(e.name) ? [] : e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  await check('the comment finder is not fooled by urls, regex literals, strings and templates', () => {
    const clean = [
      "const a = 'http://x.test/a//b';",
      'const b = "https://x.test";',
      'const c = `http://${host}//path ${`inner // ${deep}`}`;',
      'const d = /https?:\\/\\/[^/]+\\/\\/x/gi;',
      'const e = x / y / z;',
      'const f = (a + b) / 2 / 3;',
      'return /\\/\\/foo/.test(s);',
      "const g = s.replace(/\\/\\*/g, '');",
      "const h = /[/]\\/*x/;",
      '#!/usr/bin/env node\nconst i = 1;'
    ];
    for (const src of clean) assert.deepEqual(jsComments(src), [], src);
    assert.equal(jsComments('const a = 1; // note').length, 1);
    assert.equal(jsComments('/* a */ const a = 1;').length, 1);
    assert.equal(jsComments('const a = `x ${1 /* hidden */}`;').length, 1);
    assert.equal(jsComments('const a = 1;\n\n  // later').at(0).line, 3);
    assert.equal(jsComments('x = a / b; // c').length, 1);
  });

  await check('the css, html and yaml finders see real comments only', () => {
    assert.deepEqual(cssComments('a { background: url("http://x.test/a.png"); content: "/* no */"; }'), []);
    assert.equal(cssComments('a { color: red; } /* note */').length, 1);
    assert.deepEqual(htmlComments('<p>http://x.test</p><script>const u = "http://x.test";</script>'), []);
    assert.equal(htmlComments('<p>a</p><!-- note -->').length, 1);
    assert.equal(htmlComments('<script>\n// note\n</script>').at(0).line, 2);
    assert.equal(htmlComments('<style>/* note */</style>').length, 1);
    assert.deepEqual(yamlComments('name: "a # b"\nrun: echo "$#"\nkey: value'), []);
    assert.equal(yamlComments('key: value # note').length, 1);
    assert.equal(yamlComments('# top').length, 1);
  });

  await check('T0.1 no source, test or workflow file contains a code comment', () => {
    const files = ROOTS.flatMap((r) => walk(path.join(studioDir, r))).filter((f) => finder(f));
    assert.ok(files.length > 40, 'only found ' + files.length + ' files');
    const hits = [];
    for (const file of files) for (const f of finder(file)(fs.readFileSync(file, 'utf8'))) hits.push(path.relative(studioDir, file) + ':' + f.line + ' ' + f.kind);
    assert.deepEqual(hits, []);
  });

  finish();
}
