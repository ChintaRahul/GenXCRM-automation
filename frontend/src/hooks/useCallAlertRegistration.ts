import { useEffect } from "react";
import { PushNotifications } from "@capacitor/push-notifications";
import { isNative } from "../lib/platform";
import * as client from "../api/client";
import { useAuth } from "../context/AuthContext";

// Registers this device's FCM token with the backend so a desktop "Call Lead"
// click can reach this phone — see backend/src/modules/users/users.controller.ts
// (POST /users/me/push-token) and the design doc at
// docs/superpowers/specs/2026-09-13-desktop-call-alert-design.md.
export function useCallAlertRegistration(): void {
  const { user } = useAuth();

  useEffect(() => {
    if (!isNative() || !user) return;

    const registrationSub = PushNotifications.addListener("registration", (token) => {
      void client.registerPushToken(token.value).catch(() => undefined);
    });

    void (async () => {
      const perm = await PushNotifications.checkPermissions();
      if (perm.receive !== "granted") {
        const requested = await PushNotifications.requestPermissions();
        if (requested.receive !== "granted") return;
      }
      await PushNotifications.register();
    })();

    return () => {
      void registrationSub.then((handle) => handle.remove());
    };
  }, [user]);
}
