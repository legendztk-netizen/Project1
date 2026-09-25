import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigation } from "react-router";
import { X } from "lucide-react";
import "./shipment-documents.css";

const copy = {
  zh: {
    close: "关闭",
    unsaved: "填写内容尚未保存，确定放弃吗？",
    keep: "继续填写",
    discard: "放弃",
  },
  en: {
    close: "Close",
    unsaved: "You have unsaved changes. Discard them?",
    keep: "Keep editing",
    discard: "Discard",
  },
} as const;

export function ShipmentActionDialog({
  title,
  description,
  language = "zh",
  wide = false,
  resetKey,
  error,
  onClose,
  onSubmitted,
  children,
}: {
  title: string;
  description?: string;
  language?: keyof typeof copy;
  wide?: boolean;
  resetKey?: unknown;
  error?: string;
  onClose: () => void;
  onSubmitted: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const busy = useNavigation().state !== "idle";
  const text = copy[language];
  useEffect(() => {
    setDirty(false);
    setDiscard(false);
  }, [resetKey]);
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (typeof dialog?.showModal === "function") dialog.showModal();
    return () => {
      dialog?.close();
      if (previousFocus?.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, []);
  function close() {
    if (busy) return;
    if (dirty) setDiscard(true);
    else onClose();
  }
  return (
    <dialog
      ref={ref}
      className={`shipment-action-dialog${wide ? " shipment-action-dialog-wide" : ""}`}
      aria-labelledby="shipment-action-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onChangeCapture={() => setDirty(true)}
      onSubmitCapture={onSubmitted}
    >
      <header className="shipment-action-dialog-header">
        <h2 id="shipment-action-dialog-title">{title}</h2>
        <button
          type="button"
          className="shipment-action-dialog-close"
          title={text.close}
          aria-label={text.close}
          disabled={busy}
          onClick={close}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <div className="shipment-action-dialog-body">
        {description && <p>{description}</p>}
        {discard && (
          <div className="shipment-dialog-notice" role="alert">
            <p>{text.unsaved}</p>
            <div className="shipment-inline-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setDiscard(false)}
              >
                {text.keep}
              </button>
              <button
                type="button"
                className="button button-primary"
                onClick={onClose}
              >
                {text.discard}
              </button>
            </div>
          </div>
        )}
        {error && (
          <p className="shipment-action-dialog-error" role="alert">
            {error}
          </p>
        )}
        {children}
      </div>
    </dialog>
  );
}
