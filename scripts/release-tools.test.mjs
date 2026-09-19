import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const manifestScript = fileURLToPath(new URL('./release-manifest.mjs', import.meta.url));
const verifyScript = fileURLToPath(new URL('./verify-release.mjs', import.meta.url));
const sha = 'a'.repeat(40);

async function fixture(t) {
    const directory = await mkdtemp(path.join(tmpdir(), 'higo-release-test-'));
    t.after(async () => {
        assert.equal(path.dirname(directory), path.resolve(tmpdir()));
        assert.ok(path.basename(directory).startsWith('higo-release-test-'));
        await rm(directory, { recursive: true, force: true });
    });
    await mkdir(path.join(directory, 'dist/assets'), { recursive: true });
    await mkdir(path.join(directory, 'android/app'), { recursive: true });
    await writeFile(path.join(directory, 'package.json'), '{"version":"1.2.3"}');
    await writeFile(path.join(directory, 'android/app/build.gradle'), 'versionName "1.2.4"\nversionCode 12\n');
    await writeFile(path.join(directory, 'dist/.htaccess'), 'Options -Indexes\n');
    await writeFile(path.join(directory, 'dist/index.html'), '<html><script src="./assets/index-123.js"></script><link href="./assets/style-123.css" rel="stylesheet"></html>');
    await writeFile(path.join(directory, 'dist/assets/index-123.js'), 'console.log("release fixture");');
    await writeFile(path.join(directory, 'dist/assets/style-123.css'), 'body{color:red}');
    const env = { ...process.env, VITE_GIT_SHA: sha, VITE_APP_ENV: 'staging', RELEASE_SHA: sha, RELEASE_ENVIRONMENT: 'staging' };
    function run(script, overrides = {}, args = []) {
        const result = spawnSync(process.execPath, [...args, script], { cwd: directory, env: { ...env, ...overrides }, encoding: 'utf8', windowsHide: true });
        assert.ifError(result.error);
        return result;
    }
    assert.equal(run(manifestScript).status, 0);
    return { directory, run };
}

test('release inventory preserves SHA, environment, native version and path hashes', async (t) => {
    const { directory, run } = await fixture(t);
    const manifest = JSON.parse(await readFile(path.join(directory, 'dist/release.json'), 'utf8'));
    assert.equal(manifest.sha, sha);
    assert.equal(manifest.androidVersion, '1.2.4');
    assert.equal(manifest.androidVersionCode, 12);
    assert.match(manifest.files['assets/index-123.js'], /^[0-9a-f]{64}$/);
    assert.equal(run(verifyScript).status, 0);
    assert.notEqual(run(verifyScript, { RELEASE_SHA: 'b'.repeat(40) }).status, 0);
    assert.notEqual(run(verifyScript, { RELEASE_ENVIRONMENT: 'production' }).status, 0);
});

test('release verification rejects edited, added and missing files', async (t) => {
    const { directory, run } = await fixture(t);
    const file = path.join(directory, 'dist/assets/index-123.js');
    const original = await readFile(file);
    await writeFile(file, 'tampered');
    assert.match(run(verifyScript).stderr, /checksum mismatch/);
    await writeFile(file, original);
    const extra = path.join(directory, 'dist/untracked.php');
    await writeFile(extra, '<?php echo "not in approved artifact";');
    assert.match(run(verifyScript).stderr, /checksum mismatch/);
    await rm(extra);
    await rm(file);
    assert.match(run(verifyScript).stderr, /inventory mismatch/);
});

test('manifest rejects bundled private configuration and non-release environments', async (t) => {
    const { directory, run } = await fixture(t);
    assert.notEqual(run(manifestScript, { VITE_APP_ENV: 'test' }).status, 0);
    await writeFile(path.join(directory, 'dist/.env'), 'EXAMPLE_SECRET=synthetic');
    assert.match(run(manifestScript).stderr, /private configuration/);
});

test('public verification checks HTML and entry assets without real network requests', async (t) => {
    const { directory } = await fixture(t);
    const preload = path.join(directory, 'mock-fetch.mjs');
    await writeFile(preload, `import { readFile } from 'node:fs/promises';
globalThis.fetch = async (url, options) => {
  if(options.redirect !== 'error' || url.origin !== 'https://staging.example.test') throw Error('Unexpected request');
  const relative=url.pathname.slice(1);
  const bytes=process.env.TAMPER_REMOTE===relative ? 'stale content' : await readFile('dist/'+relative);
  return new Response(bytes, {status:200});
};`);
    function remote(tamper = '') {
        const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, verifyScript, '--remote'], {
            cwd: directory, encoding: 'utf8', windowsHide: true,
            env: { ...process.env, RELEASE_SHA: sha, RELEASE_ENVIRONMENT: 'staging', PUBLIC_BASE_URL: 'https://staging.example.test', TAMPER_REMOTE: tamper },
        });
        assert.ifError(result.error);
        return result;
    }
    const valid = remote();
    assert.equal(valid.status, 0, valid.stderr);
    for (const file of ['release.json', 'index.html', 'assets/index-123.js', 'assets/style-123.css']) {
        assert.match(remote(file).stderr, /Public release content mismatch/);
    }
});
