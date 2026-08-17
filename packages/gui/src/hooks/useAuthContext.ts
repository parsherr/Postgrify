/**
 * useAuthContext — consumer hook for AuthContext.
 * Throws an error if called outside the Provider.
 */

import { useContext } from "react";
import { AuthContext, type AuthContextValue } from "../contexts/AuthContext.js";

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuthContext must be used within <AuthProvider>");
  }
  return ctx;
}