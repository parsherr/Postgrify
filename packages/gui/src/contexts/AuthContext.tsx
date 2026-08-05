/**
 * AuthContext — global admin auth state.
 *
 * Strateji:
 *   - accessToken sadece memory'de (XSS koruması)
 *   - refreshToken localStorage'da ("postgrify_refresh_token")
 *   - Sayfa yüklenince: refreshToken varsa → /auth/admin/refresh → accessToken yenile
 *   - login(): POST /auth/admin/login → her iki token'ı sakla
 *   - logout(): POST /auth/admin/logout → her şeyi temizle
 */

import React, { createContext, useCallback, useEffect, useRef, useState } from "react";

const REFRESH_TOKEN_KEY = "postgrify_refresh_token";
const API_BASE =
  (import.meta as unknown as { env: { VITE_API_URL?: string } }).env.VITE_API_URL ??
  "http://localhost:3000";

export interface AuthContextValue {
  accessToken: string | null;
  email: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** api.ts tarafından 401 sonrası sessiz yenileme için kullanılır */
  refreshAccessToken: () => Promise<string | null>;
  /** api.ts'in token'ı okuması için — React dışı bağlam */
  getAccessToken: () => string | null;
  setAccessToken: (token: string) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [accessToken, setAccessTokenState] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // api.ts circular import'tan kaçınmak için ref üzerinden erişim
  const accessTokenRef = useRef<string | null>(null);

  const setAccessToken = useCallback((token: string) => {
    accessTokenRef.current = token;
    setAccessTokenState(token);
  }, []);

  const getAccessToken = useCallback(() => accessTokenRef.current, []);

  /** Refresh token ile yeni access token al */
  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) return null;

    try {
      const res = await fetch(`${API_BASE}/auth/admin/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) {
        localStorage.removeItem(REFRESH_TOKEN_KEY);
        return null;
      }

      const data = (await res.json()) as { accessToken: string };
      setAccessToken(data.accessToken);
      return data.accessToken;
    } catch {
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      return null;
    }
  }, [setAccessToken]);

  /** Sayfa yüklenince refresh token varsa sessizce yenile */
  useEffect(() => {
    async function init() {
      setIsLoading(true);
      const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);

      if (refreshToken) {
        const token = await refreshAccessToken();
        if (token) {
          // Email'i /auth/admin/me'den al
          try {
            const meRes = await fetch(`${API_BASE}/auth/admin/me`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (meRes.ok) {
              const me = (await meRes.json()) as { email: string };
              setEmail(me.email);
            }
          } catch {
            // email olmadan da devam edilebilir
          }
        }
      }

      setIsLoading(false);
    }

    void init();
  }, [refreshAccessToken]);

  const login = useCallback(
    async (loginEmail: string, password: string): Promise<void> => {
      const res = await fetch(`${API_BASE}/auth/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password }),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Giriş başarısız");
      }

      const data = (await res.json()) as {
        accessToken: string;
        refreshToken: string | null;
        email: string;
      };

      setAccessToken(data.accessToken);
      setEmail(data.email);

      if (data.refreshToken) {
        localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
      }
    },
    [setAccessToken]
  );

  const logout = useCallback(async (): Promise<void> => {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    const token = accessTokenRef.current;

    // Sunucuda revoke et (hata olursa sessizce geç)
    if (token && refreshToken) {
      try {
        await fetch(`${API_BASE}/auth/admin/logout`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ refreshToken }),
        });
      } catch {
        // best-effort
      }
    }

    // Her durumda local state'i temizle
    accessTokenRef.current = null;
    setAccessTokenState(null);
    setEmail(null);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        accessToken,
        email,
        isAuthenticated: accessToken !== null,
        isLoading,
        login,
        logout,
        refreshAccessToken,
        getAccessToken,
        setAccessToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}