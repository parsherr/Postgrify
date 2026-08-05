/**
 * LoginPage — email + şifre ile admin girişi.
 * Grid pattern arka plan, fade-in animasyonlu kart.
 */

import React from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useAuthContext } from "@/hooks/useAuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuthContext();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [isPending, setIsPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsPending(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Giriş başarısız");
    } finally {
      setIsPending(false);
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
            {/* Email */}
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs">
                E-posta
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@postgrify.local"
                autoComplete="email"
                autoFocus
                disabled={isPending}
                className="text-sm"
              />
            </div>

            {/* Şifre */}
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs">
                Şifre
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••••••"
                  autoComplete="current-password"
                  disabled={isPending}
                  className="pr-9 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 transition-colors hover:text-muted-foreground"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded border border-red-900/50 bg-red-950/30 px-3 py-2">
                <p className="text-xs text-red-400">{error}</p>
              </div>
            )}

            <Button
              type="submit"
              disabled={isPending || !email || !password}
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
            Argon2id · JWT · Redis session
          </p>
        </div>
      </div>
    </div>
  );
}