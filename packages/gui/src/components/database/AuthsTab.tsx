/**
 * AuthsTab — per-database kullanıcı yönetimi.
 *
 * Özellikler:
 *   - Kullanıcı listesi (email, rol, durum, son giriş)
 *   - Kullanıcı davet et (InviteUserDialog)
 *   - Rol / durum düzenle (EditUserDialog)
 *   - Şifre sıfırla (ResetPasswordDialog)
 *   - Kullanıcı sil (ConfirmDialog)
 */

import React, { useState } from "react";
import {
  UserPlus,
  Pencil,
  Trash2,
  KeyRound,
  ShieldCheck,
  Eye,
  FilePen,
  CircleSlash,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import {
  useDbAuthUsers,
  useCreateDbAuthUser,
  useUpdateDbAuthUser,
  useDeleteDbAuthUser,
  useResetDbAuthUserPassword,
} from "@/hooks/useDbAuth";
import type { DbAuthUser, DbAuthUserRole } from "@/types/index";
import { cn } from "@/lib/utils";

// ── Yardımcı bileşenler ──────────────────────────────────────────────────────

const ROLE_META: Record<DbAuthUserRole, { label: string; icon: React.ElementType; color: string }> = {
  admin:  { label: "Admin",  icon: ShieldCheck, color: "text-rose-500" },
  editor: { label: "Editor", icon: FilePen,     color: "text-amber-500" },
  viewer: { label: "Viewer", icon: Eye,         color: "text-sky-500" },
};

function RoleBadge({ role }: { role: DbAuthUserRole }) {
  const meta = ROLE_META[role] ?? ROLE_META.viewer;
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", meta.color)}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

// ── InviteUserDialog ─────────────────────────────────────────────────────────

interface InviteUserDialogProps {
  db: string;
  open: boolean;
  onClose: () => void;
}

function InviteUserDialog({ db, open, onClose }: InviteUserDialogProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<DbAuthUserRole>("viewer");
  const { mutateAsync, isPending } = useCreateDbAuthUser(db);
  const toast = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await mutateAsync({ email, password, role });
      toast.success(`${email} başarıyla eklendi.`);
      setEmail(""); setPassword(""); setRole("viewer");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kullanıcı oluşturulamadı.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4" />
            Kullanıcı Davet Et
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">E-posta</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="kullanici@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-password">Başlangıç Şifresi</Label>
            <Input
              id="invite-password"
              type="password"
              placeholder="En az 8 karakter"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-role">Rol</Label>
            <Select value={role} onValueChange={(v) => setRole(v as DbAuthUserRole)}>
              <SelectTrigger id="invite-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="viewer">Viewer — Sadece okuma</SelectItem>
                <SelectItem value="editor">Editor — Okuma + yazma</SelectItem>
                <SelectItem value="admin">Admin — Tam erişim</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
              İptal
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Davet Et
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── EditUserDialog ───────────────────────────────────────────────────────────

interface EditUserDialogProps {
  db: string;
  user: DbAuthUser;
  open: boolean;
  onClose: () => void;
}

function EditUserDialog({ db, user, open, onClose }: EditUserDialogProps) {
  const [role, setRole] = useState<DbAuthUserRole>(user.role);
  const [isActive, setIsActive] = useState(user.is_active);
  const { mutateAsync, isPending } = useUpdateDbAuthUser(db);
  const toast = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await mutateAsync({ id: user.id, role, is_active: isActive });
      toast.success("Kullanıcı güncellendi.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Güncelleme başarısız.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" />
            Kullanıcıyı Düzenle
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">E-posta</p>
            <p className="text-sm font-medium">{user.email}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-role">Rol</Label>
            <Select value={role} onValueChange={(v) => setRole(v as DbAuthUserRole)}>
              <SelectTrigger id="edit-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="viewer">Viewer</SelectItem>
                <SelectItem value="editor">Editor</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <span className="text-sm">Hesap durumu</span>
            <button
              type="button"
              onClick={() => setIsActive((v) => !v)}
              className={cn(
                "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                isActive ? "bg-green-500" : "bg-muted"
              )}
            >
              <span
                className={cn(
                  "inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform",
                  isActive ? "translate-x-4" : "translate-x-1"
                )}
              />
            </button>
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
              İptal
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Kaydet
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── ResetPasswordDialog ───────────────────────────────────────────────────────

interface ResetPasswordDialogProps {
  db: string;
  user: DbAuthUser;
  open: boolean;
  onClose: () => void;
}

function ResetPasswordDialog({ db, user, open, onClose }: ResetPasswordDialogProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const { mutateAsync, isPending } = useResetDbAuthUserPassword(db);
  const toast = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Şifreler eşleşmiyor.");
      return;
    }
    try {
      await mutateAsync({ id: user.id, password });
      toast.success("Şifre sıfırlandı. Mevcut oturumlar sonlandırıldı.");
      setPassword(""); setConfirm("");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Şifre sıfırlanamadı.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            Şifre Sıfırla
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Kullanıcı</p>
            <p className="text-sm font-medium">{user.email}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reset-password">Yeni Şifre</Label>
            <Input
              id="reset-password"
              type="password"
              placeholder="En az 8 karakter"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reset-confirm">Şifreyi Onayla</Label>
            <Input
              id="reset-confirm"
              type="password"
              placeholder="Tekrar girin"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              minLength={8}
              required
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Şifre değiştirilince bu kullanıcının tüm mevcut oturumları sonlandırılır.
          </p>
          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
              İptal
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sıfırla
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Ana AuthsTab ──────────────────────────────────────────────────────────────

interface AuthsTabProps {
  db: string;
}

export function AuthsTab({ db }: AuthsTabProps) {
  const { data, isLoading, error, refetch, isFetching } = useDbAuthUsers(db);
  const deleteUser = useDeleteDbAuthUser(db);
  const toast = useToast();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [editUser, setEditUser] = useState<DbAuthUser | null>(null);
  const [resetUser, setResetUser] = useState<DbAuthUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DbAuthUser | null>(null);

  async function handleDelete(user: DbAuthUser) {
    try {
      await deleteUser.mutateAsync(user.id);
      toast.success(`${user.email} silindi.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Silme başarısız.");
    } finally {
      setDeleteTarget(null);
    }
  }

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Kullanıcılar</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Bu veritabanına erişim yetkisi olan kullanıcılar
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
            title="Yenile"
          >
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          </Button>
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus className="mr-2 h-4 w-4" />
            Kullanıcı Davet Et
          </Button>
        </div>
      </div>

      {/* Tablo */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 py-12 text-center">
          <p className="text-sm text-destructive">
            {error instanceof Error ? error.message : "Kullanıcılar yüklenemedi"}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Tekrar Dene
          </Button>
        </div>
      ) : !data?.users.length ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            <UserPlus className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium">Henüz kullanıcı yok</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              İlk kullanıcıyı davet ederek başlayın.
            </p>
          </div>
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus className="mr-2 h-4 w-4" />
            Kullanıcı Davet Et
          </Button>
        </div>
      ) : (
        <div className="rounded-md border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  E-posta
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  Rol
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  Durum
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  Son Giriş
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  Oluşturuldu
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">
                  İşlemler
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.users.map((user) => (
                <tr
                  key={user.id}
                  className="hover:bg-muted/20 transition-colors"
                >
                  <td className="px-4 py-3 font-medium">{user.email}</td>
                  <td className="px-4 py-3">
                    <RoleBadge role={user.role} />
                  </td>
                  <td className="px-4 py-3">
                    {user.is_active ? (
                      <Badge variant="outline" className="border-green-500/40 bg-green-500/10 text-green-600 text-xs">
                        Aktif
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-border text-muted-foreground text-xs">
                        <CircleSlash className="mr-1 h-3 w-3" />
                        Devre Dışı
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {formatDate(user.last_login)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {formatDate(user.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Düzenle"
                        onClick={() => setEditUser(user)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Şifre Sıfırla"
                        onClick={() => setResetUser(user)}
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        title="Sil"
                        onClick={() => setDeleteTarget(user)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 border-t border-border bg-muted/20 text-xs text-muted-foreground">
            {data.total} kullanıcı
          </div>
        </div>
      )}

      {/* Dialogs */}
      <InviteUserDialog
        db={db}
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
      />

      {editUser && (
        <EditUserDialog
          db={db}
          user={editUser}
          open={true}
          onClose={() => setEditUser(null)}
        />
      )}

      {resetUser && (
        <ResetPasswordDialog
          db={db}
          user={resetUser}
          open={true}
          onClose={() => setResetUser(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          open={true}
          title="Kullanıcıyı Sil"
          description={`"${deleteTarget.email}" adlı kullanıcı kalıcı olarak silinecek. Bu işlem geri alınamaz.`}
          confirmLabel="Sil"
          onConfirm={() => handleDelete(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}