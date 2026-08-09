/**
 * CHANGELOG.md parse yardımcısı.
 *
 * Vite'ın `?raw` import'u ile CHANGELOG.md build anında bundle'a gömülür.
 * Runtime'da API isteği gerekmez.
 *
 * Format varsayımı: Keep a Changelog
 *   ## [version] — YYYY-MM-DD
 *   ### Section
 *   - madde
 */

export interface ChangelogEntry {
  version: string;
  date: string;
  /** Her section: başlık + maddeler */
  sections: ChangelogSection[];
  /** Ham markdown (fallback render için) */
  raw: string;
}

export interface ChangelogSection {
  title: string;
  items: string[];
}

/**
 * CHANGELOG.md raw string'ini parse eder.
 * Her `## [x.y.z]` bloğu bir entry olur.
 */
export function parseChangelog(raw: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];

  // ## [version] — date  ya da  ## [version] - date
  const versionRegex = /^## \[([^\]]+)\]\s*[—\-]\s*(.+)$/m;
  // Blokları ## ile böl
  const blocks = raw.split(/^(?=## \[)/m).filter((b) => b.trim());

  for (const block of blocks) {
    const header = block.split("\n")[0].trim();
    const match = header.match(versionRegex);
    if (!match) continue;

    const version = match[1].trim();
    const date = match[2].trim();
    const body = block.slice(header.length).trim();
    const sections = parseSections(body);

    entries.push({ version, date, sections, raw: body });
  }

  return entries;
}

function parseSections(body: string): ChangelogSection[] {
  const sections: ChangelogSection[] = [];
  // ### başlıklarla böl
  const parts = body.split(/^(?=### )/m).filter((p) => p.trim());

  for (const part of parts) {
    const lines = part.split("\n");
    const title = lines[0].replace(/^###\s*/, "").trim();
    const items = lines
      .slice(1)
      .map((l) => l.replace(/^[-*]\s*/, "").trim())
      .filter((l) => l.length > 0);
    if (title) sections.push({ title, items });
  }

  return sections;
}

/** En son sürüm entry'sini döner (ilk entry). */
export function latestEntry(entries: ChangelogEntry[]): ChangelogEntry | null {
  return entries[0] ?? null;
}

/** localStorage key — hangi versiyonun modal'ı görüldü */
export const SEEN_VERSION_KEY = "postgrify_seen_version";