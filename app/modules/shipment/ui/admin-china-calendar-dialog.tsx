import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { useFetcher } from "react-router";
import {
  ChinaCalendarForm,
  ChinaCalendarGuide,
  ChinaCalendarSummary,
  type ChinaCalendarData,
} from "./admin-china-calendar-form";
import { ShipmentActionDialog } from "./shipment-action-dialog";

const calendarPath = "/admin/china-calendar";

export function AdminChinaCalendarDialog({ onClose }: { onClose: () => void }) {
  const calendar = useFetcher<ChinaCalendarData>();
  const action = useFetcher<{ saved: true } | { error: string }>();
  const [published, setPublished] = useState(0);
  const { load } = calendar;
  useEffect(() => {
    load(calendarPath);
  }, [load]);
  useEffect(() => {
    if (action.state !== "idle" || !action.data || !("saved" in action.data))
      return;
    setPublished((count) => count + 1);
    load(calendarPath);
  }, [action.state, action.data, load]);
  const ActionForm = action.Form;
  const DialogForm = useMemo(
    () =>
      function DialogForm(props: ComponentProps<typeof ActionForm>) {
        return <ActionForm action={calendarPath} {...props} />;
      },
    [ActionForm],
  );
  const error =
    action.state === "idle" && action.data && "error" in action.data
      ? action.data.error
      : undefined;
  const data = calendar.data;
  return (
    <ShipmentActionDialog
      title="中国履约日历"
      wide
      resetKey={published}
      onClose={onClose}
      onSubmitted={() => {}}
    >
      {data ? (
        <>
          {published > 0 && (
            <p className="shipment-documents-saved" role="status">
              日历第 {data.calendar?.version} 版已发布。
            </p>
          )}
          <ChinaCalendarSummary
            calendar={data.calendar}
            exceptionCount={data.exceptions.length}
          />
          <ChinaCalendarGuide />
          <ChinaCalendarForm
            key={`${data.calendar?.version ?? 0}:${published}`}
            calendar={data.calendar}
            exceptions={data.exceptions}
            commandId={data.commandId}
            error={error}
            busy={action.state !== "idle" || calendar.state !== "idle"}
            FormComponent={DialogForm}
            hiddenFields={
              <input type="hidden" name="responseMode" value="dialog" />
            }
          />
        </>
      ) : (
        <p role="status">正在加载中国履约日历…</p>
      )}
    </ShipmentActionDialog>
  );
}
