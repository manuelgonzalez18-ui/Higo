package com.higo.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;
import android.net.Uri;
import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public class MyFirebaseMessagingService extends FirebaseMessagingService {

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);

        // Check if message contains data payload
        if (remoteMessage.getData().size() > 0) {
            String type = remoteMessage.getData().get("type");
            // If it's a ride request, trigger full screen intent
            if ("ride_request".equals(type) || remoteMessage.getData().containsKey("price")) { // Loose check for safety
                showFullScreenNotification(remoteMessage);
            }
        }

        // Also check notification payload if present (though data is preferred for
        // background wake)
        if (remoteMessage.getNotification() != null) {
            // Check title or body if needed
        }
    }

    private void showFullScreenNotification(RemoteMessage remoteMessage) {
        String channelId = "ride_requests_channel";
        String title = remoteMessage.getData().get("title");
        if (title == null)
            title = "¡Solicitud de Viaje!";
        String body = remoteMessage.getData().get("body");
        if (body == null)
            body = "Tienes una nueva solicitud de viaje.";

        Intent fullScreenIntent = new Intent(this, MainActivity.class);
        fullScreenIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK |
                Intent.FLAG_ACTIVITY_CLEAR_TOP |
                Intent.FLAG_ACTIVITY_SINGLE_TOP);

        // Pass data to activity if needed
        for (String key : remoteMessage.getData().keySet()) {
            fullScreenIntent.putExtra(key, remoteMessage.getData().get(key));
        }

        PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(this, 0,
                fullScreenIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationManager notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);

        // Create Channel for O+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(channelId,
                    "Solicitudes de Viaje",
                    NotificationManager.IMPORTANCE_HIGH);

            // Critical: Enable sound and vibration for heads-up
            Uri defaultSoundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .build();
            channel.setSound(defaultSoundUri, audioAttributes);
            channel.enableVibration(true);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC); // Show on lock screen

            notificationManager.createNotificationChannel(channel);
        }

        // Create "Accept" Action Intent
        String rideId = remoteMessage.getData().get("rideId");
        if (rideId == null && remoteMessage.getData().containsKey("id")) {
            rideId = remoteMessage.getData().get("id"); // Fallback
        }

        Intent acceptIntent = new Intent(Intent.ACTION_VIEW);
        // Deep link format: higo://accept?rideId=123
        acceptIntent.setData(Uri.parse("higo://accept?rideId=" + (rideId != null ? rideId : "")));
        acceptIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        PendingIntent acceptPendingIntent = PendingIntent.getActivity(this, 1,
                acceptIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder notificationBuilder = new NotificationCompat.Builder(this, channelId)
                .setSmallIcon(R.mipmap.ic_launcher) // Ensure this icon exists
                .setContentTitle(title)
                .setContentText(body)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_CALL) // Important for fullscreen behavior
                .setFullScreenIntent(fullScreenPendingIntent, true) // THE KEY: High priority + intent = wake
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .addAction(android.R.drawable.ic_menu_add, "Aceptar Viaje", acceptPendingIntent); // Native Action

        notificationManager.notify(0, notificationBuilder.build());
    }
}
