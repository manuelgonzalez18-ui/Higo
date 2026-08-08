package com.higoapp.ve;

import android.app.ActivityManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.List;
import java.util.Locale;

public class MyFirebaseMessagingService extends FirebaseMessagingService {
    private static final String RIDE_CHANNEL_ID = "higo_rides_v13_immediate";
    private static final String CHAT_CHANNEL_ID = "higo_messages_v3_immediate";
    private static final String STATUS_CHANNEL_ID = "higo_ride_status_v2";
    private static final String STATUS_PREFS = "higo_ride_status_dedupe";
    private static final long STATUS_DEDUPE_MS = 24L * 60L * 60L * 1000L;

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        if (remoteMessage.getData().isEmpty()) return;

        String type = value(remoteMessage, "type");
        if ("ride_message".equals(type)) {
            if (!isAppInForeground()) showChatNotification(remoteMessage);
            return;
        }
        if ("ride_status".equals(type)) {
            if (!isAppInForeground() && markRideStatusAsNew(remoteMessage)) {
                showRideStatusNotification(remoteMessage);
                speakRideStatus(remoteMessage);
            }
            return;
        }
        if ("ride_request".equals(type) || remoteMessage.getData().containsKey("price")) {
            showRideNotification(remoteMessage);
        }
    }

    private String value(RemoteMessage message, String... keys) {
        for (String key : keys) {
            String candidate = message.getData().get(key);
            if (candidate != null && !candidate.isEmpty()) return candidate;
        }
        return null;
    }

    private Uri alertSoundUri() {
        return Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE + "://" + getPackageName() + "/" + R.raw.alert_sound);
    }

    private void ensureChannel(String id, String name, String description) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel channel = new NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription(description);
        AudioAttributes attributes = new AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .build();
        channel.setSound(alertSoundUri(), attributes);
        channel.enableVibration(true);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(channel);
    }

    private void showRideNotification(RemoteMessage remoteMessage) {
        ensureChannel(RIDE_CHANNEL_ID, "Solicitudes Higo", "Nuevas solicitudes de viaje y envíos");
        String title = value(remoteMessage, "title");
        if (title == null) title = "¡Solicitud de Viaje!";
        String body = value(remoteMessage, "body");
        if (body == null) body = "Tienes una nueva solicitud de viaje.";
        String rideId = value(remoteMessage, "ride_id", "rideId", "id");
        int notificationId = rideId != null ? rideId.hashCode() : (int) System.currentTimeMillis();

        Intent fullScreenIntent = new Intent(this, MainActivity.class);
        fullScreenIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        for (String key : remoteMessage.getData().keySet()) {
            fullScreenIntent.putExtra(key, remoteMessage.getData().get(key));
        }
        PendingIntent contentIntent = PendingIntent.getActivity(
                this, notificationId, fullScreenIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent acceptIntent = new Intent(Intent.ACTION_VIEW);
        acceptIntent.setData(Uri.parse("higo://accept?rideId=" + Uri.encode(rideId != null ? rideId : "")));
        acceptIntent.setPackage(getPackageName());
        acceptIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent acceptPendingIntent = PendingIntent.getActivity(
                this, notificationId + 1, acceptIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, RIDE_CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setFullScreenIntent(contentIntent, true)
                .setContentIntent(contentIntent)
                .setSound(alertSoundUri())
                .setVibrate(new long[]{0, 1000, 500, 1000, 500, 1000})
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .addAction(android.R.drawable.ic_menu_add, "Aceptar Viaje", acceptPendingIntent);

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        manager.notify(notificationId, builder.build());
    }

    private void showChatNotification(RemoteMessage remoteMessage) {
        ensureChannel(CHAT_CHANNEL_ID, "Mensajes del viaje", "Mensajes entre pasajero y conductor");
        String title = value(remoteMessage, "title");
        if (title == null) title = "Nuevo mensaje del viaje";
        String body = value(remoteMessage, "body");
        if (body == null) body = "Tienes un nuevo mensaje";
        String rideId = value(remoteMessage, "ride_id", "rideId");
        String messageId = value(remoteMessage, "message_id", "messageId");
        int notificationId = messageId != null
                ? messageId.hashCode()
                : (rideId != null ? ("chat:" + rideId).hashCode() : (int) System.currentTimeMillis());

        Intent openChatIntent = new Intent(Intent.ACTION_VIEW);
        openChatIntent.setData(Uri.parse("higo://chat?rideId=" + Uri.encode(rideId != null ? rideId : "")));
        openChatIntent.setPackage(getPackageName());
        openChatIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
                this, notificationId, openChatIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHAT_CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setContentIntent(contentIntent)
                .setSound(alertSoundUri())
                .setVibrate(new long[]{0, 180, 100, 180})
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        manager.notify(notificationId, builder.build());
    }

    private void showRideStatusNotification(RemoteMessage remoteMessage) {
        ensureChannel(STATUS_CHANNEL_ID, "Estado del viaje", "Avisos de llegada, inicio y finalización del viaje");
        String title = value(remoteMessage, "title");
        if (title == null) title = "Actualización de tu viaje";
        String body = value(remoteMessage, "body");
        if (body == null) body = "Tu viaje tiene una actualización";
        String rideId = value(remoteMessage, "ride_id", "rideId");
        String milestone = value(remoteMessage, "milestone");
        int notificationId = ("status:" + (rideId != null ? rideId : "") + ":" + (milestone != null ? milestone : "")).hashCode();

        Intent openRideIntent = new Intent(Intent.ACTION_VIEW);
        openRideIntent.setData(Uri.parse("higo://ride?rideId=" + Uri.encode(rideId != null ? rideId : "")));
        openRideIntent.setPackage(getPackageName());
        openRideIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
                this, notificationId, openRideIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, STATUS_CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setContentIntent(contentIntent)
                .setSound(alertSoundUri())
                .setVibrate(new long[]{0, 250, 120, 250})
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        manager.notify(notificationId, builder.build());
    }

    private boolean markRideStatusAsNew(RemoteMessage remoteMessage) {
        String rideId = value(remoteMessage, "ride_id", "rideId");
        String milestone = value(remoteMessage, "milestone");
        if (rideId == null || milestone == null) return true;

        String key = rideId + ":" + milestone;
        long now = System.currentTimeMillis();
        SharedPreferences preferences = getSharedPreferences(STATUS_PREFS, MODE_PRIVATE);
        long previous = preferences.getLong(key, 0L);
        if (previous > 0L && now - previous < STATUS_DEDUPE_MS) return false;
        preferences.edit().putLong(key, now).apply();
        return true;
    }

    private void speakRideStatus(RemoteMessage remoteMessage) {
        final String text = value(remoteMessage, "voice_text", "body");
        if (text == null || text.trim().isEmpty()) return;

        final PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        final PowerManager.WakeLock wakeLock = powerManager != null
                ? powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "higo:ride-status-voice")
                : null;
        if (wakeLock != null) wakeLock.acquire(15000L);

        final TextToSpeech[] engine = new TextToSpeech[1];
        final Runnable cleanup = () -> {
            if (engine[0] != null) engine[0].shutdown();
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        };

        engine[0] = new TextToSpeech(getApplicationContext(), status -> {
            if (status != TextToSpeech.SUCCESS || engine[0] == null) {
                cleanup.run();
                return;
            }
            engine[0].setLanguage(new Locale("es", "ES"));
            engine[0].setSpeechRate(1.0f);
            engine[0].setPitch(1.0f);
            final String utteranceId = "higo-status-" + System.currentTimeMillis();
            engine[0].setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) { }
                @Override public void onDone(String id) { cleanup.run(); }
                @Override public void onError(String id) { cleanup.run(); }
            });
            int result = engine[0].speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId);
            if (result == TextToSpeech.ERROR) cleanup.run();
        });
    }

    private boolean isAppInForeground() {
        if (MainActivity.isInForeground()) return true;
        ActivityManager manager = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
        if (manager == null) return false;
        List<ActivityManager.RunningAppProcessInfo> processes = manager.getRunningAppProcesses();
        if (processes == null) return false;
        String packageName = getPackageName();
        for (ActivityManager.RunningAppProcessInfo process : processes) {
            if (packageName.equals(process.processName)
                    && process.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND) {
                return true;
            }
        }
        return false;
    }
}
