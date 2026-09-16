/** In-app toasts (library actions, downloads, errors) with a fade-in stack. */

import { Text } from "reshaped";
import { X } from "lucide-react";
import { useUiStore } from "../../store/useUiStore";

export function ToastHost() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);
  if (toasts.length === 0) return null;

  return (
    <div
      className="amp-toasts"
      style={{
        position: "fixed",
        right: 18,
        /* Top right: the bottom right corner belongs to the player's own menu,
           bookmark and output controls. */
        top: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        zIndex: 120,
        maxWidth: 360,
      }}
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="amp-panel amp-toast"
          style={{
            padding: "12px 14px",
            animation: "amp-rise 220ms var(--amp-ease) both",
            borderLeft: `3px solid ${
              toast.tone === "danger"
                ? "var(--rs-color-critical, #ff6b6b)"
                : toast.tone === "success"
                  ? "var(--rs-color-positive, #4ad991)"
                  : "var(--amp-accent)"
            }`,
          }}
        >
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <Text variant="body-2" weight="semibold">
                {toast.title}
              </Text>
              {toast.description && (
                <Text variant="caption-1" color="neutral-faded">
                  {toast.description}
                </Text>
              )}
              {toast.action && (
                <button
                  className="amp-nav-item"
                  style={{ marginTop: 6, width: "auto", padding: "4px 8px" }}
                  onClick={() => {
                    toast.action?.run();
                    dismiss(toast.id);
                  }}
                >
                  {toast.action.label}
                </button>
              )}
            </div>
            <button
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss"
              style={{ background: "none", border: 0, color: "inherit", cursor: "pointer", opacity: 0.6 }}
            >
              <X size={15} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
