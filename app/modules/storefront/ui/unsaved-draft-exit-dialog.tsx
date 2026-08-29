import { Mail, TriangleAlert } from "lucide-react";
import { useEffect, useRef, type FormEvent } from "react";

interface UnsavedDraftExitDialogProps {
  email: string;
  error: string | null;
  isSaved: boolean;
  isSaving: boolean;
  onEmailChange: (value: string) => void;
  onLeave: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onStay: () => void;
}

export function UnsavedDraftExitDialog({
  email,
  error,
  isSaved,
  isSaving,
  onEmailChange,
  onLeave,
  onSave,
  onStay,
}: UnsavedDraftExitDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const stayButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const isSavingRef = useRef(isSaving);
  const onStayRef = useRef(onStay);
  const canOfferEmailSave = email.trim().length > 0 && !isSaved;

  useEffect(() => {
    isSavingRef.current = isSaving;
    onStayRef.current = onStay;
  }, [isSaving, onStay]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    document.body.style.overflow = "hidden";
    stayButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSavingRef.current) {
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
        <form onSubmit={onSave}>
          {isSaved ? (
            <div className="unsaved-draft-saved" role="status">
              <Mail aria-hidden="true" size={19} />
              <div>
                <strong>Verification email sent</strong>
                <small>
                  The exact snapshot is pending email verification. It is not an
                  account or a Quote List line.
                </small>
              </div>
            </div>
          ) : (
            <>
              <label htmlFor="exit-save-email">Email address</label>
              <input
                autoComplete="email"
                id="exit-save-email"
                onChange={(event) => onEmailChange(event.currentTarget.value)}
                placeholder="you@example.com"
                type="email"
                value={email}
              />
              <small>
                Enter an email to save a server snapshot before leaving. This
                does not create an account or add the configuration to your
                Quote List.
              </small>
            </>
          )}
          {error ? (
            <p className="unsaved-draft-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="unsaved-draft-actions">
            <button
              className="button button-secondary"
              disabled={isSaving}
              onClick={onStay}
              ref={stayButtonRef}
              type="button"
            >
              Stay and Continue
            </button>
            <button
              className="button unsaved-draft-discard"
              disabled={isSaving}
              onClick={onLeave}
              type="button"
            >
              Leave and Discard
            </button>
            {canOfferEmailSave ? (
              <button
                className="button button-primary"
                disabled={isSaving}
                type="submit"
              >
                <Mail aria-hidden="true" size={17} />
                {isSaving ? "Saving..." : "Save by Email"}
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}
