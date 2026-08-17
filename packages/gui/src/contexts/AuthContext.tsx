/**
 * AuthContext — global admin auth state.
 *
 * Strategy:
 *   - accessToken in memory only (XSS protection)
 *   - refreshToken in localStorage ("postgrify_refresh_token")
 *   - On page load: if refreshToken exists → /auth/admin/refresh → renew accessToken
 *   - login(): POST /auth/admin/login → store both tokens
 *   - logout(): POST /auth/admin/logout → clear everything
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
  /** Used by api.ts for silent refresh after a 401 */
  refreshAccessToken: () => Promise<string | null>;
  /** For api.ts to read the token in non-React contexts */
  getAccessToken: () => string | null;
  setAccessToken: (token: string) => void;
  /** Setup wizard: initialize session with server-issued tokens, skips login request */
  loginWithTokens: (accessToken: string, refreshToken: string | null, email: string) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [accessToken, setAccessTokenState] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Accessed via ref to avoid circular imports with api.ts
  const accessTokenRef = useRef<string | null>(null);

  const setAccessToken = useCallback((token: string) => {
    accessTokenRef.current = token;
    setAccessTokenState(token);
  }, []);

  const getAccessToken = useCallback(() => accessTokenRef.current, []);

  /** Exchange refresh token for a new access token */
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

  /** On page load, silently renew if a refresh token exists */
  useEffect(() => {
    async function init() {
      setIsLoading(true);
      const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);

      if (refreshToken) {
        const token = await refreshAccessToken();
        if (token) {
          // Fetch email from /auth/admin/me
          try {
            const meRes = await fetch(`${API_BASE}/auth/admin/me`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (meRes.ok) {
              const me = (await meRes.json()) as { email: string };
              setEmail(me.email);
            }
          } catch {
            // Proceed without email — not critical
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
        throw new Error(err.error ?? "Login failed");
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

  const loginWithTokens = useCallback(
    (at: string, rt: string | null, userEmail: string): void => {
      setAccessToken(at);
      setEmail(userEmail);
      if (rt) localStorage.setItem(REFRESH_TOKEN_KEY, rt);
    },
    [setAccessToken]
  );

  const logout = useCallback(async (): Promise<void> => {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    const token = accessTokenRef.current;

    // Revoke on the server (ignore errors — best effort)
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

    // Clear local state regardless
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
        loginWithTokens,
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