import { spawn } from 'child_process';
import fs from 'fs';
import readline from 'readline';
import path from 'path';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function runCommand(command, args, cwd) {
    return new Promise((resolve, reject) => {
        const proc = spawn(command, args, { cwd, shell: true, stdio: 'inherit' });
        proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Command "${command} ${args.join(' ')}" failed with code ${code}`));
        });
    });
}

async function bumpVersionCode() {
    const gradlePath = path.join('android', 'app', 'build.gradle');
    if (!fs.existsSync(gradlePath)) {
        throw new Error(`Gradle config not found at: ${gradlePath}`);
    }
    
    let content = fs.readFileSync(gradlePath, 'utf8');
    
    const regex = /(versionCode\s+)(\d+)/;
    const match = content.match(regex);
    if (!match) {
        throw new Error("Could not find 'versionCode <number>' inside android/app/build.gradle");
    }
    
    const currentCode = parseInt(match[2], 10);
    const newCode = currentCode + 1;
    
    content = content.replace(regex, `$1${newCode}`);
    fs.writeFileSync(gradlePath, content, 'utf8');
    
    console.log(`\n🔄 [Auto-Increment] Bumping versionCode in build.gradle: ${currentCode} ➡️ ${newCode}\n`);
}

async function start() {
    console.log("==================================================");
    console.log("             HIGO APP BUILD UTILITY               ");
    console.log("==================================================");
    console.log("[1] Compilar APK de Pruebas (Debug)");
    console.log("[2] Compilar AAB para Play Store (Release)");
    console.log("==================================================");
    
    rl.question("Elige una opción (1 o 2): ", async (answer) => {
        const choice = answer.trim();
        if (choice !== '1' && choice !== '2') {
            console.error("Opción inválida. Abortando.");
            rl.close();
            process.exit(1);
        }
        
        try {
            if (choice === '2') {
                await bumpVersionCode();
            }
            
            console.log("\n📦 Paso 1/3: Compilando entorno web (Vite)...");
            await runCommand('npm', ['run', 'build'], '.');
            
            console.log("\n📲 Paso 2/3: Sincronizando assets nativos con Capacitor...");
            await runCommand('npx', ['cap', 'sync', 'android'], '.');
            
            if (choice === '1') {
                console.log("\n🔨 Paso 3/3: Compilando APK de pruebas...");
                await runCommand('.\\gradlew', ['assembleDebug'], 'android');
                console.log("\n==================================================");
                console.log("🎉 ¡APK COMPILADA CON ÉXITO!");
                console.log("Ruta del archivo:");
                console.log("👉 android/app/build/outputs/apk/debug/app-debug.apk");
                console.log("==================================================");
            } else {
                console.log("\n🔨 Paso 3/3: Compilando AAB de lanzamiento (Release)...");
                await runCommand('.\\gradlew', ['bundleRelease'], 'android');
                console.log("\n==================================================");
                console.log("🎉 ¡AAB COMPILADO CON ÉXITO!");
                console.log("Ruta del archivo:");
                console.log("👉 android/app/build/outputs/bundle/release/app-release.aab");
                console.log("==================================================");
            }
        } catch (err) {
            console.error("\n❌ Ocurrió un error durante la compilación:\n", err.message);
            process.exit(1);
        } finally {
            rl.close();
        }
    });
}

start();
