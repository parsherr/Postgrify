/**
 * UpdateModal — yeni sürüm çıktığında giriş sonrası bir kez gösterilir.
 *
 * Görünüm koşulu: localStorage'daki "postgrify_seen_version" mevcut
 * VERSION'dan farklıysa modal açılır. "Got it" veya "View Changes" tıklayınca
 * versiyon kaydedilir, modal tekrar çıkmaz.
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, ArrowRight, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { parseChangelog, latestEntry, SEEN_VERSION_KEY } from "@/lib/changelog";
import changelogRaw from "../../../../CHANGELOG.md?raw";

const VERSION =
  (import.meta as unknown as { env: { VITE_APP_VERSION?: string } }).env
    .VITE_APP_VERSION ?? "0.0.0";

const ENTRIES = parseChangelog(changelogRaw);
const LATEST = latestEntry(ENTRIES);

function shouldShow(): boolean {
  if (!LATEST) return false;
  const seen = localStorage.getItem(SEEN_VERSION_KEY);
  return seen !== VERSION;
}

function markSeen() {
  localStorage.setItem(SEEN_VERSION_KEY, VERSION);
}

interface UpdateModalProps {
  /** Modal'ın parent'tan kontrol edilmesini sağlar (opsiyonel) */
  onClose?: () => void;
}

export function UpdateModal({ onClose }: UpdateModalProps) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (shouldShow()) setOpen(true);
  }, []);

  function handleClose() {
    markSeen();
    setOpen(false);
    onClose?.();
  }

  function handleViewChanges() {
    markSeen();
    setOpen(false);
    onClose?.();
    navigate("/changelog");
  }

  if (!LATEST) return null;

  // Son sürümün maddeleri — en fazla 5 madde göster
  const allItems = LATEST.sections.flatMap((s) => s.items).slice(0, 5);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent
        className="max-w-sm border border-zinc-800 bg-zinc-950 p-0 shadow-2xl [&>button]:hidden"
      >
        {/* Kapat butonu */}
        <button
          onClick={handleClose}
          className="absolute right-3 top-3 rounded p-1 text-zinc-600 transition-colors hover:text-zinc-300"
          aria-label="Kapat"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex flex-col gap-5 p-6">
          {/* Badge */}
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-0.5 text-xs font-medium text-zinc-300">
              <Sparkles className="h-3 w-3 text-amber-400" />
              New update
            </span>
          </div>

          {/* Başlık */}
          <div>
            <p className="font-mono text-3xl font-semibold tracking-tight text-white">
              v{LATEST.version}
            </p>
            <p className="mt-1 text-sm text-zinc-400">
              {LATEST.date} · What's new
            </p>
          </div>

          {/* Değişiklik maddeleri */}
          {allItems.length > 0 && (
            <ul className="space-y-2">
              {allItems.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-zinc-300">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-500" />
                  <span className="leading-snug">{item}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Aksiyonlar */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleViewChanges}
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
            >
              View changelog
            </button>
            <button
              onClick={handleClose}
              className="flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-zinc-100"
            >
              Got it
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
