# 🚖 Higo App — Manual de Mantenimiento y Seguridad

Este documento describe la arquitectura de seguridad de sesión única, la configuración de Google Maps y las directivas de despliegue para mantener estable la plataforma **Higo**.

---

## 🔒 1. Control de Sesión Única (Multi-Device Prevention)

Para evitar pérdidas de datos, fraudes y abusos, Higo no permite que una misma cuenta de usuario esté conectada en múltiples dispositivos o pestañas simultáneamente.

### 🛡️ Arquitectura en la Base de Datos (Supabase)
El control reside en la columna `current_session_id` (tipo `UUID`) dentro de la tabla `public.profiles`.

1. **SELECT Policy (`profiles_self_read`):**
   Garantiza que solo el propio usuario autenticado pueda leer su propia fila en la tabla `profiles`.
   ```sql
   CREATE POLICY "profiles_self_read"
       ON public.profiles FOR SELECT TO authenticated
       USING (auth.uid() = id);
   ```

2. **UPDATE Policy (`Users can update own profile`):**
   Permite al usuario actualizar su propio registro (necesario para renovar el ID de sesión al loguearse).
   ```sql
   CREATE POLICY "Users can update own profile"
       ON public.profiles FOR UPDATE TO authenticated
       USING (auth.uid() = id);
   ```

3. **Replicación en Tiempo Real (Realtime):**
   La tabla `profiles` debe pertenecer a la publicación `supabase_realtime` y tener la identidad de réplica en `FULL` para propagar los cambios de columnas al instante a los dispositivos activos:
   ```sql
   ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
   ALTER TABLE public.profiles REPLICA IDENTITY FULL;
   ```

---

## 🗺️ 2. Restricciones de Google Maps en Apps Híbridas

Cuando compilas la aplicación para Android/iOS (APK o AAB) utilizando **Capacitor**, la aplicación se ejecuta dentro de una WebView nativa.

### ⚠️ El Problema del Referer (`Error: AuthFailure`)
Si la clave API de Google Maps está restringida por sitio web (HTTP referrers) a `higoapp.com/*`, la app en el teléfono fallará con un error de autenticación porque su origen no es web, sino un protocolo interno local.

### 🛠️ Solución en la Consola de Google Cloud
Para que una única clave API de Google Maps funcione con total seguridad en la web de producción, en local y en la app móvil, ingresa a **Google Cloud Console > API y servicios > Credenciales**, edita la clave API de mapas, y en **Restricciones de sitios web** agrega las siguientes reglas:

1. `higoapp.com/*` (Sitio web de producción)
2. `*.higoapp.com/*` (Subdominios web)
3. `capacitor://localhost/*` (Requerido para la APK nativa en Android/iOS)
4. `http://localhost/*` (Requerido para pruebas locales y emuladores)

---

## 🔑 3. Red de Seguridad de Credenciales (Hotfix Anon Key)

En caso de que los Secrets de GitHub fallen o no se inyecten correctamente durante el despliegue automático del bundle web:

* El archivo [supabase.js](file:///c:/Users/user/higo-app/src/services/supabase.js) cuenta con constantes de red de seguridad (`FALLBACK_URL` y `FALLBACK_KEY`) con la clave anon activa del proyecto en producción.
* Esto evita la pantalla roja `SUPABASE_ENV_MISSING` en producción, asegurando el arranque ininterrumpido de la aplicación.
* Si rotas la llave Anon en el Supabase Dashboard, asegúrate de actualizar la variable `FALLBACK_KEY` en `supabase.js` en el mismo commit.

---

## 🏗️ 4. Utilidad de Compilación Interactiva (`build-app.js`)

Para simplificar las compilaciones en tu máquina de desarrollo, dispones de una herramienta interactiva:

* **Ejecutar desde Terminal:** `node build-app.js`
* **Ejecutar en Windows:** Haz doble clic sobre el atajo `higo-build.bat` en la raíz del proyecto.

### Opciones Disponibles:
* **[1] Compilar APK de Pruebas (Debug):** Compila rápido una APK para instalación directa mediante cable o correo.
* **[2] Compilar AAB para Play Store (Release):** Incrementa automáticamente en **+1** la variable `versionCode` dentro de `android/app/build.gradle` para prevenir errores de versión duplicada en Google Play Console, y genera el archivo App Bundle firmado.
