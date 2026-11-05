import fs from 'node:fs/promises';
import path from 'node:path';
import { buildTargets, buildFihristTargets, extrasToTargets, mergeTargets } from '../core/targets.js';

const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));

const hostnameOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};

export const knownHostsFile = (root) => path.join(root, 'api', 'known-hosts.json');

export const buildKnownHosts = async (root) => {
  const config = path.join(root, 'config');
  const catalogue = await readJson(path.join(config, 'catalogue.json'));
  const extras = await readJson(path.join(config, 'extras.json'));
  const fihrist = await readJson(path.join(config, 'fihrist.json'));
  const cdn = await readJson(path.join(config, 'proxy-cdn.json'));
  const targets = [...mergeTargets(buildTargets(catalogue), extrasToTargets(extras)), ...buildFihristTargets(fihrist)];
  const hosts = [...new Set(targets.map((t) => hostnameOf(t.url)).filter(Boolean))].sort();
  return JSON.stringify({ hosts, cdn: [...new Set(cdn.map((h) => String(h).toLowerCase()))].sort() }, null, 2) + '\n';
};

export const writeKnownHosts = async (root) => {
  const text = await buildKnownHosts(root);
  await fs.writeFile(knownHostsFile(root), text);
  return text;
};
