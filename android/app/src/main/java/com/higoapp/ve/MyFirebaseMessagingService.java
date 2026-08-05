package com.higoapp.ve;

import android.app.ActivityManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.List;

public class MyFirebaseMessagingService extends FirebaseMessagingService {
    private static final String RIDE_CHANNEL_ID = "higo_rides_v13_immediate";
    private static final String CHAT_CHANNEL_ID = "higo_messages_v3_immediate";

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        if (remoteMessage.getData().isEmpty()) return;

        String type = value(remoteMessage, "type");
        if ("ride_message".equals(type)) {
            // Realtime handles foreground chat instantly. Native push is the
            // reliable background/killed path and must not duplicate it.
            if (!isAppInForeground()) showChatNotification(remoteMessage);
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

    private boolean isAppInForeground() {
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
