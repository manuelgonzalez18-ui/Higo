package com.higoapp.ve;

import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static volatile boolean inForeground = false;

    public static boolean isInForeground() {
        return inForeground;
    }

    @Override
    public void onStart() {
        super.onStart();
        inForeground = true;
    }

    @Override
    public void onStop() {
        inForeground = false;
        super.onStop();
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OverlayPlugin.class);
        super.onCreate(savedInstanceState);

        // Allow showing over lock screen
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                    WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD |
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON |
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            );
        }
    }
}
