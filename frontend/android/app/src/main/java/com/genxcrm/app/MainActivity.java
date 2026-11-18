package com.genxcrm.app;

import android.os.Bundle;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.genxcrm.app.calllog.CallLogPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CallLogPlugin.class);
        super.onCreate(savedInstanceState);

        // Android 15 draws edge-to-edge and no longer resizes the window for the on-screen keyboard, so
        // it covered the field being typed in (and the Save bar). Pad the content by the keyboard height so
        // the web view shrinks above it and the focused field scrolls into view. The insets are passed on
        // unchanged, so the web view still gets the status-bar / gesture-bar safe areas.
        View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, insets) -> {
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            view.setPadding(0, 0, 0, ime.bottom);
            return insets;
        });
    }
}
