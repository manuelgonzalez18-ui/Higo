import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const root = path.resolve('dist');
const manifestBytes = await readFile(path.join(root, 'release.json'));
const manifest = JSON.parse(manifestBytes);
if (manifest.sha !== process.env.RELEASE_SHA || !/^[a-f0-9]{40}$/i.test(manifest.sha)) throw new Error('Artifact SHA mismatch');
if (!['staging', 'production'].includes(manifest.environment) || manifest.environment !== process.env.RELEASE_ENVIRONMENT) throw new Error('Artifact environment mismatch');
const expected = manifest.files;
if (!expected || !expected['index.html'] || !expected['.htaccess']) throw new Error('Incomplete release manifest');
const found = new Set();
async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(absolute);
        else if (entry.isFile()) {
            const relative = path.relative(root, absolute).split(path.sep).join('/');
            if (relative === 'release.json') continue;
            if (!expected[relative] || hash(await readFile(absolute)) !== expected[relative]) throw new Error(`Artifact checksum mismatch: ${relative}`);
            found.add(relative);
        } else throw new Error('Artifact contains an unsupported filesystem entry');
    }
}
await visit(root);
if (found.size !== Object.keys(expected).length) throw new Error('Artifact file inventory mismatch');
if (process.argv.includes('--remote')) {
    const origin = new URL(process.env.PUBLIC_BASE_URL);
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/') throw new Error('Invalid public release origin');
    async function fetchVerified(relative, expectedHash) {
        const url = new URL(relative, origin);
        if (url.origin !== origin.origin) throw new Error('Unexpected external release asset');
        url.searchParams.set('release', manifest.sha);
        const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { 'Cache-Control': 'no-cache' } });
        if (!response.ok || hash(Buffer.from(await response.arrayBuffer())) !== expectedHash) throw new Error(`Public release content mismatch: ${relative}`);
    }
    await fetchVerified('release.json', hash(manifestBytes));
    await fetchVerified('index.html', expected['index.html']);
    const html = await readFile(path.join(root, 'index.html'), 'utf8');
    const assets = [...html.matchAll(/(?:src|href)=["'](\.?\/?assets\/[^"']+\.(?:js|css))["']/g)].map((match) => match[1].replace(/^\.?\//, ''));
    if (!assets.some((asset) => asset.endsWith('.js'))) throw new Error('Release has no entry JavaScript');
    for (const asset of new Set(assets)) {
        if (!expected[asset]) throw new Error('HTML references an untracked release asset');
        await fetchVerified(asset, expected[asset]);
    }
}
console.log(`Verified ${manifest.environment} artifact ${manifest.sha} (${found.size} files)`);
