/**
 * AuthsTab — per-database auth management panel.
 *
 * Sub-tabs:
 *   1. Users         — user list, invite, edit, delete
 *   2. Settings      — feature flags, OAuth providers
 *   3. Audit Log     — record of all auth events
 *   4. Sessions      — active session list, force logout
 */

import React, { useState } from "react";
import {
  UserPlus, Pencil, Trash2, KeyRound,
  ShieldCheck, Eye, FilePen, CircleSlash,
  Loader2, RefreshCw, Settings, ClipboardList,
  LogOut, Plus, Check, X, ChevronLeft, ChevronRight,
  Github,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import {
  useDbAuthUsers, useCreateDbAuthUser, useUpdateDbAuthUser,
  useDeleteDbAuthUser, useResetDbAuthUserPassword,
} from "@/hooks/useDbAuth";
import { useAuthSettings, useUpdateAuthSettings, useOAuthProviders, useUpsertOAuthProvider, useDeleteOAuthProvider } from "@/hooks/useAuthSettings";
import { useAuditLog } from "@/hooks/useAuditLog";
import { useAuthSessions, useRevokeAuthSession } from "@/hooks/useAuthSessions";
import type { DbAuthUser, DbAuthUserRole } from "@/types/index";
import { cn } from "@/lib/utils";

// ── Type helpers ─────────────────────────────────────────────────────────────

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
      <Icon className="h-3 w-3" />{meta.label}
    </span>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

// ── Sub-tab components ───────────────────────────────────────────────────────

// ── 1. Users ─────────────────────────────────────────────────────────────────

interface InviteUserDialogProps { db: string; open: boolean; onClose: () => void; }

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
      toast.success(`${email} added successfully.`);
      setEmail(""); setPassword(""); setRole("viewer");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create user.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4" />Invite User
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input id="invite-email" type="email" placeholder="user@example.com"
              value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-password">Initial Password</Label>
            <Input id="invite-password" type="password" placeholder="At least 8 characters"
              value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-role">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as DbAuthUserRole)}>
              <SelectTrigger id="invite-role"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="viewer">Viewer — Read only</SelectItem>
                <SelectItem value="editor">Editor — Read + write</SelectItem>
                <SelectItem value="admin">Admin — Full access</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface EditUserDialogProps { db: string; user: DbAuthUser; open: boolean; onClose: () => void; }

function EditUserDialog({ db, user, open, onClose }: EditUserDialogProps) {
  const [role, setRole] = useState<DbAuthUserRole>(user.role);
  const [isActive, setIsActive] = useState(user.is_active);
  const { mutateAsync, isPending } = useUpdateDbAuthUser(db);
  const toast = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await mutateAsync({ id: user.id, role, is_active: isActive });
      toast.success("User updated.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" />Edit User
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <p className="text-sm text-muted-foreground">{user.email}</p>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as DbAuthUserRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="viewer">Viewer</SelectItem>
                <SelectItem value="editor">Editor</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3">
            <input type="checkbox" id="is-active" checked={isActive} onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-border" />
            <Label htmlFor="is-active">Account active</Label>
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface ResetPasswordDialogProps { db: string; user: DbAuthUser; open: boolean; onClose: () => void; }

function ResetPasswordDialog({ db, user, open, onClose }: ResetPasswordDialogProps) {
  const [password, setPassword] = useState("");
  const { mutateAsync, isPending } = useResetDbAuthUserPassword(db);
  const toast = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await mutateAsync({ id: user.id, password });
      toast.success("Password updated.");
      setPassword("");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update password.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" />Reset Password
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <p className="text-sm text-muted-foreground">{user.email}</p>
          <div className="space-y-1.5">
            <Label htmlFor="new-password">New Password</Label>
            <Input id="new-password" type="password" placeholder="At least 8 characters"
              value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required autoFocus />
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Reset
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UsersSubTab({ db }: { db: string }) {
  const [search, setSearch] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editUser, setEditUser] = useState<DbAuthUser | null>(null);
  const [resetUser, setResetUser] = useState<DbAuthUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DbAuthUser | null>(null);
  const { data, isLoading, refetch } = useDbAuthUsers(db);
  const { mutateAsync: deleteUser } = useDeleteDbAuthUser(db);
  const toast = useToast();

  async function handleDelete(user: DbAuthUser) {
    try {
      await deleteUser(user.id);
      toast.success(`${user.email} deleted.`);
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Silinemedi.");
    }
  }

  const filtered = (data?.users ?? []).filter((u) =>
    u.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <Input placeholder="Email ara..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-64 text-xs" />
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => refetch()}>
            <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
          </Button>
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus className="mr-1.5 h-3.5 w-3.5" />Invite
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          {search ? "No matching users." : "No users yet."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-xs text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">Email</th>
                <th className="px-4 py-2 text-left font-medium">Role</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Last Login</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((user) => (
                <tr key={user.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5 font-mono text-xs">{user.email}</td>
                  <td className="px-4 py-2.5"><RoleBadge role={user.role} /></td>
                  <td className="px-4 py-2.5">
                    {user.is_active ? (
                      <Badge variant="outline" className="text-emerald-500 border-emerald-500/30 text-xs">Active</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground text-xs">
                        <CircleSlash className="mr-1 h-3 w-3" />Inactive
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatDate(user.last_login ?? null)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit" onClick={() => setEditUser(user)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Reset Password" onClick={() => setResetUser(user)}>
                        <KeyRound className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" title="Sil" onClick={() => setDeleteTarget(user)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 border-t border-border bg-muted/20 text-xs text-muted-foreground">
            {data?.total ?? 0} users
          </div>
        </div>
      )}

      <InviteUserDialog db={db} open={inviteOpen} onClose={() => setInviteOpen(false)} />
      {editUser && <EditUserDialog db={db} user={editUser} open onClose={() => setEditUser(null)} />}
      {resetUser && <ResetPasswordDialog db={db} user={resetUser} open onClose={() => setResetUser(null)} />}
      {deleteTarget && (
        <ConfirmDialog open title="Delete User"
          description={`"${deleteTarget.email}" will be permanently deleted.`}
          confirmLabel="Sil" onConfirm={() => handleDelete(deleteTarget)} onCancel={() => setDeleteTarget(null)} />
      )}
    </div>
  );
}

// ── 2. Settings ──────────────────────────────────────────────────────────────

function ToggleRow({
  label, description, value, onChange, disabled,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!value)}
        className={cn(
          "relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none",
          value ? "bg-primary" : "bg-muted",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <span className={cn(
          "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform",
          value ? "translate-x-4" : "translate-x-0"
        )} />
      </button>
    </div>
  );
}

function OAuthProviderRow({
  db,
  provider,
  label,
  icon,
}: {
  db: string;
  provider: "google" | "github";
  label: string;
  icon: React.ReactNode;
}) {
  const { data: providers } = useOAuthProviders(db);
  const existing = providers?.find((p) => p.provider === provider);
  const { mutateAsync: upsert, isPending: upserting } = useUpsertOAuthProvider(db);
  const { mutateAsync: remove, isPending: removing } = useDeleteOAuthProvider(db);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState("");

  function openDialog() {
    if (existing) {
      setClientId(existing.client_id);
      setRedirectUri(existing.redirect_uri);
      setClientSecret("");
    }
    setOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    try {
      await upsert({ provider, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri });
      toast.success(`${label} configuration saved.`);
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save.");
    }
  }

  async function handleRemove() {
    try {
      await remove(provider);
      toast.success(`${label} removed.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove.");
    }
  }

  return (
    <>
      <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 flex items-center justify-center rounded-md bg-muted">{icon}</div>
          <div>
            <p className="text-sm font-medium">{label}</p>
            {existing ? (
              <p className="text-xs text-emerald-500 flex items-center gap-1"><Check className="h-3 w-3" />Configured</p>
            ) : (
              <p className="text-xs text-muted-foreground">Not configured</p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={openDialog}>
            {existing ? <><Pencil className="mr-1.5 h-3 w-3" />Edit</> : <><Plus className="mr-1.5 h-3 w-3" />Add</>}
          </Button>
          {existing && (
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={handleRemove} disabled={removing}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={(v) => !v && setOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{label} OAuth Configuration</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label>Client ID</Label>
              <Input value={clientId} onChange={(e) => setClientId(e.target.value)} required placeholder={`${label} Client ID`} />
            </div>
            <div className="space-y-1.5">
              <Label>Client Secret</Label>
              <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)}
                required={!existing} placeholder={existing ? "Enter to change" : `${label} Client Secret`} />
            </div>
            <div className="space-y-1.5">
              <Label>Redirect URI</Label>
              <Input value={redirectUri} onChange={(e) => setRedirectUri(e.target.value)} required
                placeholder="https://yourapp.com/auth/callback" />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={upserting}>
                {upserting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SettingsSubTab({ db }: { db: string }) {
  const { data: settings, isLoading } = useAuthSettings(db);
  const { mutateAsync: update, isPending } = useUpdateAuthSettings(db);
  const toast = useToast();

  async function toggle(key: string, current: string) {
    const next = current === "true" ? "false" : "true";
    try {
      await update({ [key]: next });
    } catch {
      toast.error("Failed to update setting.");
    }
  }

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  const s = settings ?? {} as Record<string, string>;

  return (
    <div className="p-4 space-y-6 max-w-2xl">
      <div>
        <h3 className="text-sm font-semibold mb-3">Login Methods</h3>
        <div className="rounded-lg border border-border px-4">
          <ToggleRow label="Email + Password Signup" description="New users can register with email and password."
            value={s.email_signup_enabled === "true"} onChange={() => toggle("email_signup_enabled", s.email_signup_enabled ?? "true")} disabled={isPending} />
          <ToggleRow label="Require Email Verification" description="Users must verify their email before signing in."
            value={s.email_verify_required === "true"} onChange={() => toggle("email_verify_required", s.email_verify_required ?? "false")} disabled={isPending} />
          <ToggleRow label="Magic Link (Passwordless)" description="Users can sign in via a one-click link sent to their email."
            value={s.magic_link_enabled === "true"} onChange={() => toggle("magic_link_enabled", s.magic_link_enabled ?? "false")} disabled={isPending} />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-3">OAuth Providers</h3>
        <div className="rounded-lg border border-border px-4">
          <OAuthProviderRow db={db} provider="google" label="Google"
            icon={<svg viewBox="0 0 24 24" className="h-4 w-4"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>} />
          <OAuthProviderRow db={db} provider="github" label="GitHub"
            icon={<Github className="h-4 w-4" />} />
        </div>
      </div>
    </div>
  );
}

// ── 3. Audit Log ─────────────────────────────────────────────────────────────

const EVENT_COLORS: Record<string, string> = {
  login: "text-emerald-500",
  logout: "text-muted-foreground",
  signup: "text-sky-500",
  login_failed: "text-rose-500",
  password_reset: "text-amber-500",
  password_reset_request: "text-amber-400",
  magic_link_login: "text-violet-500",
  magic_link_request: "text-violet-400",
  oauth_login: "text-blue-500",
  oauth_signup: "text-blue-400",
  email_verified: "text-emerald-400",
  account_disabled: "text-rose-400",
  password_changed: "text-amber-500",
};

function AuditLogSubTab({ db }: { db: string }) {
  const [offset, setOffset] = useState(0);
  const [eventFilter, setEventFilter] = useState("");
  const LIMIT = 50;

  const { data, isLoading, refetch } = useAuditLog(db, {
    limit: LIMIT, offset, event: eventFilter || undefined,
  });

  const total = data?.total ?? 0;
  const pages = Math.ceil(total / LIMIT);
  const current = Math.floor(offset / LIMIT) + 1;

  return (
    <div>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <Select value={eventFilter} onValueChange={(v) => { setEventFilter(v); setOffset(0); }}>
          <SelectTrigger className="h-8 w-52 text-xs"><SelectValue placeholder="All events" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">All events</SelectItem>
            {["login", "logout", "signup", "login_failed", "password_reset", "password_reset_request",
              "magic_link_login", "magic_link_request", "oauth_login", "oauth_signup", "email_verified"].map((e) => (
              <SelectItem key={e} value={e}>{e}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !data?.data.length ? (
        <div className="py-12 text-center text-sm text-muted-foreground">No records.</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                  <th className="px-4 py-2 text-left font-medium">Event</th>
                  <th className="px-4 py-2 text-left font-medium">User</th>
                  <th className="px-4 py-2 text-left font-medium">IP</th>
                  <th className="px-4 py-2 text-left font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.data.map((entry) => (
                  <tr key={entry.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5">
                      <span className={cn("font-mono font-medium", EVENT_COLORS[entry.event] ?? "text-foreground")}>
                        {entry.event}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground font-mono">
                      {entry.user_email ?? entry.user_id?.slice(0, 8) ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{entry.ip ?? "—"}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{formatDate(entry.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-muted/20 text-xs text-muted-foreground">
            <span>{total} records</span>
            {pages > 1 && (
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" className="h-6 w-6" disabled={current === 1} onClick={() => setOffset(offset - LIMIT)}>
                  <ChevronLeft className="h-3 w-3" />
                </Button>
                <span>{current} / {pages}</span>
                <Button variant="ghost" size="icon" className="h-6 w-6" disabled={current === pages} onClick={() => setOffset(offset + LIMIT)}>
                  <ChevronRight className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── 4. Sessions ──────────────────────────────────────────────────────────────

function SessionsSubTab({ db }: { db: string }) {
  const { data, isLoading, refetch } = useAuthSessions(db);
  const { mutateAsync: revoke } = useRevokeAuthSession(db);
  const toast = useToast();

  async function handleRevoke(id: string) {
    try {
      await revoke(id);
      toast.success("Session revoked.");
    } catch {
      toast.error("Failed to revoke session.");
    }
  }

  const active = (data?.data ?? []).filter((s) => !s.revoked && new Date(s.expires_at) > new Date());

  return (
    <div>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-xs text-muted-foreground">{active.length} active session</span>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !active.length ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Active session yok.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">User</th>
                <th className="px-4 py-2 text-left font-medium">IP</th>
                <th className="px-4 py-2 text-left font-medium">Created At</th>
                <th className="px-4 py-2 text-left font-medium">Expiry</th>
                <th className="px-4 py-2 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {active.map((session) => (
                <tr key={session.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5 font-mono">{session.user_email ?? session.user_id.slice(0, 8)}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{session.ip ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{formatDate(session.created_at)}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{formatDate(session.expires_at)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Button variant="ghost" size="sm" className="h-7 text-destructive hover:text-destructive"
                      onClick={() => handleRevoke(session.id)} title="Revoke Session">
                      <LogOut className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

type TabId = "users" | "settings" | "audit" | "sessions";

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "users",    label: "Users", icon: UserPlus },
  { id: "settings", label: "Settings",      icon: Settings },
  { id: "audit",    label: "Audit Log",    icon: ClipboardList },
  { id: "sessions", label: "Sessions",  icon: LogOut },
];

export function AuthsTab({ db }: { db: string }) {
  const [activeTab, setActiveTab] = useState<TabId>("users");

  return (
    <div className="flex flex-col h-full">
      {/* Tab headers */}
      <div className="flex border-b border-border bg-muted/20 px-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors",
              activeTab === id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            )}
          >
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === "users"    && <UsersSubTab    db={db} />}
        {activeTab === "settings" && <SettingsSubTab db={db} />}
        {activeTab === "audit"    && <AuditLogSubTab db={db} />}
        {activeTab === "sessions" && <SessionsSubTab db={db} />}
      </div>
    </div>
  );
}