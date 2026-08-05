import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
    async function handleSubmit(e) {
        e.preventDefault();
        try {
            await login(secret);
            navigate("/");
        }
        catch {
            // error state useAdminLogin'den gelir
        }
    }
    return (_jsxs("div", { className: "relative flex min-h-screen items-center justify-center overflow-hidden bg-background", children: [_jsx("div", { className: "pointer-events-none absolute inset-0 opacity-40", style: {
                    backgroundImage: "linear-gradient(to right, hsl(240 3.7% 15.9% / 0.5) 1px, transparent 1px), linear-gradient(to bottom, hsl(240 3.7% 15.9% / 0.5) 1px, transparent 1px)",
                    backgroundSize: "24px 24px",
                } }), _jsx("div", { className: "pointer-events-none absolute inset-0", style: {
                    background: "radial-gradient(ellipse 60% 50% at 50% 50%, hsl(240 10% 10% / 0.8), transparent)",
                } }), _jsx("div", { className: "relative z-10 w-full max-w-sm animate-fade-in px-4", children: _jsxs("div", { className: "rounded border border-border bg-card p-8 shadow-2xl shadow-black/50", children: [_jsxs("div", { className: "mb-8 flex flex-col items-center gap-3", children: [_jsx("div", { className: "flex h-10 w-10 items-center justify-center rounded border border-border bg-background text-xl font-bold text-foreground", children: "\u25C8" }), _jsxs("div", { className: "text-center", children: [_jsx("h1", { className: "text-base font-semibold tracking-tight text-foreground", children: "Postgrify" }), _jsx("p", { className: "mt-0.5 text-xs text-muted-foreground", children: "PostgreSQL Gateway" })] })] }), _jsxs("form", { onSubmit: handleSubmit, className: "space-y-4", children: [_jsxs("div", { className: "space-y-1.5", children: [_jsx(Label, { htmlFor: "secret", className: "text-xs", children: "Admin Secret" }), _jsxs("div", { className: "relative", children: [_jsx(Input, { id: "secret", type: showSecret ? "text" : "password", value: secret, onChange: (e) => setSecret(e.target.value), placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", autoComplete: "current-password", autoFocus: true, disabled: isPending, className: "pr-9 font-mono text-sm" }), _jsx("button", { type: "button", onClick: () => setShowSecret((s) => !s), className: "absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 transition-colors hover:text-muted-foreground", tabIndex: -1, children: showSecret ? (_jsx(EyeOff, { className: "h-3.5 w-3.5" })) : (_jsx(Eye, { className: "h-3.5 w-3.5" })) })] })] }), error && (_jsx("div", { className: "rounded border border-red-900/50 bg-red-950/30 px-3 py-2", children: _jsx("p", { className: "text-xs text-red-400", children: error instanceof Error ? error.message : "Giriş başarısız" }) })), _jsx(Button, { type: "submit", disabled: isPending || !secret, className: "w-full", children: isPending ? (_jsxs(_Fragment, { children: [_jsx(Loader2, { className: "mr-2 h-3.5 w-3.5 animate-spin" }), "Giri\u015F yap\u0131l\u0131yor\u2026"] })) : ("Giriş Yap") })] }), _jsx("p", { className: "mt-6 text-center text-2xs text-muted-foreground/40", children: "JWT_SECRET ile imzal\u0131 admin token" })] }) })] }));
}
