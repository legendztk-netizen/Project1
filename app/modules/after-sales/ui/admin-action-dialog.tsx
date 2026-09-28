import { useEffect, useRef, useState, type ReactNode } from "react";
import { useActionData, useNavigation } from "react-router";

import { ActionDialog } from "../../shared/ui/action-dialog";

/**
 * An after-sales Admin action shown as a button; its form opens in a modal
 * dialog and closes after the Order page reloads without an error.
 */
export function AdminActionDialog({
  label,
  title,
  description,
  icon,
  primary = false,
  wide = false,
  children,
}: {
  label: string;
  title?: string;
  description?: string;
  icon?: ReactNode;
  primary?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const actionData = useActionData<{ error?: string } | undefined>();
  const actionAtOpen = useRef(actionData);
  const submitted = useRef(false);
  const navigation = useNavigation();
  useEffect(() => {
    if (navigation.state !== "idle" || !submitted.current) return;
    submitted.current = false;
    if (!actionData?.error) setOpen(false);
  }, [navigation.state, actionData]);
  return (
    <>
      <button
        type="button"
        className={`button ${primary ? "button-primary" : "button-secondary"}`}
        onClick={() => {
          actionAtOpen.current = actionData;
          setOpen(true);
        }}
      >
        {icon}
        {label}
      </button>
      {open && (
        <ActionDialog
          title={title ?? label}
          description={description}
          wide={wide}
          error={
            actionData !== actionAtOpen.current ? actionData?.error : undefined
          }
          onClose={() => setOpen(false)}
          onSubmitted={() => {
            submitted.current = true;
          }}
        >
          {children}
        </ActionDialog>
      )}
    </>
  );
}

/** Files attached to a customer-visible decision; shared with the customer. */
export function EventAttachmentField() {
  return (
    <label>
      附件（可选，将与本次记录一起对客户可见；PDF / PNG / JPEG，最多 5
      个，合计不超过 10 MB）
      <input
        type="file"
        name="attachment"
        multiple
        accept="application/pdf,image/png,image/jpeg"
      />
    </label>
  );
}
