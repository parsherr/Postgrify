import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { GrainGradient } from "@paper-design/shaders-react";
import { AuthContext } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
// ── Floating-label input (referans tasarımdan birebir) ────────────────────────
// Odaklanmadan önce: sol taraf gri placeholder değer, sağ taraf beyaz label.
// Odaklanınca: label kaybolur, input temizlenir ve kullanıcı yazmaya başlar.
// Floating-label input — UX kuralları:
// • Boş + odaklanmamış: label orta hizalı büyük placeholder gibi durur
// • Odaklanınca veya değer varsa: label yukarı çıkar, küçülür
// • Yazılan text her zaman beyaz
function FieldBox({ label, value, type = "text", onChange, required, autoComplete, }) {
    const [isFocused, setIsFocused] = useState(false);
    const isFloated = isFocused || value.length > 0;
    return (_jsxs("label", { className: "relative flex h-14 cursor-text items-center rounded-[10px] border border-white/15 bg-white/5 px-5 transition-colors focus-within:border-white/40", children: [_jsx("span", { className: `pointer-events-none absolute left-5 select-none transition-all duration-150 ${isFloated
                    ? "top-[7px] text-[11px] font-medium tracking-wide text-white/45"
                    : "top-1/2 -translate-y-1/2 text-base text-white/40"}`, children: label }), _jsx("input", { type: type, name: autoComplete ?? label.toLowerCase(), value: value, required: required, autoComplete: autoComplete, "aria-label": label, onFocus: () => setIsFocused(true), onBlur: () => setIsFocused(false), onChange: onChange, className: `w-full bg-transparent text-base text-white outline-none transition-all duration-150 ${isFloated ? "pt-4" : "pt-0"}` })] }));
}
// ── Disabled sosyal giriş butonu ──────────────────────────────────────────────
function SocialButton({ icon, label }) {
    return (_jsxs("button", { type: "button", disabled: true, className: "flex h-12 w-full cursor-not-allowed items-center justify-center gap-3 rounded-[10px] border border-white/20 bg-white/5 text-base font-medium text-white/50 transition-colors", children: [_jsx("span", { className: "shrink-0", children: icon }), _jsx("span", { children: label })] }));
}
// ── İkonlar ───────────────────────────────────────────────────────────────────
function GoogleIcon() {
    return (_jsxs("svg", { width: "18", height: "18", viewBox: "0 0 24 24", "aria-hidden": "true", children: [_jsx("path", { d: "M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z", fill: "#4285F4" }), _jsx("path", { d: "M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23Z", fill: "#34A853" }), _jsx("path", { d: "M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84Z", fill: "#FBBC05" }), _jsx("path", { d: "M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z", fill: "#EB4335" })] }));
}
// ── Ana bileşen ───────────────────────────────────────────────────────────────
export default function LoginPage() {
    const navigate = useNavigate();
    const auth = React.useContext(AuthContext);
    const login = auth.login;
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState(null);
    const [isPending, setIsPending] = useState(false);
    // İlk kurulum akışı — admin hesabı yoksa API 404/setup döner
    const [needsSetup, setNeedsSetup] = useState(false);
    const [setupEmail, setSetupEmail] = useState("");
    const [setupPw, setSetupPw] = useState("");
    const [setupPw2, setSetupPw2] = useState("");
    async function handleLogin(e) {
        e.preventDefault();
        setError(null);
        setIsPending(true);
        try {
            await login(email, password);
            navigate("/", { replace: true });
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : "Giriş başarısız";
            if (msg.includes("setup") || msg.includes("404")) {
                setNeedsSetup(true);
            }
            else {
                setError(msg);
            }
        }
        finally {
            setIsPending(false);
        }
    }
    async function handleSetup(e) {
        e.preventDefault();
        setError(null);
        if (setupPw !== setupPw2) {
            setError("Şifreler eşleşmiyor");
            return;
        }
        setIsPending(true);
        try {
            await api.post("/setup", { email: setupEmail, password: setupPw });
            await login(setupEmail, setupPw);
            navigate("/", { replace: true });
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "Kurulum başarısız");
        }
        finally {
            setIsPending(false);
        }
    }
    return (_jsx("section", { className: "min-h-screen bg-black p-3 text-white antialiased [font-synthesis:none]", children: _jsxs("div", { className: "grid min-h-[calc(100vh-1.5rem)] gap-6 lg:grid-cols-2", children: [_jsx("div", { className: "flex min-h-[760px] items-start rounded-md border border-white/10 bg-[#101014] px-6 py-12 sm:px-10 lg:min-h-0 lg:px-14 lg:py-28 xl:px-20", children: _jsxs("div", { className: "mx-auto w-full max-w-[520px]", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-3xl font-medium tracking-[-0.04em] text-white sm:text-4xl lg:text-[42px] lg:leading-[1.05] xl:text-[50px]", children: needsSetup ? "İlk kurulum" : "Tekrar hoş geldiniz" }), _jsx("p", { className: "mt-3 text-lg leading-snug text-white/55 sm:text-xl lg:text-2xl xl:text-3xl", children: needsSetup ? "Admin hesabı oluştur" : "PostgreSQL Gateway" })] }), !needsSetup ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "mt-10", children: _jsx(SocialButton, { icon: _jsx(GoogleIcon, {}), label: "Google ile giri\u015F" }) }), _jsx("div", { className: "my-10 text-center text-xl font-medium text-white/50", children: "veya" }), _jsxs("form", { onSubmit: handleLogin, className: "space-y-5", children: [_jsx(FieldBox, { label: "E-posta", value: email, type: "email", onChange: e => setEmail(e.target.value), required: true, autoComplete: "email" }), _jsx(FieldBox, { label: "\u015Eifre", value: password, type: "password", onChange: e => setPassword(e.target.value), required: true, autoComplete: "current-password" }), error && (_jsx("div", { className: "rounded-[10px] border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-500", children: error })), _jsxs("button", { type: "submit", disabled: isPending, className: "mt-9 flex h-12 w-full items-center justify-center gap-2 rounded-[10px] border border-white/40 bg-white text-xl font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-50", children: [isPending ? (_jsxs("svg", { className: "h-4 w-4 animate-spin", viewBox: "0 0 24 24", fill: "none", children: [_jsx("circle", { className: "opacity-25", cx: "12", cy: "12", r: "10", stroke: "currentColor", strokeWidth: "4" }), _jsx("path", { className: "opacity-75", fill: "currentColor", d: "M4 12a8 8 0 018-8v8H4z" })] })) : null, "Giri\u015F Yap"] })] })] })) : (
                            /* ── Setup formu ─────────────────────────────────────────── */
                            _jsxs("form", { onSubmit: handleSetup, className: "mt-12 space-y-5", children: [_jsx(FieldBox, { label: "E-posta", value: setupEmail, type: "email", onChange: e => setSetupEmail(e.target.value), required: true }), _jsx(FieldBox, { label: "\u015Eifre", value: setupPw, type: "password", onChange: e => setSetupPw(e.target.value), required: true }), _jsx(FieldBox, { label: "\u015Eifre tekrar", value: setupPw2, type: "password", onChange: e => setSetupPw2(e.target.value), required: true }), error && (_jsx("div", { className: "rounded-[10px] border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-500", children: error })), _jsx("button", { type: "submit", disabled: isPending, className: "mt-9 flex h-12 w-full items-center justify-center gap-2 rounded-[10px] border border-white/40 bg-white text-xl font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-50", children: "Hesab\u0131 Olu\u015Ftur" })] })), _jsx("p", { className: "mt-10 text-center text-[11px] tracking-wide text-white/25", children: "Argon2id \u00B7 JWT \u00B7 Redis session" })] }) }), _jsxs("div", { className: "relative hidden overflow-hidden rounded-md bg-black text-white lg:block", children: [_jsx(GrainGradient, { speed: 0.3, scale: 1, rotation: 0, offsetX: 0, offsetY: 0, softness: 0.5, intensity: 0.5, noise: 0.25, shape: "corners", frame: 2854.5, colors: ["#FFFFFF", "#FC7819", "#FC7819", "#FFFFFF"], colorBack: "#00000000", className: "absolute inset-0 bg-black" }), _jsx("div", { className: "relative z-10 flex h-full w-full flex-col justify-between p-8 sm:p-12", children: _jsxs("h2", { className: "max-w-[520px] pt-0 text-5xl font-medium tracking-[-0.05em] text-white sm:text-6xl lg:pt-16 lg:text-[64px] lg:leading-[0.98] xl:text-[70px]", children: ["Query fast,", _jsx("br", {}), "Scale faster"] }) })] })] }) }));
}
