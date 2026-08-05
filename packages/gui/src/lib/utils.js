import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs) {
    return twMerge(clsx(inputs));
}
/** Bytes'ı okunabilir formata çevirir */
export function formatBytes(bytes) {
    if (bytes === 0)
        return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
/** Sayıyı kısaltır: 1234 → 1.2k */
export function formatCount(n) {
    if (n < 1000)
        return String(n);
    if (n < 1000000)
        return `${(n / 1000).toFixed(1)}k`;
    return `${(n / 1000000).toFixed(1)}M`;
}
/** Relative time: "2 saat önce" */
export function timeAgo(date) {
    const d = typeof date === "string" ? new Date(date) : date;
    const diff = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diff < 60)
        return "az önce";
    if (diff < 3600)
        return `${Math.floor(diff / 60)} dk önce`;
    if (diff < 86400)
        return `${Math.floor(diff / 3600)} sa önce`;
    return `${Math.floor(diff / 86400)} gün önce`;
}
