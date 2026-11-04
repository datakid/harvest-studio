import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';
import { check, finish, studioDir, fixturesDir } from './util.mjs';
import { diffLinks } from '../cli/diff-links.mjs';
import { manifestHash, shouldOpenPr, prBody } from '../cli/workflow.mjs';

const fx = (name) => path.join(studioDir, 'test', 'workflow-fixtures', name);
const node = (script, args, options = {}) => spawnSync(process.execPath, [path.join(studioDir, 'cli', script), ...args], { encoding: 'utf8', ...options });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hs-wf-'));

await check('T7.1 diff-links reports added, changed and removed keys, and a labels-only edit changes no icon', () => {
  const r = node('diff-links.mjs', ['--base-file', fx('links-base.json'), '--head-file', fx('links-head.json')]);
  assert.equal(r.status, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.deepEqual(d.added, ['epsilon', 'gamma--three']);
  assert.deepEqual(d.changed, ['alpha', 'beta']);
  assert.deepEqual(d.removed, ['delta', 'gamma--two']);
  assert.equal(d.renamedOnly, false);
  assert.deepEqual(d.only, ['alpha', 'beta', 'epsilon', 'gamma--three']);
  const l = JSON.parse(node('diff-links.mjs', ['--base-file', fx('links-base.json'), '--head-file', fx('links-labels.json')]).stdout);
  assert.equal(l.renamedOnly, true);
  assert.deepEqual([l.added, l.changed, l.removed, l.only], [[], [], [], []]);
  const none = JSON.parse(node('diff-links.mjs', ['--base-file', fx('links-base.json'), '--head-file', fx('links-base.json')]).stdout);
  assert.equal(none.renamedOnly, false);
  const full = JSON.parse(node('diff-links.mjs', ['--head-file', fx('links-head.json')]).stdout);
  assert.equal(full.full, true);
  assert.equal(full.only.length, 5);
});

await check('T7.1 diff-links reads the two versions from git, and treats a missing or all-zero base as a full refresh', () => {
  const dir = tmp();
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'a@b.c');
  git('config', 'user.name', 't');
  fs.copyFileSync(fx('links-base.json'), path.join(dir, 'links.json'));
  git('add', '.');
  git('commit', '-q', '-m', 'one');
  const first = git('rev-parse', 'HEAD').stdout.trim();
  fs.copyFileSync(fx('links-head.json'), path.join(dir, 'links.json'));
  git('commit', '-qam', 'two');
  const second = git('rev-parse', 'HEAD').stdout.trim();
  const run = (base) => JSON.parse(node('diff-links.mjs', ['--base', base, '--head', second, '--links', 'links.json'], { cwd: dir }).stdout);
  assert.deepEqual(run(first).changed, ['alpha', 'beta']);
  assert.equal(run('0000000000000000000000000000000000000000').full, true);
  assert.equal(run('').full, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

await check('T7.1 a fihrist file is diffed with the fihrist builder', () => {
  const data = JSON.parse(fs.readFileSync(path.join(studioDir, 'config', 'fihrist.json'), 'utf8'));
  const edited = JSON.parse(JSON.stringify(data));
  edited.tools[0].en = 'Renamed';
  assert.equal(diffLinks(data, edited, 'fihrist').renamedOnly, true);
  const moved = JSON.parse(JSON.stringify(data));
  const target = moved.tools.find((t) => typeof t.url === 'string');
  target.url = 'https://moved.example.com/';
  assert.deepEqual(diffLinks(data, moved, 'fihrist').changed, [target.id]);
});

const fihristOut = tmp();
await check('T7.2 the CLI with --set fihrist writes a valid manifest from fixtures', async () => {
  const r = node('harvest.mjs', ['--set', 'fihrist', '--links', path.join(studioDir, 'config', 'fihrist.json'), '--from', fixturesDir, '--out', fihristOut]);
  assert.equal(r.status, 0, r.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(fihristOut, 'manifest.v2.json'), 'utf8'));
  const { default: Ajv } = await import('ajv');
  const schema = JSON.parse(fs.readFileSync(path.join(studioDir, 'config', 'manifest.v2.schema.json'), 'utf8'));
  const ajv = new Ajv({ strict: false, allErrors: true });
  (await import('ajv-formats')).default(ajv);
  const ok = ajv.validate(schema, manifest);
  assert.ok(ok, JSON.stringify(ajv.errors));
  const keys = Object.keys(manifest.icons);
  assert.ok(keys.length > 0);
  const data = JSON.parse(fs.readFileSync(path.join(studioDir, 'config', 'fihrist.json'), 'utf8'));
  const ids = new Set(data.tools.map((t) => t.id));
  for (const k of keys) assert.ok(ids.has(k.split('--')[0]), k);
  const bad = node('harvest.mjs', ['--set', 'fihrist', '--links', path.join(studioDir, 'config', 'catalogue.json'), '--from', fixturesDir, '--out', tmp()]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /links file is invalid/);
});

await check('T7.3 a second run with no input change keeps the manifest hash and opens no pull request', () => {
  const before = manifestHash(fihristOut);
  assert.match(before, /^[0-9a-f]{8}$/);
  const r = node('harvest.mjs', ['--set', 'fihrist', '--links', path.join(studioDir, 'config', 'fihrist.json'), '--from', fixturesDir, '--out', fihristOut, '--only', 'none']);
  assert.equal(r.status, 0, r.stderr);
  const after = manifestHash(fihristOut);
  assert.equal(after, before);
  assert.equal(shouldOpenPr(before, after), false);
  assert.equal(shouldOpenPr(before, 'ffffffff'), true);
  assert.equal(shouldOpenPr(null, after), true);
  assert.equal(shouldOpenPr(before, null), false);
  assert.equal(node('workflow.mjs', ['hash', '--dir', fihristOut]).stdout.trim(), before);
  assert.equal(node('workflow.mjs', ['should-open', '--before', before, '--after', after]).stdout.trim(), 'false');
  assert.equal(node('workflow.mjs', ['should-open', '--before', 'none', '--after', after]).stdout.trim(), 'true');
});

const workflow = YAML.parse(fs.readFileSync(path.join(studioDir, '.github', 'workflows', 'harvest-icons.yml'), 'utf8'));

await check('T7.4 the reusable workflow parses and declares its inputs, concurrency and least-privilege permissions', () => {
  const inputs = workflow.on.workflow_call.inputs;
  for (const name of ['set', 'links-path', 'icons-dir', 'base-sha', 'head-sha']) assert.ok(inputs[name], name);
  assert.equal(inputs.set.required, true);
  assert.match(workflow.concurrency.group, /harvest-icons-\$\{\{ github\.repository \}\}/);
  assert.equal(workflow.concurrency['cancel-in-progress'], true);
  assert.deepEqual(workflow.permissions, { contents: 'write', 'pull-requests': 'write' });
  assert.ok(!JSON.stringify(workflow).includes('write-all'));
  const steps = workflow.jobs.harvest.steps;
  const studio = steps.find((s) => s.with && s.with.repository === 'datakid/harvest-studio');
  assert.equal(studio.with.ref, '${{ inputs.studio-ref }}');
  assert.match(workflow.on.workflow_call.inputs['studio-ref'].default, /^v\d+\.\d+\.\d+$/);
  const text = JSON.stringify(workflow.jobs.harvest.steps.map((s) => s.run || ''));
  for (const piece of ['diff-links.mjs', 'harvest.mjs', '--only', 'should-open', 'workflow.mjs', 'force-with-lease', 'gh pr create', 'gh pr edit']) assert.ok(text.includes(piece), piece);
  assert.ok(steps.some((s) => s.uses && s.uses.startsWith('actions/upload-artifact') && s.if && /always\(\)/.test(s.if)));
});

await check('T7.4 the caller examples pin a release, pass every input and cover push, dispatch and schedule', () => {
  for (const [file, set] of [['launcher-icons.yml', 'launcher'], ['fihrist-icons.yml', 'fihrist']]) {
    const caller = YAML.parse(fs.readFileSync(path.join(studioDir, 'docs', 'callers', file), 'utf8'));
    const job = Object.values(caller.jobs)[0];
    assert.match(job.uses, /^datakid\/harvest-studio\/\.github\/workflows\/harvest-icons\.yml@v\d+\.\d+\.\d+$/);
    for (const name of ['set', 'links-path', 'icons-dir', 'base-sha', 'head-sha']) assert.ok(job.with[name], name);
    assert.equal(job.with.set, set);
    assert.deepEqual(job.permissions, { contents: 'write', 'pull-requests': 'write' });
    assert.ok(caller.on.push && caller.on.workflow_dispatch !== undefined && caller.on.schedule);
  }
});

await check('T7.5 the pull request body lists added, changed and removed keys and the owner checklist', () => {
  const diff = JSON.parse(node('diff-links.mjs', ['--base-file', fx('links-base.json'), '--head-file', fx('links-head.json')]).stdout);
  const report = JSON.parse(fs.readFileSync(fx('report.json'), 'utf8'));
  const body = prBody({ set: 'launcher', diff, report, artifactUrl: 'https://example.com/artifact/1' });
  const snap = fx('pr-body.snap.md');
  if (process.env.UPDATE_SNAPSHOT) fs.writeFileSync(snap, body);
  assert.equal(body, fs.readFileSync(snap, 'utf8'));
  assert.match(body, /\*\*Added:\*\* `epsilon`, `gamma--three`/);
  assert.match(body, /- \[ \] `epsilon`: blocked/);
  const out = tmp();
  const diffFile = path.join(out, 'diff.json');
  fs.writeFileSync(diffFile, JSON.stringify(diff));
  const r = node('workflow.mjs', ['body', '--set', 'launcher', '--diff', diffFile, '--report', fx('report.json'), '--artifact-url', 'https://example.com/artifact/1', '--out', path.join(out, 'body.md')]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(out, 'body.md'), 'utf8'), body);
});

finish();
