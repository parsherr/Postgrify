import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * SetupPage — ilk çalıştırma sihirbazı.
 *
 * Görsel dil LoginPage ile aynı: siyah zemin, GrainGradient sağ panel,
 * floating-label input'lar. 3 adım arası slide+fade animasyonu.
 *
 * Adımlar:
 *  1 — Admin hesabı (e-posta + şifre + tekrar)
 *  2 — PostgreSQL bağlantısı (host + port + kullanıcı + şifre)
 *  3 — Özet + tamamla
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { GrainGradient } from "@paper-design/shaders-react";
import { postSetup } from "../lib/api";
import { useAuthContext } from "../hooks/useAuthContext";
function FieldBox({ label, value, onChange, type = "text", required, placeholder }) {
    const [focused, setFocused] = useState(false);
    const lifted = focused || value.length > 0;
    return (_jsxs("div", { className: "relative", children: [_jsx("input", { type: type, value: value, onChange: onChange, onFocus: () => setFocused(true), onBlur: () => setFocused(false), required: required, placeholder: placeholder ?? "", className: "peer h-16 w-full rounded-[10px] border border-zinc-700 bg-zinc-900 px-5 pt-6 pb-2 text-base text-white outline-none transition-colors placeholder:text-transparent focus:border-zinc-500" }), _jsx("label", { className: `pointer-events-none absolute left-5 text-zinc-400 transition-all duration-150 ${lifted ? "top-2 text-[11px]" : "top-1/2 -translate-y-1/2 text-base"}`, children: label })] }));
}
// ── Step indicator ────────────────────────────────────────────────────────────
const STEP_LABELS = ["Admin Hesabı", "Veritabanı", "Özet"];
function StepIndicator({ current }) {
    return (_jsx("div", { className: "flex items-center gap-0", children: STEP_LABELS.map((label, i) => {
            const idx = i + 1;
            const done = idx < current;
            const active = idx === current;
            return (_jsxs("div", { className: "flex items-center", children: [_jsxs("div", { className: "flex flex-col items-center", children: [_jsx("div", { className: `flex h-9 w-9 items-center justify-center rounded-full text-sm font-medium transition-all duration-300 ${active
                                    ? "bg-white text-black"
                                    : done
                                        ? "bg-zinc-700 text-white"
                                        : "bg-zinc-800 text-zinc-500"}`, children: done ? (
                                // Tik ikonu
                                _jsx("svg", { width: "14", height: "14", viewBox: "0 0 14 14", fill: "none", children: _jsx("path", { d: "M2.5 7L5.5 10L11.5 4", stroke: "white", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }) })) : (idx) }), _jsx("span", { className: `mt-1.5 text-[10px] tracking-wide transition-colors duration-300 ${active ? "text-zinc-300" : "text-zinc-600"}`, children: label })] }), i < STEP_LABELS.length - 1 && (_jsx("div", { className: `mb-5 h-px w-12 transition-colors duration-300 ${done ? "bg-zinc-600" : "bg-zinc-800"}` }))] }, idx));
        }) }));
}
// ── Adım başlıkları ────────────────────────────────────────────────────────────
const STEP_HEADINGS = {
    1: { title: "Admin hesabını\noluştur", sub: "Sisteme giriş için kullanacağın hesap." },
    2: { title: "Veritabanını\nbağla", sub: "PostgreSQL bağlantı bilgilerini gir." },
    3: { title: "Her şey\nhazır", sub: "Ayarları gözden geçir ve tamamla." },
};
// ── Ana bileşen ────────────────────────────────────────────────────────────────
export default function SetupPage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { login, loginWithTokens } = useAuthContext();
    // Adım durumu
    const [step, setStep] = useState(1);
    const [direction, setDirection] = useState("forward");
    // Adım 1 — Admin hesabı
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [passwordConfirm, setPasswordConfirm] = useState("");
    // Adım 2 — PostgreSQL
    const [pgHost, setPgHost] = useState("localhost");
    const [pgPort, setPgPort] = useState("5432");
    const [pgUser, setPgUser] = useState("postgres");
    const [pgPassword, setPgPassword] = useState("");
    // UI durumu
    const [error, setError] = useState("");
    const [isPending, setIsPending] = useState(false);
    // ── Validasyon ──────────────────────────────────────────────────────────────
    function validateStep1() {
        if (!email.includes("@"))
            return "Geçerli bir e-posta gir.";
        if (password.length < 8)
            return "Şifre en az 8 karakter olmalı.";
        if (password !== passwordConfirm)
            return "Şifreler eşleşmiyor.";
        return "";
    }
    function validateStep2() {
        const port = Number(pgPort);
        if (!pgHost.trim())
            return "Host alanı boş olamaz.";
        if (!pgUser.trim())
            return "Kullanıcı adı boş olamaz.";
        if (!pgPassword.trim())
            return "Şifre boş olamaz.";
        if (!Number.isInteger(port) || port < 1 || port > 65535)
            return "Port 1–65535 arasında olmalı.";
        return "";
    }
    // ── Adım geçişleri ──────────────────────────────────────────────────────────
    function goNext() {
        setError("");
        const err = step === 1 ? validateStep1() : step === 2 ? validateStep2() : "";
        if (err) {
            setError(err);
            return;
        }
        setDirection("forward");
        setStep(s => s + 1);
    }
    function goBack() {
        setError("");
        setDirection("back");
        setStep(s => s - 1);
    }
    // ── Submit ──────────────────────────────────────────────────────────────────
    async function handleSubmit() {
        setError("");
        setIsPending(true);
        try {
            const result = await postSetup({
                adminEmail: email,
                adminPassword: password,
                pgHost,
                pgPort: Number(pgPort),
                pgUser,
                pgPassword,
            });
            // Cache'i güncelle — SetupGuard artık configured=true görecek
            queryClient.setQueryData(["setup-status"], { configured: true });
            // API setup response'unda token varsa direkt kullan (container modunda
            // /auth/admin/login env var'ları henüz güncellenmediğinden 503 verir).
            // Token yoksa klasik login dene.
            if (result.accessToken) {
                loginWithTokens(result.accessToken, result.refreshToken ?? null, result.email ?? email);
            }
            else {
                await login(email, password);
            }
            // Dashboard'a yönlendir
            navigate("/", { replace: true });
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : "Kurulum başarısız.";
            setError(msg);
        }
        finally {
            setIsPending(false);
        }
    }
    // ── Sağ panel sloganı ───────────────────────────────────────────────────────
    const heading = STEP_HEADINGS[step];
    const slideClass = direction === "forward"
        ? "animate-in fade-in slide-in-from-right-4 duration-300"
        : "animate-in fade-in slide-in-from-left-4 duration-300";
    // ── Render ──────────────────────────────────────────────────────────────────
    return (_jsx("section", { className: "min-h-screen bg-black p-3 text-white antialiased [font-synthesis:none]", children: _jsxs("div", { className: "grid min-h-[calc(100vh-1.5rem)] rounded-md lg:grid-cols-2 lg:gap-3", children: [_jsxs("div", { className: "flex flex-col justify-center px-8 sm:px-16 lg:px-20", children: [_jsx("div", { className: "mb-10", children: _jsx("img", { src: "/black-white-logo.png", alt: "Postgrify", className: "h-8 w-8 object-contain invert" }) }), _jsxs(_Fragment, { children: [_jsx("div", { className: "mb-8", children: _jsx(StepIndicator, { current: step }) }), _jsxs("div", { className: slideClass, children: [_jsx("h1", { className: "whitespace-pre-line text-5xl font-medium tracking-[-0.05em] text-white sm:text-6xl lg:text-[64px] lg:leading-[0.98]", children: heading.title }), _jsx("p", { className: "mt-2 text-sm text-zinc-400", children: heading.sub })] }, `heading-${step}`), _jsxs("div", { className: `mt-8 space-y-5 ${slideClass}`, children: [step === 1 && (_jsxs(_Fragment, { children: [_jsx(FieldBox, { label: "E-posta", value: email, onChange: e => setEmail(e.target.value), type: "email", required: true }), _jsx(FieldBox, { label: "\u015Eifre", value: password, onChange: e => setPassword(e.target.value), type: "password", required: true }), _jsx(FieldBox, { label: "\u015Eifre tekrar", value: passwordConfirm, onChange: e => setPasswordConfirm(e.target.value), type: "password", required: true })] })), step === 2 && (_jsxs(_Fragment, { children: [_jsx(FieldBox, { label: "Host", value: pgHost, onChange: e => setPgHost(e.target.value), required: true }), _jsxs("div", { className: "grid grid-cols-3 gap-3", children: [_jsx("div", { className: "col-span-1", children: _jsx(FieldBox, { label: "Port", value: pgPort, onChange: e => setPgPort(e.target.value), required: true }) }), _jsx("div", { className: "col-span-2", children: _jsx(FieldBox, { label: "Kullan\u0131c\u0131", value: pgUser, onChange: e => setPgUser(e.target.value), required: true }) })] }), _jsx(FieldBox, { label: "\u015Eifre", value: pgPassword, onChange: e => setPgPassword(e.target.value), type: "password", required: true })] })), step === 3 && (_jsxs("div", { className: "space-y-2 rounded-[10px] border border-zinc-800 bg-zinc-900 p-5 text-sm", children: [_jsx(SummaryRow, { label: "E-posta", value: email }), _jsx(SummaryRow, { label: "\u015Eifre", value: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" }), _jsx("div", { className: "my-3 h-px bg-zinc-800" }), _jsx(SummaryRow, { label: "Host", value: pgHost }), _jsx(SummaryRow, { label: "Port", value: pgPort }), _jsx(SummaryRow, { label: "Kullan\u0131c\u0131", value: pgUser }), _jsx(SummaryRow, { label: "DB \u015Eifresi", value: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" })] }))] }, `form-${step}`), error && (_jsx("p", { className: "mt-3 text-sm text-red-400", children: error })), _jsxs("div", { className: "mt-8 flex items-center gap-3", children: [step > 1 && (_jsx("button", { type: "button", onClick: goBack, className: "flex h-[52px] items-center justify-center rounded-[10px] border border-zinc-700 bg-zinc-900 px-6 text-base font-medium text-white transition-colors hover:bg-zinc-800", children: "Geri" })), step < 3 ? (_jsx("button", { type: "button", onClick: goNext, className: "flex h-[52px] flex-1 items-center justify-center rounded-[10px] border border-zinc-600 bg-white text-base font-medium text-black transition-colors hover:bg-zinc-100", children: "Devam Et" })) : (_jsxs("button", { type: "button", onClick: handleSubmit, disabled: isPending, className: "flex h-[52px] flex-1 items-center justify-center gap-2 rounded-[10px] border border-zinc-600 bg-white text-base font-medium text-black transition-colors hover:bg-zinc-100 disabled:opacity-50", children: [isPending && (_jsxs("svg", { className: "h-4 w-4 animate-spin", viewBox: "0 0 24 24", fill: "none", children: [_jsx("circle", { className: "opacity-25", cx: "12", cy: "12", r: "10", stroke: "currentColor", strokeWidth: "4" }), _jsx("path", { className: "opacity-75", fill: "currentColor", d: "M4 12a8 8 0 018-8v8H4z" })] })), "Kurulumu Tamamla"] }))] }), _jsx("p", { className: "mt-10 text-center text-[11px] tracking-wide text-zinc-600", children: "Argon2id \u00B7 JWT \u00B7 Redis session" })] })] }), _jsxs("div", { className: "relative hidden overflow-hidden rounded-md bg-black text-white lg:block", children: [_jsx(GrainGradient, { speed: 0.3, scale: 1, rotation: 0, offsetX: 0, offsetY: 0, softness: 0.5, intensity: 0.5, noise: 0.25, shape: "corners", frame: 2854.5, colors: ["#FFFFFF", "#EFFF12", "#EFFF12", "#FFFFFF"], colorBack: "#00000000", className: "absolute inset-0 bg-black" }), _jsx("div", { className: "relative z-10 flex h-full w-full flex-col justify-between p-8 sm:p-12", children: _jsxs("h2", { className: "max-w-[520px] pt-0 text-5xl font-medium tracking-[-0.05em] text-white sm:text-6xl lg:pt-16 lg:text-[64px] lg:leading-[0.98] xl:text-[70px]", children: ["Setup fast,", _jsx("br", {}), "Scale faster"] }) })] })] }) }));
}
// ── Yardımcı: özet satırı ─────────────────────────────────────────────────────
function SummaryRow({ label, value }) {
    return (_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-zinc-500", children: label }), _jsx("span", { className: "text-zinc-200", children: value })] }));
}
