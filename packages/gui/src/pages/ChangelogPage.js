import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * ChangelogPage — tüm CHANGELOG.md içeriğini versiyonlara göre listeler.
 * Sidebar'daki "Changes" linkinden açılır.
 */
import { parseChangelog } from "@/lib/changelog";
import changelogRaw from "../../../../CHANGELOG.md?raw";
const ENTRIES = parseChangelog(changelogRaw);
const SECTION_COLORS = {
    Fixed: "text-emerald-400",
    Added: "text-sky-400",
    Changed: "text-amber-400",
    Removed: "text-red-400",
    Security: "text-purple-400",
    Deprecated: "text-orange-400",
};
export default function ChangelogPage() {
    return (_jsxs("div", { className: "flex h-full flex-col overflow-y-auto p-8", children: [_jsxs("div", { className: "mb-8", children: [_jsx("h1", { className: "text-2xl font-medium tracking-[-0.03em] text-white", children: "Changelog" }), _jsx("p", { className: "mt-1 text-sm text-zinc-400", children: "Postgrify s\u00FCr\u00FCm ge\u00E7mi\u015Fi ve de\u011Fi\u015Fiklikler." })] }), _jsxs("div", { className: "relative flex flex-col gap-10", children: [_jsx("div", { className: "absolute left-[7px] top-2 bottom-2 w-px bg-zinc-800" }), ENTRIES.map((entry) => (_jsxs("div", { className: "relative flex gap-6", children: [_jsx("div", { className: "relative mt-1.5 h-3.5 w-3.5 shrink-0", children: _jsx("div", { className: "h-3.5 w-3.5 rounded-full border-2 border-zinc-700 bg-zinc-950" }) }), _jsxs("div", { className: "flex-1 pb-2", children: [_jsxs("div", { className: "flex items-baseline gap-3", children: [_jsxs("span", { className: "font-mono text-lg font-semibold text-white", children: ["v", entry.version] }), _jsx("span", { className: "text-xs text-zinc-500", children: entry.date })] }), entry.sections.length > 0 ? (_jsx("div", { className: "mt-3 flex flex-col gap-4", children: entry.sections.map((section) => (_jsxs("div", { children: [_jsx("p", { className: `mb-1.5 text-xs font-semibold uppercase tracking-widest ${SECTION_COLORS[section.title] ?? "text-zinc-400"}`, children: section.title }), _jsx("ul", { className: "space-y-1.5", children: section.items.map((item, i) => (_jsxs("li", { className: "flex items-start gap-2 text-sm text-zinc-300", children: [_jsx("span", { className: "mt-2 h-1 w-1 shrink-0 rounded-full bg-zinc-600" }), _jsx("span", { className: "leading-relaxed", children: item })] }, i))) })] }, section.title))) })) : (_jsx("p", { className: "mt-2 text-sm text-zinc-500 italic", children: entry.raw || "No details." }))] })] }, entry.version)))] })] }));
}
