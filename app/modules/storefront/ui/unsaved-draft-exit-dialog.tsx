import { TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Form } from "react-router";

interface UnsavedDraftExitDialogProps {
  canRegister: boolean;
  canSave: boolean;
  draftSnapshot: string;
  onLeave: () => void;
  onRegister: () => void;
  onSave: () => void;
  onStay: () => void;
  returnTo: string;
  saveError: string | null;
  saving: boolean;
}

export function UnsavedDraftExitDialog({
  canRegister,
  canSave,
  draftSnapshot,
  onLeave,
  onRegister,
  onSave,
  onStay,
  returnTo,
  saveError,
  saving,
}: UnsavedDraftExitDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const stayButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onStayRef = useRef(onStay);
  const [registering, setRegistering] = useState(false);

  useEffect(() => {
    onStayRef.current = onStay;
  }, [onStay]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    document.body.style.overflow = "hidden";
    stayButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onStayRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      returnFocusRef.current?.focus();
    };
  }, []);

  return (
    <div className="unsaved-draft-backdrop">
      <div
        aria-describedby="unsaved-draft-description"
        aria-labelledby="unsaved-draft-title"
        aria-modal="true"
        className="unsaved-draft-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <header>
          <TriangleAlert aria-hidden="true" size={24} />
          <div>
            <span className="eyebrow">Unfinished configuration</span>
            <h2 id="unsaved-draft-title">Leave this configuration?</h2>
          </div>
        </header>
        <p id="unsaved-draft-description">
          Your selected configuration will be lost when you leave.
        </p>
        <small>
          {canRegister
            ? "Registering verifies your email before this draft is saved to your account. It is not stored against an email address alone."
            : "Save this draft to your account before leaving, or discard it."}
        </small>
        <div className="unsaved-draft-actions">
          <button
            className="button button-secondary"
            onClick={onStay}
            ref={stayButtonRef}
            type="button"
          >
            Stay and Continue
          </button>
          <button
            className="button unsaved-draft-discard"
            onClick={onLeave}
            type="button"
          >
            Leave and Discard
          </button>
          {canRegister && !registering ? (
            <button
              className="button button-primary"
              onClick={() => setRegistering(true)}
              type="button"
            >
              Register to Save
            </button>
          ) : null}
          {canSave ? (
            <button
              className="button button-primary"
              disabled={saving}
              onClick={onSave}
              type="button"
            >
              {saving ? "Saving..." : "Save Configuration and Leave"}
            </button>
          ) : null}
        </div>
        {saveError ? <p role="alert">{saveError}</p> : null}
        {canRegister && registering ? (
          <Form
            action="/register"
            className="unsaved-draft-registration"
            method="post"
            onSubmit={onRegister}
          >
            <input
              name="intent"
              type="hidden"
              value="request-configuration-registration"
            />
            <input name="returnTo" type="hidden" value={returnTo} />
            <input
              name="registrationSnapshot"
              type="hidden"
              value={draftSnapshot}
            />
            <label htmlFor="draft-registration-email">Email address</label>
            <input
              autoComplete="email"
              autoFocus
              id="draft-registration-email"
              inputMode="email"
              name="email"
              placeholder="you@company.com"
              required
              type="email"
            />
            <button className="button button-primary" type="submit">
              Send Verification Code
            </button>
          </Form>
        ) : null}
      </div>
    </div>
  );
}
