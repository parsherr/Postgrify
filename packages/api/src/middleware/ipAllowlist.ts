/**
 * IP Allowlist Middleware — checks the client IP on every DB request.
 *
 * Check order:
 *   1. mode=everyone  → all IPs pass (default)
 *   2. mode=same_network → is the client in the same /24 subnet as the server?
 *   3. mode=allowlist → at least one rule in the ips list must match
 *
 * When returning 403, the client IP is not included in the response in production
 * (prevents information leakage). In development the IP is shown for easier debugging.
 *
 * Cache: the setting is not read from the DB on every request; it is cached with a 30-second TTL.
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

// In-process cache — operates independently without a dependency on cacheService.
// In Redis-backed environments, settingsService.getIpAllowlist already uses cacheService.
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

/** Clears the cache — called when the setting is updated. */
export function invalidateIpAllowlistCache(dbName: string): void {
  localCache.delete(dbName);
}

/** Clears all cache entries in the test environment. */
export function clearIpAllowlistCache(): void {
  localCache.clear();
}

/**
 * Returns the server's own IPv4 addresses.
 * Used for same_network mode.
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
 * Checks whether the client IP is in the same /24 subnet as the server
 * in same_network mode.
 *
 * Generates a /24 CIDR for each server IP:
 *   192.168.1.50 → 192.168.1.0/24
 */
function isInSameNetwork(clientIp: string): boolean {
  // localhost always passes
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
 * Fastify preHandler — runs after `req.dbName` has been resolved.
 * Produced via the factory pattern because this function depends on the server instance.
 */
export function createIpAllowlistGuard(server: FastifyInstance) {
  return async function ipAllowlistGuard(
    req: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const dbName = req.dbName;
    if (!dbName) return; // skip if dbResolver has not run (it will return its own error)

    // Admin token bypasses all IP checks — same logic as scopeGuard
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
        // If the setting cannot be read, allow access (fail-open) — prevents a service outage.
        // The error is logged but the request is not blocked.
        server.log.warn({ err, dbName }, "ipAllowlistGuard: failed to read config, allowing request");
        return;
      }
    }

    // everyone → kontrol yok
    if (mode === "everyone") return;

    const clientIp = req.ip;

    // same_network → check server subnet
    if (mode === "same_network") {
      if (isInSameNetwork(clientIp)) return;
      return sendDenied(reply, clientIp);
    }

    // allowlist → check against rule list
    if (mode === "allowlist") {
      // Empty list → deny everyone (default deny)
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
    // Hide IP in production — prevents information leakage
    ...(isDev ? { ip: clientIp } : {}),
  });
}