import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
    const [error, setError] = React.useState(null);
    async function handleSubmit(e) {
        e.preventDefault();
        setError(null);
        setIsPending(true);
        try {
            await login(email, password);
            navigate("/");
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "Giriş başarısız");
        }
        finally {
            setIsPending(false);
        }
    }
    return (_jsxs("div", { className: "relative flex min-h-screen items-center justify-center overflow-hidden bg-background", children: [_jsx("div", { className: "pointer-events-none absolute inset-0 opacity-40", style: {
                    backgroundImage: "linear-gradient(to right, hsl(240 3.7% 15.9% / 0.5) 1px, transparent 1px), linear-gradient(to bottom, hsl(240 3.7% 15.9% / 0.5) 1px, transparent 1px)",
                    backgroundSize: "24px 24px",
                } }), _jsx("div", { className: "pointer-events-none absolute inset-0", style: {
                    background: "radial-gradient(ellipse 60% 50% at 50% 50%, hsl(240 10% 10% / 0.8), transparent)",
                } }), _jsx("div", { className: "relative z-10 w-full max-w-sm animate-fade-in px-4", children: _jsxs("div", { className: "rounded border border-border bg-card p-8 shadow-2xl shadow-black/50", children: [_jsxs("div", { className: "mb-8 flex flex-col items-center gap-3", children: [_jsx("div", { className: "flex h-10 w-10 items-center justify-center rounded border border-border bg-background text-xl font-bold text-foreground", children: "\u25C8" }), _jsxs("div", { className: "text-center", children: [_jsx("h1", { className: "text-base font-semibold tracking-tight text-foreground", children: "Postgrify" }), _jsx("p", { className: "mt-0.5 text-xs text-muted-foreground", children: "PostgreSQL Gateway" })] })] }), _jsxs("form", { onSubmit: handleSubmit, className: "space-y-4", children: [_jsxs("div", { className: "space-y-1.5", children: [_jsx(Label, { htmlFor: "email", className: "text-xs", children: "E-posta" }), _jsx(Input, { id: "email", type: "email", value: email, onChange: (e) => setEmail(e.target.value), placeholder: "admin@postgrify.local", autoComplete: "email", autoFocus: true, disabled: isPending, className: "text-sm" })] }), _jsxs("div", { className: "space-y-1.5", children: [_jsx(Label, { htmlFor: "password", className: "text-xs", children: "\u015Eifre" }), _jsxs("div", { className: "relative", children: [_jsx(Input, { id: "password", type: showPassword ? "text" : "password", value: password, onChange: (e) => setPassword(e.target.value), placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", autoComplete: "current-password", disabled: isPending, className: "pr-9 text-sm" }), _jsx("button", { type: "button", onClick: () => setShowPassword((s) => !s), className: "absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 transition-colors hover:text-muted-foreground", tabIndex: -1, children: showPassword ? (_jsx(EyeOff, { className: "h-3.5 w-3.5" })) : (_jsx(Eye, { className: "h-3.5 w-3.5" })) })] })] }), error && (_jsx("div", { className: "rounded border border-red-900/50 bg-red-950/30 px-3 py-2", children: _jsx("p", { className: "text-xs text-red-400", children: error }) })), _jsx(Button, { type: "submit", disabled: isPending || !email || !password, className: "w-full", children: isPending ? (_jsxs(_Fragment, { children: [_jsx(Loader2, { className: "mr-2 h-3.5 w-3.5 animate-spin" }), "Giri\u015F yap\u0131l\u0131yor\u2026"] })) : ("Giriş Yap") })] }), _jsx("p", { className: "mt-6 text-center text-2xs text-muted-foreground/40", children: "Argon2id \u00B7 JWT \u00B7 Redis session" })] }) })] }));
}
