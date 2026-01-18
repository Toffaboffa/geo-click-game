// client/src/components/UiToast.jsx
import React, { useEffect } from "react";

export default function UiToast({ open, message, onClose, durationMs = 3200 }) {
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => onClose?.(), durationMs);
    return () => clearTimeout(t);
  }, [open, durationMs, onClose]);

  if (!open || !message) return null;

  return (
    <div className="ui-toast" role="status" aria-live="polite">
      <div className="ui-toast-inner">{message}</div>
    </div>
  );
}
