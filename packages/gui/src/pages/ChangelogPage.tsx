/**
 * ChangelogPage — lists all CHANGELOG.md content grouped by version.
 * Opened from the "Changes" link in the Sidebar.
 */

import { parseChangelog } from "@/lib/changelog";
import changelogRaw from "../../../../CHANGELOG.md?raw";

const ENTRIES = parseChangelog(changelogRaw);

const SECTION_COLORS: Record<string, string> = {
  Fixed: "text-emerald-400",
  Added: "text-sky-400",
  Changed: "text-amber-400",
  Removed: "text-red-400",
  Security: "text-purple-400",
  Deprecated: "text-orange-400",
};

export default function ChangelogPage() {
  return (
    <div className="flex h-full flex-col overflow-y-auto p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-medium tracking-[-0.03em] text-white">
          Changelog
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Postgrify version history and changes.
        </p>
      </div>

      {/* Version list */}
      <div className="relative flex flex-col gap-10">
        {/* Vertical line */}
        <div className="absolute left-[7px] top-2 bottom-2 w-px bg-zinc-800" />

        {ENTRIES.map((entry) => (
          <div key={entry.version} className="relative flex gap-6">
            {/* Nokta */}
            <div className="relative mt-1.5 h-3.5 w-3.5 shrink-0">
              <div className="h-3.5 w-3.5 rounded-full border-2 border-zinc-700 bg-zinc-950" />
            </div>

            {/* Content */}
            <div className="flex-1 pb-2">
              {/* Version heading */}
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-lg font-semibold text-white">
                  v{entry.version}
                </span>
                <span className="text-xs text-zinc-500">{entry.date}</span>
              </div>

              {/* Sectionlar */}
              {entry.sections.length > 0 ? (
                <div className="mt-3 flex flex-col gap-4">
                  {entry.sections.map((section) => (
                    <div key={section.title}>
                      <p
                        className={`mb-1.5 text-xs font-semibold uppercase tracking-widest ${
                          SECTION_COLORS[section.title] ?? "text-zinc-400"
                        }`}
                      >
                        {section.title}
                      </p>
                      <ul className="space-y-1.5">
                        {section.items.map((item, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-2 text-sm text-zinc-300"
                          >
                            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-zinc-600" />
                            <span className="leading-relaxed">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-zinc-500 italic">
                  {entry.raw || "No details."}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
