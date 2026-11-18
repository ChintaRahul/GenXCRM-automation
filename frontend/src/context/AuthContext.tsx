import React, { createContext, useContext, useState, useEffect } from "react";
import type { User } from "../types";
import { getMe } from "../api/client";
import { PLAN_ACTIVATED_EVENT } from "../lib/planEvents";
import { markAuthenticated } from "../lib/firstRun";

interface AuthCtx {
  user: User | null;
  token: string | null;
  signIn: (token: string, user: User) => void;
  signOut: () => void;
  updateUser: (user: User) => void;
  loading: boolean;
  isImpersonating: boolean;
  impersonate: (token: string, user: User) => void;
  exitImpersonation: () => void;
}

const AuthContext = createContext<AuthCtx>(null!);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(
    localStorage.getItem("token"),
  );
  const [loading, setLoading] = useState(true);
  const [isImpersonating, setIsImpersonating] = useState(
    () => localStorage.getItem("originalToken") !== null,
  );

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    const restoreSession = async () => {
      try {
        const me = await getMe();
        setUser(me);
      } catch {
        signOut();
      } finally {
        setLoading(false);
      }
    };

    void restoreSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // user.org.planStatus (read by Sidebar's trial badge, among others) is only ever set
  // at login/restoreSession — refetch it when a subscription activates, same event
  // TrialBanner/TrialExpiredModal already use to refresh their own status, so the
  // sidebar's "Trial" state clears without a full page reload.
  useEffect(() => {
    const refetchUser = () => {
      if (!localStorage.getItem("token")) return;
      getMe()
        .then((me) => updateUser(me))
        .catch(() => {
          /* ignore — next real fetch will retry */
        });
    };
    window.addEventListener(PLAN_ACTIVATED_EVENT, refetchUser);
    return () => window.removeEventListener(PLAN_ACTIVATED_EVENT, refetchUser);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = (newToken: string, newUser: User) => {
    localStorage.setItem("token", newToken);
    localStorage.setItem("user", JSON.stringify(newUser));
    markAuthenticated();
    setToken(newToken);
    setUser(newUser);
    // MFA, change-password and setup sessions return a slim user without `org`/`mfgRole`; without
    // them the sidebar and dashboard show the EdTech workspace until a refresh. Load the full profile.
    if (!newUser.org) {
      const loadFullProfile = async () => {
        try {
          updateUser(await getMe());
        } catch {
          /* ignore — the next real fetch will retry */
        }
      };
      void loadFullProfile();
    }
  };

  const signOut = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("originalToken");
    localStorage.removeItem("originalUser");
    setToken(null);
    setUser(null);
    setIsImpersonating(false);
  };

  const updateUser = (updated: User) => {
    localStorage.setItem("user", JSON.stringify(updated));
    setUser(updated);
  };

  // Stashes the current session under `original*` keys, then swaps to the
  // impersonated user's token — signIn() already persists + sets state.
  const impersonate = (newToken: string, newUser: User) => {
    const currentToken = localStorage.getItem("token");
    const currentUser = localStorage.getItem("user");
    if (currentToken) localStorage.setItem("originalToken", currentToken);
    if (currentUser) localStorage.setItem("originalUser", currentUser);
    setIsImpersonating(true);
    signIn(newToken, newUser);
  };

  const exitImpersonation = () => {
    const originalToken = localStorage.getItem("originalToken");
    const originalUser = localStorage.getItem("originalUser");
    localStorage.removeItem("originalToken");
    localStorage.removeItem("originalUser");
    setIsImpersonating(false);
    if (originalToken && originalUser) {
      signIn(originalToken, JSON.parse(originalUser) as User);
    } else {
      signOut();
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        signIn,
        signOut,
        updateUser,
        loading,
        isImpersonating,
        impersonate,
        exitImpersonation,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
