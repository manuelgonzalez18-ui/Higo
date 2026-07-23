import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const MIGRATION_DIR = path.resolve('supabase/migrations');
const HARDENING_PREFIX = '202607241';
const filenamePattern = /^(\d{14})_[a-z0-9_]+\.sql$/;

const files = (await readdir(MIGRATION_DIR))
    .filter((name) => name.endsWith('.sql'))
    .sort();

const errors = [];
const timestamps = new Map();

for (const filename of files) {
    const match = filename.match(filenamePattern);
    if (!match) {
        errors.push(`${filename}: nombre inválido; usar YYYYMMDDHHMMSS_descripcion.sql`);
        continue;
    }

    const timestamp = match[1];
    if (timestamps.has(timestamp)) {
        errors.push(`${filename}: timestamp duplicado con ${timestamps.get(timestamp)}`);
    } else {
        timestamps.set(timestamp, filename);
    }

    const sql = await readFile(path.join(MIGRATION_DIR, filename), 'utf8');
    const normalized = sql.replace(/--.*$/gm, '').trim();

    const dollarPairs = (normalized.match(/\$\$/g) || []).length;
    if (dollarPairs % 2 !== 0) {
        errors.push(`${filename}: cantidad impar de delimitadores $$ (${dollarPairs})`);
    }

    const taggedDollarTokens = [...normalized.matchAll(/\$([a-zA-Z_][a-zA-Z0-9_]*)\$/g)]
        .map((entry) => entry[0]);
    const taggedCounts = taggedDollarTokens.reduce((counts, token) => {
        counts.set(token, (counts.get(token) || 0) + 1);
        return counts;
    }, new Map());
    for (const [token, count] of taggedCounts) {
        if (count % 2 !== 0) errors.push(`${filename}: delimitador ${token} sin pareja`);
    }

    if (filename.startsWith(HARDENING_PREFIX)) {
        if (!/^begin\s*;/im.test(normalized)) {
            errors.push(`${filename}: migración de hardening sin BEGIN`);
        }
        if (!/commit\s*;\s*$/i.test(normalized)) {
            errors.push(`${filename}: migración de hardening sin COMMIT final`);
        }
        if (/\bdrop\s+(table|schema|column)\b/i.test(normalized)) {
            errors.push(`${filename}: operación destructiva no permitida en rollout aditivo`);
        }
    }

    if (/security\s+definer/i.test(normalized) && !/set\s+search_path\s*=\s*public/i.test(normalized)) {
        errors.push(`${filename}: SECURITY DEFINER sin SET search_path = public`);
    }
}

if (errors.length) {
    console.error('Migration validation failed:\n');
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
}

console.log(`✓ ${files.length} migrations validated; timestamps and hardening structure are consistent.`);
