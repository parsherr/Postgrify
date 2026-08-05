/**
 * LoginPage — admin secret ile giriş.
 * Grid pattern arka plan, fade-in animasyonlu kart.
 */

import React from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useAdminLogin } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const navigate = useNavigate();
  const { mutateAsync: login, isPending, error } = useAdminLogin();
  const [secret, setSecret] = React.useState("");
  const [showSecret, setShowSecret] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await login(secret);
      navigate("/");
    } catch {
      // error state useAdminLogin'den gelir
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background">
      {/* Grid pattern arka plan */}
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(to right, hsl(240 3.7% 15.9% / 0.5) 1px, transparent 1px), linear-gradient(to bottom, hsl(240 3.7% 15.9% / 0.5) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      {/* Radial gradient — merkez glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 50%, hsl(240 10% 10% / 0.8), transparent)",
        }}
      />

      {/* Login kartı */}
      <div className="relative z-10 w-full max-w-sm animate-fade-in px-4">
        <div className="rounded border border-border bg-card p-8 shadow-2xl shadow-black/50">
          {/* Logo */}
          <div className="mb-8 flex flex-col items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded border border-border bg-background text-xl font-bold text-foreground">
              ◈
            </div>
            <div className="text-center">
              <h1 className="text-base font-semibold tracking-tight text-foreground">
                Postgrify
              </h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                PostgreSQL Gateway
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="secret" className="text-xs">
                Admin Secret
              </Label>
              <div className="relative">
                <Input
                  id="secret"
                  type={showSecret ? "text" : "password"}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="••••••••••••••••"
                  autoComplete="current-password"
                  autoFocus
                  disabled={isPending}
                  className="pr-9 font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret((s) => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 transition-colors hover:text-muted-foreground"
                  tabIndex={-1}
                >
                  {showSecret ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded border border-red-900/50 bg-red-950/30 px-3 py-2">
                <p className="text-xs text-red-400">
                  {error instanceof Error ? error.message : "Giriş başarısız"}
                </p>
              </div>
            )}

            <Button
              type="submit"
              disabled={isPending || !secret}
              className="w-full"
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Giriş yapılıyor…
                </>
              ) : (
                "Giriş Yap"
              )}
            </Button>
          </form>

          <p className="mt-6 text-center text-2xs text-muted-foreground/40">
            JWT_SECRET ile imzalı admin token
          </p>
        </div>
      </div>
    </div>
  );
}