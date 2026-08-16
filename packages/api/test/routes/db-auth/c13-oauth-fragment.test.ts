import { describe, it, expect } from "vitest";
import { sessionFragment, safeAppRedirect } from "../../../src/routes/db/auth/redirectSafe.js";

viStubAppUrl();

function viStubAppUrl() {
  process.env.APP_URL = "http://localhost:5173";
}

describe("C-13 sessionFragment", () => {
  it("includes GoTrue fragment keys", () => {
    const f = sessionFragment({
      accessToken: "at",
      refreshToken: "rt",
      expiresIn: 900,
      expiresAt: 1700000900,
      type: "oauth",
    });
    const p = Object.fromEntries(new URLSearchParams(f));
    expect(p).toMatchObject({
      access_token: "at",
      refresh_token: "rt",
      token_type: "bearer",
      expires_in: "900",
      expires_at: "1700000900",
      type: "oauth",
    });
  });

  it("safeAppRedirect rejects foreign origin", async () => {
    // Re-import after env so config picks up APP_URL — already stubbed above
    const { safeAppRedirect: safe } = await import(
      "../../../src/routes/db/auth/redirectSafe.js"
    );
    expect(safe("https://evil.com/x")).toBe("http://localhost:5173/auth/callback");
    expect(safe("http://localhost:5173/dash")).toBe("http://localhost:5173/dash");
  });
});
