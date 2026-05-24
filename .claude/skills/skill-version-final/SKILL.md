---
name: skill-version-final
description: Empaca Higo en su versión final del día. Construye el bundle web con Vite, sincroniza Capacitor con Android y genera el APK release. Úsalo cuando el usuario pida "empacar Higo", "versión final", "build final" o "generar APK".
---

# Skill: Version Final (Higo)

Empaca la app Higo en la versión final del día (web + APK Android).

## Cuándo usar
- "Empaca Higo"
- "Genera la versión final"
- "Build de hoy"
- "Crea el APK release"

## Pasos

1. **Verificar versión actual**
   - Leer `package.json` → campo `version`
   - Leer `android/app/build.gradle` → `versionCode` y `versionName`
   - Confirmar con el usuario si hay que bumpear

2. **Instalar dependencias (si node_modules no existe)**
   ```bash
   npm install
   ```

3. **Build web (Vite)**
   ```bash
   npm run build
   ```
   Salida en `dist/`.

4. **Sincronizar Capacitor**
   ```bash
   npx cap sync android
   ```

5. **Generar APK release**
   ```bash
   cd android && ./gradlew assembleRelease
   ```
   APK queda en `android/app/build/outputs/apk/release/app-release.apk`.

6. **Reportar al usuario**
   - Ruta del APK
   - Versión y versionCode
   - Tamaño del archivo

## Notas
- Si el build release requiere firma y falla, intentar `assembleDebug` y avisar al usuario que el APK no está firmado.
- Nunca commitear el APK al repo (suele estar en `.gitignore`).
- Para subir a producción web: el contenido de `dist/` se despliega vía Firebase Hosting (`firebase deploy --only hosting`) o Vercel.
