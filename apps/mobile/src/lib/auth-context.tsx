import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { PropsWithChildren } from "react";

import { clearStoredToken, getStoredToken } from "@/lib/auth";
import { registerForPushNotifications } from "@/lib/notifications";

type AuthContextValue = {
  isLoading: boolean;
  isAuthenticated: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    getStoredToken()
      .then((token) => setIsAuthenticated(Boolean(token)))
      .finally(() => setIsLoading(false));
  }, []);

  const signIn = useCallback(async () => {
    setIsAuthenticated(true);
    void registerForPushNotifications();
  }, []);

  const signOut = useCallback(async () => {
    await clearStoredToken();
    setIsAuthenticated(false);
  }, []);

  const value = useMemo(
    () => ({ isLoading, isAuthenticated, signIn, signOut }),
    [isLoading, isAuthenticated, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
