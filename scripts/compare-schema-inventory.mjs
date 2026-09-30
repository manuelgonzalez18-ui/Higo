import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
    }
    return value;
}

function indexInventory(inventory) {
    if (inventory?.formatVersion !== 1 || !Array.isArray(inventory.objects)
        || typeof inventory.scope !== 'string' || !inventory.scope
        || typeof inventory.serverVersion !== 'string' || !inventory.serverVersion) throw new Error('Unsupported or incomplete schema inventory');
    if (!inventory.objects.length) throw new Error('Empty inventories cannot validate a schema');
    const result = new Map();
    for (const object of inventory.objects) {
        if (typeof object.kind !== 'string' || !object.kind || typeof object.key !== 'string' || !object.key
            || !object.signature || typeof object.signature !== 'object'
            || Array.isArray(object.signature)) throw new Error('Invalid schema object');
        const id = JSON.stringify([object.kind, object.key]);
        if (result.has(id)) throw new Error(`Duplicate schema object: ${object.kind} ${object.key}`);
        result.set(id, object);
    }
    return result;
}

export function compareInventories(reference, candidate) {
    const expected = indexInventory(reference);
    const actual = indexInventory(candidate);
    if (reference.scope !== candidate.scope) throw new Error('Inventory scopes must match');
    const changes = [];
    let matched = 0;
    for (const [id, before] of expected) {
        const after = actual.get(id);
        if (!after) {
            changes.push({ kind: before.kind, key: before.key, status: 'missing_in_candidate' });
            continue;
        }
        const fields = [...new Set([...Object.keys(before.signature), ...Object.keys(after.signature)])]
            .filter(field => JSON.stringify(stable(before.signature[field])) !== JSON.stringify(stable(after.signature[field])))
            .sort();
        if (fields.length) changes.push({ kind: before.kind, key: before.key, status: 'different', fields });
        else matched++;
    }
    for (const [id, after] of actual) {
        if (!expected.has(id)) changes.push({ kind: after.kind, key: after.key, status: 'extra_in_candidate' });
    }
    changes.sort((a, b) => JSON.stringify([a.kind, a.key]).localeCompare(JSON.stringify([b.kind, b.key])));
    return {
        formatVersion: 1,
        scope: reference.scope,
        referenceVersion: reference.serverVersion,
        candidateVersion: candidate.serverVersion,
        serverVersionDiffers: reference.serverVersion !== candidate.serverVersion,
        matched,
        changes,
        restorableBaselineVerified: false,
        limitation: 'Catalog comparison only. It does not verify row seeds, migration side effects, external services, secrets, files or restoration. Never repair migration history automatically from this result.',
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [referencePath, candidatePath, outputPath, ...extra] = process.argv.slice(2);
    if (!referencePath || !candidatePath || !outputPath || extra.length) {
        throw new Error('Usage: node scripts/compare-schema-inventory.mjs reference.json candidate.json report.json');
    }
    const [reference, candidate] = await Promise.all([referencePath, candidatePath].map(async file => JSON.parse(await readFile(file, 'utf8'))));
    const report = compareInventories(reference, candidate);
    await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
    console.log(`${report.matched} matching objects; ${report.changes.length} differences. Restorable baseline remains unverified.`);
    if (report.changes.length) process.exitCode = 2;
}
