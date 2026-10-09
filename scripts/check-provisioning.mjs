import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const problems = [];

// 1. every compose image is pinned by digest (profile services included)
const compose = readFileSync(join(root, 'docker-compose.yml'), 'utf8');
for (const [, image] of compose.matchAll(/^\s+image:\s*(\S+)/gm)) {
  if (!/@sha256:[0-9a-f]{64}$/.test(image)) {
    problems.push(`compose image not pinned by digest: ${image}`);
  }
}

// 2. dashboards are valid JSON, carry a uid and reference no external URL
const dir = join(root, 'observability/grafana/dashboards');
for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
  const text = readFileSync(join(dir, file), 'utf8');
  try {
    const dashboard = JSON.parse(text);
    if (!dashboard.uid) problems.push(`${file}: missing uid`);
  } catch (error) {
    problems.push(`${file}: invalid JSON (${error.message})`);
  }
  if (/https?:\/\//.test(text)) problems.push(`${file}: contains an external URL`);
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('observability provisioning OK');
