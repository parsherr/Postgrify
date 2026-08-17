/**
 * useBackup — React Query hooks for backup and schedule operations.
 *
 * Hooks:
 *   useBackups(db)          — backup list
 *   useBackupSchedule(db)   — schedule configuration
 *   useCreateBackup(db)     — trigger manual backup
 *   useDeleteBackup(db)     — delete backup
 *   useRestoreBackup(db)    — restore backup (multipart)
 *   useSetBackupSchedule(db)— create / update schedule
 *   useDeleteBackupSchedule(db) — delete schedule
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as api from "../lib/api.js";

// ── Query key factories ───────────────────────────────────────────────────────

const backupKeys = {
  list: (db: string) => ["backups", db] as const,
  schedule: (db: string) => ["backup-schedule", db] as const,
};

// ── Read hooks ────────────────────────────────────────────────────────────────

/** Returns all registered backups for the given database. */
export function useBackups(db: string) {
  return useQuery({
    queryKey: backupKeys.list(db),
    queryFn: () => api.listBackups(db),
    select: (data) => data.backups,
    enabled: Boolean(db),
    staleTime: 30_000,
  });
}

/** Returns the backup schedule configuration for the given database. */
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

/** Triggers a manual backup. Invalidates the backup list on success. */
export function useCreateBackup(db: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.createBackup(db),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: backupKeys.list(db) });
    },
  });
}

/** Deletes a specific backup. */
export function useDeleteBackup(db: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (backupId: string) => api.deleteBackup(db, backupId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: backupKeys.list(db) });
    },
  });
}

/** Restores the database from an uploaded .sql.gz file. */
export function useRestoreBackup(db: string) {
  return useMutation({
    mutationFn: (file: File) => api.restoreBackup(db, file),
  });
}

/** Saves or updates the schedule configuration. */
export function useSetBackupSchedule(db: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: api.BackupScheduleConfig) => api.setBackupSchedule(db, config),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: backupKeys.schedule(db) });
    },
  });
}

/** Cancels and deletes the schedule. */
export function useDeleteBackupSchedule(db: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.deleteBackupSchedule(db),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: backupKeys.schedule(db) });
    },
  });
}