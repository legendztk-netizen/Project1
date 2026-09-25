import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { useFetcher } from "react-router";
import {
  AdminShipmentDocumentsWorkspace,
  type AdminShipmentDocumentsData,
} from "./admin-shipment-documents-workspace";
import { ShipmentActionDialog } from "./shipment-action-dialog";

type ActionResult =
  | { saved: true; tab: "packing" | "files" }
  | { error: string; retryCommandId?: string };

export function AdminShipmentDocumentsDialog({
  orderId,
  shipmentId,
  title,
  onClose,
}: {
  orderId: string;
  shipmentId: string;
  title: string;
  onClose: () => void;
}) {
  const base = `/admin/orders/${encodeURIComponent(orderId)}/shipments/${encodeURIComponent(shipmentId)}`;
  const workspace = useFetcher<AdminShipmentDocumentsData>();
  const action = useFetcher<ActionResult>();
  const [saves, setSaves] = useState(0);
  const { load } = workspace;
  useEffect(() => {
    load(base);
  }, [base, load]);
  useEffect(() => {
    if (action.state !== "idle" || !action.data || !("saved" in action.data))
      return;
    setSaves((count) => count + 1);
    load(`${base}?tab=${action.data.tab}&saved=1`);
  }, [action.state, action.data, base, load]);
  const ActionForm = action.Form;
  const DialogForm = useMemo(
    () =>
      function DialogForm(props: ComponentProps<typeof ActionForm>) {
        return <ActionForm action={base} {...props} />;
      },
    [ActionForm, base],
  );
  const error =
    action.state === "idle" && action.data && "error" in action.data
      ? action.data
      : undefined;
  return (
    <ShipmentActionDialog
      title={title}
      wide
      resetKey={saves}
      onClose={onClose}
      onSubmitted={() => {}}
    >
      {workspace.data ? (
        <AdminShipmentDocumentsWorkspace
          key={saves}
          loaderData={workspace.data}
          actionData={error}
          busy={action.state !== "idle" || workspace.state !== "idle"}
          FormComponent={DialogForm}
          hiddenFields={
            <input type="hidden" name="responseMode" value="dialog" />
          }
          onPageChange={(page) => load(`${base}?tab=files&page=${page}`)}
        />
      ) : (
        <p role="status">正在加载装箱与文件…</p>
      )}
    </ShipmentActionDialog>
  );
}
