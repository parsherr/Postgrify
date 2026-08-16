import { describe, it, expect } from "vitest";
import {
  buildGoTrueUser,
  buildSessionResponse,
  expirySeconds,
  pickRefreshToken,
  parseDurationMs,
} from "../../../src/routes/db/auth/sessionResponse.js";

describe("sessionResponse helpers", () => {
  it("parseDurationMs and expirySeconds", () => {
    expect(parseDurationMs("15m")).toBe(15 * 60_000);
    expect(expirySeconds("1h")).toBe(3600);
  });

  it("pickRefreshToken accepts both casings", () => {
    expect(pickRefreshToken({ refresh_token: "a" })).toBe("a");
    expect(pickRefreshToken({ refreshToken: "b" })).toBe("b");
    expect(pickRefreshToken({})).toBeUndefined();
  });

  it("buildGoTrueUser maps Postgrify role into app_metadata", () => {
    const u = buildGoTrueUser({
      id: "1",
      email: "a@b.c",
      role: "admin",
      is_active: true,
      email_verified: false,
      created_at: "2026-01-01T00:00:00.000Z",
      metadata: { x: 1 },
      provider: "github",
    });
    expect(u.role).toBe("authenticated");
    expect(u.email_confirmed_at).toBeNull();
    expect(u.app_metadata).toMatchObject({
      provider: "github",
      providers: ["github"],
      role: "admin",
    });
    expect(u.user_metadata).toEqual({ x: 1 });
  });

  it("buildSessionResponse snake_case tokens", () => {
    const now = 1_700_000_000_000;
    const s = buildSessionResponse({
      accessToken: "jwt",
      refreshToken: "rt",
      user: { id: "1", email: "a@b.c", role: "viewer", email_verified: true },
      accessExpiry: "15m",
      nowMs: now,
    });
    expect(s.access_token).toBe("jwt");
    expect(s.refresh_token).toBe("rt");
    expect(s.token_type).toBe("bearer");
    expect(s.expires_in).toBe(900);
    expect(s.expires_at).toBe(Math.floor(now / 1000) + 900);
  });
});
