/**
 * useBackup — Backup ve schedule işlemleri için React Query hooks.
 *
 * Hooks:
 *   useBackups(db)          — backup listesi
 *   useBackupSchedule(db)   — schedule konfigürasyonu
 *   useCreateBackup(db)     — manuel backup tetikleme
 *   useDeleteBackup(db)     — backup silme
 *   useRestoreBackup(db)    — backup restore (multipart)
 *   useSetBackupSchedule(db)— schedule oluştur / güncelle
 *   useDeleteBackupSchedule(db) — schedule sil
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as api from "../lib/api.js";

// ── Query key factories ───────────────────────────────────────────────────────

const backupKeys = {
  list: (db: string) => ["backups", db] as const,
  schedule: (db: string) => ["backup-schedule", db] as const,
};

// ── Read hooks ────────────────────────────────────────────────────────────────

/** Belirtilen DB'nin tüm kayıtlı backup'larını döner. */
export function useBackups(db: string) {
  return useQuery({
    queryKey: backupKeys.list(db),
    queryFn: () => api.listBackups(db),
    select: (data) => data.backups,
    enabled: Boolean(db),
    staleTime: 30_000,
  });
}

/** Belirtilen DB'nin backup schedule konfigürasyonunu döner. */
export function useBackupSchedule(db: string) {
  return useQuery({
    queryKey: backupKeys.schedule(db),
    queryFn: () => api.getBackupSchedule(db),
    select: (data) => data.schedule,
    enabled: Boolean(db),
    staleTime: 60_000,
  });
}

// ── Mutation hooks ────────────────────────────────────────────────────────────

/** Manuel backup tetikler. Tamamlanınca backup listesini yeniler. */
export function useCreateBackup(db: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.createBackup(db),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: backupKeys.list(db) });
    },
  });
}

/** Belirli bir backup'ı siler. */
export function useDeleteBackup(db: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (backupId: string) => api.deleteBackup(db, backupId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: backupKeys.list(db) });
    },
  });
}

/** Yüklenen .sql.gz dosyasından DB'yi restore eder. */
export function useRestoreBackup(db: string) {
  return useMutation({
    mutationFn: (file: File) => api.restoreBackup(db, file),
  });
}

/** Schedule konfigürasyonunu kaydeder veya günceller. */
export function useSetBackupSchedule(db: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: api.BackupScheduleConfig) => api.setBackupSchedule(db, config),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: backupKeys.schedule(db) });
    },
  });
}

/** Schedule'ı iptal eder ve siler. */
export function useDeleteBackupSchedule(db: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.deleteBackupSchedule(db),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: backupKeys.schedule(db) });
    },
  });
}