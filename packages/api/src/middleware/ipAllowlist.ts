/**
 * IP Allowlist Middleware — her DB isteğinde istemci IP'sini kontrol eder.
 *
 * Kontrol sırası:
 *   1. mode=everyone  → her IP geçer (varsayılan)
 *   2. mode=same_network → server ile aynı /24 subnet'te mi?
 *   3. mode=allowlist → ips listesindeki kurallardan en az biri eşleşmeli
 *
 * 403 dönüldüğünde production'da istemci IP'si yanıta eklenmez (bilgi sızıntısı önlemi).
 * Development'ta IP gösterilir (debug kolaylığı).
 *
 * Cache: ayar her request'te DB'den okunmaz; 30 saniye TTL ile önbelleklenir.
 */

import type { FastifyRequest, FastifyReply, FastifyInstance } from "fastify";
import os from "node:os";
import { isIpInRules, isIpv4InCidr, isIpv6InCidr } from "../utils/ipUtils.js";

// Cache entry tipi
interface CacheEntry {
  mode: string;
  ips: string[];
  expiresAt: number;
}

// In-process cache — cacheService'e bağımlılık olmadan bağımsız çalışır.
// Redis'li ortamda settingsService.getIpAllowlist zaten cacheService kullanıyor.
const localCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30_000; // 30 saniye

function getCached(dbName: string): CacheEntry | null {
  const entry = localCache.get(dbName);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    localCache.delete(dbName);
    return null;
  }
  return entry;
}

function setCache(dbName: string, mode: string, ips: string[]): void {
  localCache.set(dbName, { mode, ips, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Cache'i temizler — ayar güncellendiğinde çağrılır. */
export function invalidateIpAllowlistCache(dbName: string): void {
  localCache.delete(dbName);
}

/** Test ortamında tüm cache'i temizler. */
export function clearIpAllowlistCache(): void {
  localCache.clear();
}

/**
 * Server'ın kendi IPv4 adreslerini döner.
 * same_network modu için kullanılır.
 */
function getServerIpv4Addresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === "IPv4" && !addr.internal) {
        addresses.push(addr.address);
      }
    }
  }
  return addresses;
}

/**
 * same_network modunda istemci IP'sinin server ile aynı /24 subnet'inde
 * olup olmadığını kontrol eder.
 *
 * Her server IP'si için /24 CIDR üretilir:
 *   192.168.1.50 → 192.168.1.0/24
 */
function isInSameNetwork(clientIp: string): boolean {
  // localhost her zaman geçer
  if (clientIp === "127.0.0.1" || clientIp === "::1") return true;

  const serverIps = getServerIpv4Addresses();

  for (const serverIp of serverIps) {
    const parts = serverIp.split(".");
    if (parts.length !== 4) continue;
    const subnet = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
    if (isIpv4InCidr(clientIp, subnet)) return true;
  }

  return false;
}

/**
 * Fastify preHandler — `req.dbName` resolve edildikten sonra çalışır.
 * Bu fonksiyon server'a bağlı olduğundan factory pattern ile üretilir.
 */
export function createIpAllowlistGuard(server: FastifyInstance) {
  return async function ipAllowlistGuard(
    req: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const dbName = req.dbName;
    if (!dbName) return; // dbResolver çalışmadıysa geç (kendi hatasını döndürür)

    // Admin token tüm IP kontrollerini geçer — scopeGuard ile aynı mantık
    if (req.user?.role === "admin") return;

    // Cache'den oku
    let mode: string;
    let ips: string[];

    const cached = getCached(dbName);
    if (cached) {
      mode = cached.mode;
      ips = cached.ips;
    } else {
      // DB'den oku
      try {
        const config = await server.settings.getIpAllowlist(dbName);
        mode = config.mode;
        ips = config.ips;
        setCache(dbName, mode, ips);
      } catch (err) {
        // Ayar okunamazsa erişime izin ver (fail-open) — servis kesintisi önlenir.
        // Hata loglanır ama block edilmez.
        server.log.warn({ err, dbName }, "ipAllowlistGuard: failed to read config, allowing request");
        return;
      }
    }

    // everyone → kontrol yok
    if (mode === "everyone") return;

    const clientIp = req.ip;

    // same_network → server subnet kontrolü
    if (mode === "same_network") {
      if (isInSameNetwork(clientIp)) return;
      return sendDenied(reply, clientIp);
    }

    // allowlist → kural listesi kontrolü
    if (mode === "allowlist") {
      // Boş liste → kimseye izin verme (varsayılan deny)
      if (ips.length === 0) {
        return sendDenied(reply, clientIp);
      }
      if (isIpInRules(clientIp, ips)) return;
      return sendDenied(reply, clientIp);
    }
  };
}

function sendDenied(reply: FastifyReply, clientIp: string): void {
  const isDev = process.env.NODE_ENV !== "production";
  reply.status(403).send({
    error: "Access denied: your IP is not allowed to access this database",
    // Production'da IP gizle — bilgi sızıntısı önlemi
    ...(isDev ? { ip: clientIp } : {}),
  });
}