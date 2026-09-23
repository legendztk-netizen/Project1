import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useBeforeUnload, useBlocker, useNavigation } from "react-router";
import { X } from "lucide-react";

export function PiPaymentDialog({
  title,
  compact,
  error,
  onClose,
  children,
}: {
  title: string;
  compact: boolean;
  error?: string;
  onClose: () => void;
  children: (close: () => void) => ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const submitting = useRef(false);
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      !submitting.current &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
  );
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialog?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (!busy) submitting.current = false;
  }, [busy]);
  useBeforeUnload(
    useCallback(
      (event) => {
        if (dirty && !submitting.current) {
          event.preventDefault();
          event.returnValue = "";
        }
      },
      [dirty],
    ),
  );
  function close() {
    if (busy) return;
    if (dirty) setDiscard(true);
    else onClose();
  }
  return (
    <dialog
      ref={ref}
      className={`payment-dialog ${compact ? "payment-dialog-compact" : "payment-dialog-drawer"}`}
      aria-labelledby="payment-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onChangeCapture={() => setDirty(true)}
      onSubmitCapture={() => {
        submitting.current = true;
      }}
    >
      <header className="payment-dialog-header">
        <h2 id="payment-dialog-title">{title}</h2>
        <button
          type="button"
          className="payment-icon-button"
          title="关闭"
          aria-label="关闭"
          disabled={busy}
          onClick={close}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      {(discard || blocker.state === "blocked") && (
        <div className="payment-discard-notice" role="alert">
          <p>填写内容尚未保存，确定放弃修改吗？</p>
          <div className="payment-inline-actions">
            <button
              className="button button-secondary"
              type="button"
              onClick={() => {
                setDiscard(false);
                if (blocker.state === "blocked") blocker.reset();
              }}
            >
              继续填写
            </button>
            <button
              className="button button-primary"
              type="button"
              onClick={() => {
                if (blocker.state === "blocked") blocker.proceed();
                else onClose();
              }}
            >
              放弃修改
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="payment-dialog-error" role="alert">
          {error}
        </p>
      )}
      {children(close)}
    </dialog>
  );
}
