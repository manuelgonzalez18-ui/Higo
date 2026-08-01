// migrate-storage.mjs — copia los archivos de Storage del proyecto Supabase
// VIEJO (Oregon) al NUEVO (São Paulo). Los blobs NO viajan en el dump SQL de la
// base, así que hay que copiarlos aparte. Este script es idempotente: si un
// archivo ya existe en el destino, lo saltea (upsert).
//
// Uso:
//   npm i @supabase/supabase-js         # si no está instalado global
//   SRC_URL="https://VIEJO.supabase.co"      \
//   SRC_SERVICE="<service_role del viejo>"    \
//   DST_URL="https://NUEVO.supabase.co"       \
//   DST_SERVICE="<service_role del nuevo>"    \
//   node scripts/migrate-storage.mjs
//
// Requiere las SERVICE_ROLE keys (no las anon) porque lista y baja archivos
// privados saltando RLS. NO commitear esas keys: se pasan por env var.
//
// Antes de correr: crear en el proyecto NUEVO los mismos buckets (mismo nombre y
// visibilidad público/privado) que en el viejo. Este script NO crea buckets;
// solo copia contenido, para que vos controles la config de cada bucket.

import { createClient } from '@supabase/supabase-js';

const { SRC_URL, SRC_SERVICE, DST_URL, DST_SERVICE } = process.env;

if (!SRC_URL || !SRC_SERVICE || !DST_URL || !DST_SERVICE) {
    console.error('Faltan env vars: SRC_URL, SRC_SERVICE, DST_URL, DST_SERVICE');
    process.exit(1);
}

// Buckets de Higo. Ajustá la lista si agregás/quitás buckets.
const BUCKETS = ['driver-docs', 'payment-receipts', 'delivery-pods', 'support-attachments'];

const src = createClient(SRC_URL, SRC_SERVICE, { auth: { persistSession: false } });
const dst = createClient(DST_URL, DST_SERVICE, { auth: { persistSession: false } });

// Lista recursiva de todos los objetos dentro de un prefijo del bucket.
async function listAll(client, bucket, prefix = '') {
    const out = [];
    let offset = 0;
    const limit = 100;
    for (;;) {
        const { data, error } = await client.storage.from(bucket).list(prefix, {
            limit,
            offset,
            sortBy: { column: 'name', order: 'asc' },
        });
        if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
        if (!data || data.length === 0) break;

        for (const entry of data) {
            const path = prefix ? `${prefix}/${entry.name}` : entry.name;
            // Heurística: si no tiene id ni metadata, es una "carpeta" → recursar.
            if (entry.id === null || entry.metadata === null) {
                const nested = await listAll(client, bucket, path);
                out.push(...nested);
            } else {
                out.push(path);
            }
        }
        if (data.length < limit) break;
        offset += limit;
    }
    return out;
}

async function migrateBucket(bucket) {
    console.log(`\n=== Bucket: ${bucket} ===`);
    let paths;
    try {
        paths = await listAll(src, bucket);
    } catch (e) {
        console.error(`  ✗ No pude listar el bucket viejo (¿existe?): ${e.message}`);
        return;
    }
    console.log(`  ${paths.length} archivo(s) a copiar`);

    let ok = 0;
    let fail = 0;
    for (const path of paths) {
        try {
            const { data: blob, error: dErr } = await src.storage.from(bucket).download(path);
            if (dErr) throw dErr;

            const { error: uErr } = await dst.storage
                .from(bucket)
                .upload(path, blob, { upsert: true, contentType: blob.type || undefined });
            if (uErr) throw uErr;

            ok++;
            if (ok % 25 === 0) console.log(`  ...${ok}/${paths.length}`);
        } catch (e) {
            fail++;
            console.error(`  ✗ ${path}: ${e.message}`);
        }
    }
    console.log(`  ✓ ${ok} copiados, ${fail} fallidos`);
}

for (const bucket of BUCKETS) {
    // eslint-disable-next-line no-await-in-loop
    await migrateBucket(bucket);
}

console.log('\nListo. Verificá en el dashboard del proyecto nuevo que los archivos estén.');
