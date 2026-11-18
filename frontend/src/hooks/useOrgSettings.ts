import { useState, useEffect, useCallback } from "react";
import {
  getOrgProfile,
  updateOrganization,
  getOrgSettings,
  updateOrgSettings,
} from "../api/client";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";
import type {
  Organization,
  OrgSettings,
  SecuritySettings,
  NotificationSettings,
  RoutingSettings,
  PaymentSettings,
} from "../types";

export function useOrgSettings() {
  const [profile, setProfile] = useState<Organization | null>(null);
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [profileData, settingsData] = await Promise.all([getOrgProfile(), getOrgSettings()]);
      setProfile(profileData);
      setSettings(settingsData);
    } catch (err) {
      setError(apiErrorMessage(err, Messages.load.orgSettings));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const saveProfile = useCallback(async (payload: Parameters<typeof updateOrganization>[0]) => {
    const updated = await updateOrganization(payload);
    setProfile(updated);
  }, []);

  const saveSecurity = useCallback(async (security: SecuritySettings) => {
    const updated = await updateOrgSettings({ security });
    setSettings(updated);
  }, []);

  const saveNotifications = useCallback(async (notifications: NotificationSettings) => {
    const updated = await updateOrgSettings({ notifications });
    setSettings(updated);
  }, []);

  const saveRouting = useCallback(async (routing: RoutingSettings) => {
    const updated = await updateOrgSettings({ routing });
    setSettings(updated);
  }, []);

  const savePayments = useCallback(async (payments: PaymentSettings) => {
    const updated = await updateOrgSettings({ payments });
    setSettings(updated);
  }, []);

  return {
    profile,
    settings,
    loading,
    error,
    saveProfile,
    saveSecurity,
    saveNotifications,
    saveRouting,
    savePayments,
    refetch: fetchAll,
  };
}
