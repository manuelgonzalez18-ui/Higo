import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { testPhpHttp } from '../tests/php/http-contracts.mjs';
const php = process.env.PHP_BIN || 'php';
function run(args) {
    return new Promise((resolve,reject) => {
        const child=spawn(php,args,{windowsHide:true}); let out=''; let err='';
        child.stdout.on('data',c=>out+=c); child.stderr.on('data',c=>err+=c);
        child.on('error',reject); child.on('exit',code=>code===0?resolve(out):reject(new Error(`${args.join(' ')}: ${err || out}`)));
    });
}
await testPhpHttp(php);
async function lint(dir) {
    for(const entry of await readdir(dir,{withFileTypes:true})) {
        const file=path.join(dir,entry.name);
        if(entry.isDirectory()) await lint(file);
        else if(entry.name.endsWith('.php')) await run(['-l',file]);
    }
}
await lint('public'); await lint('higodriver');
console.log('PHP syntax passed');
console.log((await run(['tests/php/quote-and-rate.php'])).trim());
const dir=await mkdtemp(path.join(tmpdir(),'higo-rate-test-'));
try {
    const counts=await Promise.all(Array.from({length:8},()=>run(['tests/php/rate-worker.php',dir])));
    assert.equal(counts.reduce((sum,value)=>sum+Number(value),0),10,'64 concurrent attempts must accept exactly 10');
    console.log('Atomic rate limiter: 64 attempts, exactly 10 accepted');
} finally {
    if(path.dirname(path.resolve(dir))!==path.resolve(tmpdir()) || !path.basename(dir).startsWith('higo-rate-test-')) throw new Error('Unsafe test cleanup path');
    await rm(dir,{recursive:true,force:true});
}
