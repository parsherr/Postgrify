/**
 * AuthContext — global auth state
 *
 * Manages user state via the Postgrify auth-js SDK.
 * Accessed via the useAuth() hook.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { AuthSession } from "@postgrify/auth-js";
import { auth } from "../lib/postgrify";
import { setAccessToken } from "../lib/api";

interface UserProfile {
  id: string;
  auth_id: string;
  username: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
}

interface AuthUser {
  id: string;
  email: string;
}

interface AuthState {
  session: AuthSession | null;
  user: AuthUser | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  /** signUp: registers + automatically signs in. Returns the accessToken string. */
  signUp: (email: string, password: string) => Promise<string>;
  signOut: () => Promise<void>;
  setProfile: (p: UserProfile) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
    const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get current session from the SDK — returns { data, error }
    auth.getSession().then(({ data: s }) => {
      if (s) {
        setSession(s);
        setUser({ id: s.user.id, email: s.user.email });
        setAccessToken(s.accessToken);
      }
      setLoading(false);
    }).catch(() => setLoading(false));

    // Listen for auth state changes
    const unsubscribe = auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s) {
        setUser({ id: s.user.id, email: s.user.email });
        setAccessToken(s.accessToken);
      } else {
        setUser(null);
        setAccessToken(null);
        setProfile(null);
      }
    });

    return () => { if (typeof unsubscribe === "function") unsubscribe(); };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await auth.signIn({ email, password });
    if (error) throw new Error(error.message);
  }, []);

  const signUp = useCallback(async (email: string, password: string): Promise<string> => {
    const { error: signUpError } = await auth.signUp({ email, password });
    if (signUpError) throw new Error(signUpError.message);

    // Immediately sign in after signup — write token to state synchronously
    const { data: s, error: signInError } = await auth.signIn({ email, password });
    if (signInError) throw new Error(signInError.message);
    if (!s) throw new Error("Could not retrieve session after sign in");

    setSession(s);
    setUser({ id: s.user.id, email: s.user.email });
    setAccessToken(s.accessToken);

    return s.accessToken;
  }, []);

  const signOut = useCallback(async () => {
    await auth.signOut();
    setProfile(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ session, user, profile, loading, signIn, signUp, signOut, setProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth: AuthProvider is required");
  return ctx;
}