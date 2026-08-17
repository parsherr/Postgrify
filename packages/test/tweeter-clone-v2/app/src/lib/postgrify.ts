/**
 * Postgrify SDK client — tweeter-clone-v2
 *
 * createClient: per-DB auth (signup/login/me/logout)
 * Data access: direct REST via apiFetch in lib/api.ts
 */

import { createClient } from "@postgrify/auth-js";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
export const DB_NAME = import.meta.env.VITE_DB_NAME ?? "tweeter2";
export const API_KEY = import.meta.env.VITE_API_KEY ?? "";

// Auth client — signUp / signIn / signOut / onAuthStateChange / getSession
export const auth = createClient({
  url:      API_URL,
  database: DB_NAME,
  apiKey:   API_KEY,
});