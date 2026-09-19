import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve('dist');
const sha = process.env.VITE_GIT_SHA;
if (!/^[a-f0-9]{40}$/i.test(sha || '')) throw new Error('VITE_GIT_SHA must be the tested commit');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const gradle = await readFile('android/app/build.gradle', 'utf8');
const androidVersion = gradle.match(/\bversionName\s+"([^"]+)"/)?.[1];
const androidVersionCode = Number(gradle.match(/\bversionCode\s+(\d+)/)?.[1]);
if (!androidVersion || !Number.isInteger(androidVersionCode)) throw new Error('Android release version is missing');
if (!['staging', 'production'].includes(process.env.VITE_APP_ENV)) throw new Error('A release artifact must target staging or production');
const files = {};
async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(absolute);
        else if (entry.isFile() && entry.name !== 'release.json') {
            const relative = path.relative(root, absolute).split(path.sep).join('/');
            if (/(^|\/)(\.env[^/]*|\.user\.ini|_smtp_config\.php|service-account\.json)$/.test(relative)) {
                throw new Error(`${relative} is private configuration and must not enter a release`);
            }
            files[relative] = createHash('sha256').update(await readFile(absolute)).digest('hex');
        } else if (!entry.isFile()) {
            throw new Error('Release artifacts cannot contain symlinks or special files');
        }
    }
}
await visit(root);
if (!files['index.html']) throw new Error('Release must include index.html');
await writeFile(path.join(root, 'release.json'), JSON.stringify({ sha, version: pkg.version, androidVersion, androidVersionCode, environment: process.env.VITE_APP_ENV, files }, null, 2) + '\n');
console.log(`Release ${pkg.version} ${sha}: ${Object.keys(files).length} hashed files`);
