# Reglas de ProGuard/R8 para Higo. Listas para cuando se active
# `minifyEnabled true` en android/app/build.gradle (hoy en false; ver
# auditoría automática #5 antes de activar — requiere build + smoke test
# del APK release).
#
# Cubren los componentes nativos que R8 no puede inferir como vivos porque
# se invocan desde el system (FCM service), desde JS (Capacitor bridge) o
# vía reflexión (anotaciones de plugins).

# ── Stack traces legibles en Crashlytics / Play Console ────────────────
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# ── Firebase Messaging Service ─────────────────────────────────────────
# Android levanta el service por nombre completo de clase declarado en el
# manifest (`.MyFirebaseMessagingService`). Si R8 lo renombra, FCM no
# entrega ningún push.
-keep class com.higoapp.ve.MyFirebaseMessagingService { *; }
-keep class com.google.firebase.messaging.** { *; }
-keep class com.google.firebase.iid.** { *; }
-dontwarn com.google.firebase.**

# ── Capacitor bridge + plugins ─────────────────────────────────────────
# El JS llama a los plugins por nombre de clase y método. Cualquier rename
# rompe Geolocation, Push, Camera, Local Notifications, etc.
-keep class com.getcapacitor.** { *; }
-keep class com.capacitorjs.** { *; }
-keep class com.capacitor.community.** { *; }
-keepclassmembers class * {
    @com.getcapacitor.annotation.CapacitorPlugin *;
    @com.getcapacitor.annotation.PluginMethod *;
    @com.getcapacitor.PluginMethod *;
}
# WebView ⇄ JS bridge: los métodos @JavascriptInterface se invocan por
# nombre desde JS.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ── Google Play Services / Maps ────────────────────────────────────────
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.android.gms.**

# ── Cordova plugins (legacy bridge que Capacitor incluye) ──────────────
-keep class org.apache.cordova.** { *; }
-dontwarn org.apache.cordova.**

# ── AndroidX / Kotlin metadata necesario en runtime ────────────────────
-keep class kotlin.Metadata { *; }
-dontwarn kotlin.**
