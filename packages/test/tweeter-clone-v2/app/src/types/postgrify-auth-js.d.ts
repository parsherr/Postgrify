/**
 * Minimal ambient declarations for @postgrify/auth-js
 * (built without .d.ts — tsup --no-dts)
 */
declare module "@postgrify/auth-js" {
  export interface AuthError {
    message: string;
    status?: number;
  }

  export interface AuthUser {
    id: string;
    email: string;
    [key: string]: unknown;
  }

  export interface AuthSession {
    accessToken: string;
    refreshToken: string;
    expiresIn: string;
    /** Always populated on signIn/signUp success and token refresh. */
    user: Pick<AuthUser, "id" | "email" | "role">;
  }

  export interface SignUpOptions {
    email: string;
    password: string;
    metadata?: Record<string, unknown>;
  }

  export interface SignInOptions {
    email: string;
    password: string;
  }

  export type AuthEvent =
    | "SIGNED_IN"
    | "SIGNED_OUT"
    | "TOKEN_REFRESHED"
    | "USER_UPDATED";

  export type AuthStateChangeCallback = (
    event: AuthEvent,
    session: AuthSession | null
  ) => void;

  export type UserResponse = { data: AuthUser | null; error: AuthError | null };

  export interface PostgrifyAuth {
    signUp(opts: SignUpOptions): Promise<{ data: AuthSession | null; error: AuthError | null }>;
    signIn(opts: SignInOptions): Promise<{ data: AuthSession | null; error: AuthError | null }>;
    signOut(): Promise<{ error: AuthError | null }>;
    getSession(): Promise<{ data: AuthSession | null; error: AuthError | null }>;
    getUser(): Promise<UserResponse>;
    onAuthStateChange(callback: AuthStateChangeCallback): () => void;
  }

  export interface ClientConfig {
    url: string;
    database: string;
    apiKey?: string;
  }

  export function createClient(config: ClientConfig): PostgrifyAuth;

  export interface DataClientConfig {
    url: string;
    database: string;
    token?: string;
  }

  export class DataClient {
    constructor(config: DataClientConfig);
  }

  export function createDataClient(config: DataClientConfig): DataClient;
}