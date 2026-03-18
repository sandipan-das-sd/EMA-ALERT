import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import type { AppUser } from "@/lib/api";
import { getMe, login as apiLogin, logout as apiLogout, signup as apiSignup, updateUpstoxToken as apiUpdateUpstoxToken } from "@/lib/api";

interface AuthContextValue {
  user: AppUser | null;
  loading: boolean;
  ready: boolean;
  login: (email: string, password: string, upstoxAccessToken?: string) => Promise<AppUser>;
  signup: (name: string, email: string, password: string) => Promise<AppUser>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
  updateUpstoxToken: (token: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);

  const refreshMe = useCallback(async () => {
    const me = await getMe();
    setUser(me);
  }, []);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const me = await getMe();
        if (!mounted) return;
        setUser(me);
      } catch {
        if (!mounted) return;
        setUser(null);
      } finally {
        if (mounted) {
          setLoading(false);
          setReady(true);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string, upstoxAccessToken = "") => {
    const nextUser = await apiLogin(email, password, upstoxAccessToken);
    setUser(nextUser);
    return nextUser;
  }, []);

  const signup = useCallback(async (name: string, email: string, password: string) => {
    const nextUser = await apiSignup(name, email, password);
    setUser(nextUser);
    return nextUser;
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  const updateUpstoxToken = useCallback(async (token: string) => {
    await apiUpdateUpstoxToken(token);
    await refreshMe();
  }, [refreshMe]);

  const value = useMemo(
    () => ({ user, loading, ready, login, signup, logout, refreshMe, updateUpstoxToken }),
    [user, loading, ready, login, signup, logout, refreshMe, updateUpstoxToken]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuthContext must be used within AuthProvider");
  }
  return value;
}
