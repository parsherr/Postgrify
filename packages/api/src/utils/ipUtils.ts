/**
 * IP adresi yardımcı fonksiyonları — sıfır bağımlılık.
 *
 * Desteklenen formatlar:
 *   - IPv4 exact:   "192.168.1.100"
 *   - IPv4 CIDR:    "192.168.1.0/24"
 *   - IPv6 exact:   "::1", "2001:db8::1"
 *   - IPv6 CIDR:    "2001:db8::/32"
 *
 * Kullanım:
 *   isIpAllowed("1.2.3.4", { mode: "allowlist", ips: ["1.2.3.0/24"] }) // true
 */

export type IpAllowlistMode = "everyone" | "same_network" | "allowlist";

export interface IpAllowlistConfig {
  mode: IpAllowlistMode;
  /** allowlist modunda geçerli IP/CIDR kuralları. Diğer modlarda görmezden gelinir. */
  ips: string[];
}

/** Varsayılan config — herkese açık (geriye dönük uyumluluk). */
export const DEFAULT_IP_ALLOWLIST: IpAllowlistConfig = {
  mode: "everyone",
  ips: [],
};

/** Maksimum izin verilen kural sayısı (DoS önlemi). */
const MAX_RULES = 100;

// ─────────────────────────────────────────────────────────────────────────────
// IPv4 yardımcıları
// ─────────────────────────────────────────────────────────────────────────────

/** IPv4 adresi 32-bit sayıya çevirir. Geçersizse null döner. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const n = parseInt(part, 10);
    if (isNaN(n) || n < 0 || n > 255 || String(n) !== part) return null;
    result = (result << 8) | n;
  }
  return result >>> 0; // unsigned 32-bit
}

/** IPv4 adresinin geçerliliğini kontrol eder. */
export function isValidIpv4(ip: string): boolean {
  return ipv4ToInt(ip) !== null;
}

/**
 * IPv4 adresinin belirtilen CIDR bloğunda olup olmadığını kontrol eder.
 * @example isIpv4InCidr("192.168.1.50", "192.168.1.0/24") // true
 */
export function isIpv4InCidr(ip: string, cidr: string): boolean {
  const [network, prefixStr] = cidr.split("/");
  if (!network || prefixStr === undefined) return false;

  const prefix = parseInt(prefixStr, 10);
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;

  const ipInt = ipv4ToInt(ip);
  const netInt = ipv4ToInt(network);
  if (ipInt === null || netInt === null) return false;

  // /32 → sadece exact match
  if (prefix === 32) return ipInt === netInt;
  // /0 → herkese izin ver
  if (prefix === 0) return true;

  const mask = (~0 << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (netInt & mask);
}

// ─────────────────────────────────────────────────────────────────────────────
// IPv6 yardımcıları
// ─────────────────────────────────────────────────────────────────────────────

/**
 * IPv6 adresini normalize eder (:: expansion, lowercase).
 * Geçersiz format için null döner.
 */
function normalizeIpv6(ip: string): string | null {
  // Temel format kontrolleri
  if (!ip || ip.includes(":::")) return null;

  // :: expand
  let expanded = ip.toLowerCase();

  // IPv4-mapped IPv6 (::ffff:1.2.3.4) → sadece IPv4 parçasını al
  const ipv4Mapped = expanded.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (ipv4Mapped) {
    // IPv4-mapped adresi IPv4 olarak işle
    return `::ffff:${ipv4Mapped[1]}`;
  }

  const doubleColonCount = (expanded.match(/::/g) || []).length;
  if (doubleColonCount > 1) return null;

  if (expanded.includes("::")) {
    const [left, right] = expanded.split("::");
    const leftParts = left ? left.split(":") : [];
    const rightParts = right ? right.split(":") : [];
    const missing = 8 - leftParts.length - rightParts.length;
    if (missing < 0) return null;
    const middle = Array(missing).fill("0000");
    const allParts = [...leftParts, ...middle, ...rightParts];
    expanded = allParts.map((p) => p.padStart(4, "0")).join(":");
  } else {
    const parts = expanded.split(":");
    if (parts.length !== 8) return null;
    expanded = parts.map((p) => p.padStart(4, "0")).join(":");
  }

  // 8 grup × 4 hex = geçerli
  const parts = expanded.split(":");
  if (parts.length !== 8) return null;
  for (const p of parts) {
    if (!/^[0-9a-f]{4}$/.test(p)) return null;
  }

  return expanded;
}

/** Normalize edilmiş IPv6 adresini BigInt'e çevirir. */
function ipv6ToBigInt(normalized: string): bigint {
  const hex = normalized.replace(/:/g, "");
  return BigInt("0x" + hex);
}

/** IPv6 adresinin geçerliliğini kontrol eder. */
export function isValidIpv6(ip: string): boolean {
  return normalizeIpv6(ip) !== null;
}

/**
 * IPv6 adresinin belirtilen CIDR bloğunda olup olmadığını kontrol eder.
 * @example isIpv6InCidr("2001:db8::1", "2001:db8::/32") // true
 */
export function isIpv6InCidr(ip: string, cidr: string): boolean {
  const [network, prefixStr] = cidr.split("/");
  if (!network || prefixStr === undefined) return false;

  const prefix = parseInt(prefixStr, 10);
  if (isNaN(prefix) || prefix < 0 || prefix > 128) return false;

  const normIp = normalizeIpv6(ip);
  const normNet = normalizeIpv6(network);
  if (!normIp || !normNet) return false;

  if (prefix === 128) return normIp === normNet;
  if (prefix === 0) return true;

  const ipBig = ipv6ToBigInt(normIp);
  const netBig = ipv6ToBigInt(normNet);
  const mask = ((1n << 128n) - 1n) ^ ((1n << BigInt(128 - prefix)) - 1n);

  return (ipBig & mask) === (netBig & mask);
}

// ─────────────────────────────────────────────────────────────────────────────
// Geçerlilik kontrolleri
// ─────────────────────────────────────────────────────────────────────────────

/** IP veya CIDR string'inin geçerli olup olmadığını kontrol eder. */
export function isValidIpOrCidr(value: string): boolean {
  if (!value || typeof value !== "string") return false;

  if (value.includes("/")) {
    // CIDR formatı
    const [ip, prefix] = value.split("/");
    const prefixNum = parseInt(prefix, 10);

    if (isValidIpv4(ip)) {
      return !isNaN(prefixNum) && prefixNum >= 0 && prefixNum <= 32;
    }
    if (isValidIpv6(ip)) {
      return !isNaN(prefixNum) && prefixNum >= 0 && prefixNum <= 128;
    }
    return false;
  }

  // Exact IP
  return isValidIpv4(value) || isValidIpv6(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Ana kontrol fonksiyonu
// ─────────────────────────────────────────────────────────────────────────────

/**
 * İstemci IP'sinin belirli bir kural listesinde olup olmadığını kontrol eder.
 * IPv4-mapped IPv6 adresleri (::ffff:1.2.3.4) otomatik olarak IPv4'e normalize edilir.
 */
export function isIpInRules(clientIp: string, rules: string[]): boolean {
  if (!clientIp || rules.length === 0) return false;

  // IPv4-mapped IPv6 normalize et: "::ffff:1.2.3.4" → "1.2.3.4"
  let ip = clientIp;
  const ipv4MappedMatch = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (ipv4MappedMatch) {
    ip = ipv4MappedMatch[1];
  }

  for (const rule of rules) {
    if (rule.includes("/")) {
      // CIDR rule
      if (ip.includes(":")) {
        if (isIpv6InCidr(ip, rule)) return true;
      } else {
        if (isIpv4InCidr(ip, rule)) return true;
      }
    } else {
      // Exact match — normalize karşılaştırma
      if (ip === rule) return true;
      // IPv6 normalize karşılaştırma
      if (ip.includes(":") && rule.includes(":")) {
        const normIp = normalizeIpv6(ip);
        const normRule = normalizeIpv6(rule);
        if (normIp && normRule && normIp === normRule) return true;
      }
    }
  }

  return false;
}

/**
 * Config'i parse edip validate eder.
 * Geçersiz format için hata fırlatır.
 */
export function parseIpAllowlist(raw: unknown): IpAllowlistConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error("IP allowlist config must be an object");
  }

  const obj = raw as Record<string, unknown>;

  const validModes: IpAllowlistMode[] = ["everyone", "same_network", "allowlist"];
  if (!validModes.includes(obj.mode as IpAllowlistMode)) {
    throw new Error(`Invalid mode: must be one of ${validModes.join(", ")}`);
  }

  const mode = obj.mode as IpAllowlistMode;

  if (!Array.isArray(obj.ips)) {
    throw new Error("ips must be an array");
  }

  if (obj.ips.length > MAX_RULES) {
    throw new Error(`Too many rules: maximum ${MAX_RULES} allowed`);
  }

  const ips: string[] = [];
  for (const entry of obj.ips) {
    if (typeof entry !== "string") {
      throw new Error("Each IP/CIDR rule must be a string");
    }
    if (!isValidIpOrCidr(entry)) {
      throw new Error(`Invalid IP or CIDR: "${entry}"`);
    }
    ips.push(entry);
  }

  return { mode, ips };
}