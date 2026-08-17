import { X, ArrowUpCircle, ExternalLink } from "lucide-react";

interface UpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentVersion: string;
  latestVersion: string;
  releaseUrl?: string;
  changelog?: string;
}

/**
 * Modal displayed when a newer version of Postgrify is available.
 */
export function UpdateModal({
  isOpen,
  onClose,
  currentVersion,
  latestVersion,
  releaseUrl,
  changelog,
}: UpdateModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative w-full max-w-md bg-slate-800 border border-slate-700 rounded-xl shadow-2xl">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1 text-slate-500 hover:text-slate-300 rounded transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="p-5">
          {/* Header */}
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <ArrowUpCircle className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2
                id="update-modal-title"
                className="text-base font-semibold text-slate-100"
              >
                Update Available
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                A new version of Postgrify is ready.
              </p>
            </div>
          </div>

          {/* Version info */}
          <div className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg mb-4">
            <div className="text-center">
              <p className="text-xs text-slate-500 mb-1">Current</p>
              <p className="text-sm font-mono text-slate-300">
                v{currentVersion}
              </p>
            </div>
            <div className="text-slate-600">→</div>
            <div className="text-center">
              <p className="text-xs text-slate-500 mb-1">New</p>
              <p className="text-sm font-mono text-green-400 font-semibold">
                v{latestVersion}
              </p>
            </div>
          </div>

          {/* Changelog */}
          {changelog && (
            <div className="mb-4">
              <p className="text-xs font-medium text-slate-400 mb-1.5">
                What's new
              </p>
              <div className="p-3 bg-slate-900/50 rounded-lg max-h-40 overflow-y-auto">
                <p className="text-xs text-slate-400 whitespace-pre-wrap font-mono">
                  {changelog}
                </p>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded-lg transition-colors"
            >
              Later
            </button>
            {releaseUrl && (
              <a
                href={releaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
              >
                View Release
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>

          {/* Dismiss hint */}
          <p className="text-center text-xs text-slate-600 mt-3">
            You can also update via Docker — see the docs.
          </p>
        </div>
      </div>
    </div>
  );
}