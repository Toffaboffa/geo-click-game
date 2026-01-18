// client/src/components/UiDialog.jsx
import React, { useEffect, useMemo } from "react";

export default function UiDialog({
  open,
  title,
  message,
  variant = "alert",
  okText = "OK",
  cancelText = "Avbryt",
  onOk,
  onCancel,
}) {
  const lines = useMemo(() => {
    const m = String(message || "");
    return m.split("\\n").filter((s) => s.trim().length > 0);
  }, [message]);

  useEffect(() => {
    if (!open) return;

    const onKey = (e) => {
      if (e.key === "Escape") {
        if (variant === "confirm") onCancel?.();
        else onOk?.();
      }
      if (e.key === "Enter") {
        onOk?.();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, variant, onOk, onCancel]);

  if (!open) return null;

  const isConfirm = variant === "confirm";

  const handleOverlay = () => {
    if (isConfirm) onCancel?.();
    else onOk?.();
  };

  return (
    <div
      className="ui-dialog-overlay"
      role="presentation"
      onMouseDown={handleOverlay}
    >
      <div
        className="ui-dialog"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {title ? <div className="ui-dialog-title">{title}</div> : null}

        <div className="ui-dialog-body">
          {lines.map((ln, i) => (
            <p key={i}>{ln}</p>
          ))}
        </div>

        <div className="ui-dialog-actions">
          {isConfirm && (
            <button className="ui-btn ui-btn-secondary" onClick={onCancel}>
              {cancelText}
            </button>
          )}

          <button className="ui-btn ui-btn-primary" onClick={onOk} autoFocus>
            {okText}
          </button>
        </div>
      </div>
    </div>
  );
}
