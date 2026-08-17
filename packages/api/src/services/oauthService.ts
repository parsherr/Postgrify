/**
 * OAuth Service — authorization code flow for Google and GitHub.
 *
 * For each provider:
 *   1. getAuthUrl(provider, config)  → URL to redirect the user to
 *   2. exchangeCode(provider, code, config) → access token + user profile
 */

export interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface OAuthUserProfile {
  providerId: string;   // provider'dan gelen benzersiz ID
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
}

// ── Google ───────────────────────────────────────────────────────────────────

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

export function getGoogleAuthUrl(
  cfg: OAuthProviderConfig,
  state: string,
  scopes?: string
): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: scopes?.trim() || "openid email profile",
    state,
    access_type: "offline",
    prompt: "consent",
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
}

export async function exchangeGoogleCode(
  code: string,
  cfg: OAuthProviderConfig
): Promise<OAuthUserProfile> {
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id:     cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri:  cfg.redirectUri,
      grant_type:    "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    throw new Error(`Google token exchange failed: ${tokenRes.status}`);
  }

  const tokenData = await tokenRes.json() as { access_token: string };

  const userRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!userRes.ok) {
    throw new Error(`Google userinfo failed: ${userRes.status}`);
  }

  const user = await userRes.json() as {
    sub: string;
    email: string;
    name?: string;
    picture?: string;
  };

  return {
    providerId: user.sub,
    email:      user.email,
    fullName:   user.name ?? null,
    avatarUrl:  user.picture ?? null,
  };
}

// ── GitHub ───────────────────────────────────────────────────────────────────

const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USERINFO_URL = "https://api.github.com/user";
const GITHUB_EMAILS_URL = "https://api.github.com/user/emails";

export function getGitHubAuthUrl(
  cfg: OAuthProviderConfig,
  state: string,
  scopes?: string
): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: scopes?.trim() || "read:user user:email",
    state,
  });
  return `${GITHUB_AUTH_URL}?${params}`;
}

export async function exchangeGitHubCode(
  code: string,
  cfg: OAuthProviderConfig
): Promise<OAuthUserProfile> {
  const tokenRes = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      code,
      client_id:     cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri:  cfg.redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    throw new Error(`GitHub token exchange failed: ${tokenRes.status}`);
  }

  const tokenData = await tokenRes.json() as { access_token: string };

  const [userRes, emailsRes] = await Promise.all([
    fetch(GITHUB_USERINFO_URL, {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "User-Agent": "Postgrify",
      },
    }),
    fetch(GITHUB_EMAILS_URL, {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "User-Agent": "Postgrify",
      },
    }),
  ]);

  const user = await userRes.json() as {
    id: number;
    name?: string;
    avatar_url?: string;
    email?: string;
  };

  // Find the primary email (some GitHub accounts have no email on their profile)
  let email = user.email ?? "";
  if (!email && emailsRes.ok) {
    const emails = await emailsRes.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
    email = emails.find((e) => e.primary && e.verified)?.email ?? emails[0]?.email ?? "";
  }

  if (!email) {
    throw new Error("Could not retrieve email from GitHub account");
  }

  return {
    providerId: String(user.id),
    email,
    fullName:  user.name ?? null,
    avatarUrl: user.avatar_url ?? null,
  };
}

// ── Router ───────────────────────────────────────────────────────────────────

export function getAuthUrl(
  provider: string,
  cfg: OAuthProviderConfig,
  state: string,
  scopes?: string
): string {
  if (provider === "google") return getGoogleAuthUrl(cfg, state, scopes);
  if (provider === "github") return getGitHubAuthUrl(cfg, state, scopes);
  throw new Error(`Unknown OAuth provider: ${provider}`);
}

export async function exchangeCode(
  provider: string,
  code: string,
  cfg: OAuthProviderConfig
): Promise<OAuthUserProfile> {
  if (provider === "google") return exchangeGoogleCode(code, cfg);
  if (provider === "github") return exchangeGitHubCode(code, cfg);
  throw new Error(`Unknown OAuth provider: ${provider}`);
}