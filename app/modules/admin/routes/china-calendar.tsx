import { useState } from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import {
  data,
  Form,
  Link,
  redirect,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { piPrivateHeaders } from "#workers/proforma-invoice";
import { createChinaCalendarService } from "../../shipment/application/china-calendar-service";
import {
  readPrivateReviewForm,
  requireReviewMutation,
} from "../../quote-review/domain/private-review";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { AdminNavigation } from "../ui/admin-navigation";
import "../../shipment/ui/shipment-documents.css";

export const headers = piPrivateHeaders;

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const details = await createChinaCalendarService(env.DB).adminDetails(
    adminIdentity,
  );
  return data(
    {
      ...details,
      saved: new URL(request.url).searchParams.has("saved"),
      commandId: crypto.randomUUID(),
    },
    { headers: headers() },
  );
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  requireReviewMutation(request);
  const form = await readPrivateReviewForm(request);
  const dates = form.getAll("exceptionDate").map(String);
  const states = form.getAll("exceptionIsWorking").map(String);
  const reasons = form.getAll("exceptionReason").map(String);
  if (dates.length !== states.length || dates.length !== reasons.length)
    throw new Response("Invalid calendar exceptions", { status: 400 });
  try {
    await createChinaCalendarService(env.DB, {
      auditIp: request.headers.get("cf-connecting-ip") ?? "local",
    }).publish(adminIdentity, {
      expectedCurrentVersion: form.get("expectedCurrentVersion")
        ? Number(form.get("expectedCurrentVersion"))
        : null,
      commandId: String(form.get("commandId") ?? ""),
      coverageFrom: String(form.get("coverageFrom") ?? ""),
      coverageThrough: String(form.get("coverageThrough") ?? ""),
      workingWeekdays: form.getAll("workingWeekday").map(Number),
      exceptions: dates.map((date, index) => ({
        date,
        isWorking: states[index] === "true",
        reason: reasons[index],
      })),
      revisionReason: String(form.get("revisionReason") ?? ""),
      confirmedComplete: form.get("confirmedComplete") === "on",
    });
  } catch (error) {
    if (error instanceof Response && ![400, 409].includes(error.status))
      throw error;
    return data(
      {
        error:
          error instanceof Response && error.status === 409
            ? "日历版本已变化，请刷新后重新核对。"
            : "日历发布失败，请检查覆盖日期、工作日、例外日期和审核依据。",
      },
      { status: error instanceof Response ? error.status : 400 },
    );
  }
  return redirect("/admin/china-calendar?saved=1");
}

type CalendarException = {
  date: string;
  isWorking: boolean;
  reason: string;
};

function CalendarForm({
  calendar,
  exceptions: initialExceptions,
  commandId,
  error,
  busy,
}: {
  calendar: Awaited<ReturnType<typeof loader>>["data"]["calendar"];
  exceptions: CalendarException[];
  commandId: string;
  error?: string;
  busy: boolean;
}) {
  const [exceptions, setExceptions] = useState(initialExceptions);
  const weekdays = [
    [1, "周一"],
    [2, "周二"],
    [3, "周三"],
    [4, "周四"],
    [5, "周五"],
    [6, "周六"],
    [7, "周日"],
  ] as const;
  const update = (index: number, patch: Partial<CalendarException>) =>
    setExceptions((items) =>
      items.map((item, position) =>
        position === index ? { ...item, ...patch } : item,
      ),
    );
  return (
    <Form method="post" className="shipment-calendar-form">
      <input
        type="hidden"
        name="expectedCurrentVersion"
        value={calendar?.version ?? ""}
      />
      <input type="hidden" name="commandId" value={commandId} />
      <div className="shipment-calendar-grid">
        <label>
          覆盖起始日期
          <input
            type="date"
            name="coverageFrom"
            defaultValue={calendar?.coverageFrom}
            required
          />
        </label>
        <label>
          覆盖结束日期
          <input
            type="date"
            name="coverageThrough"
            defaultValue={calendar?.coverageThrough}
            required
          />
        </label>
      </div>
      <fieldset>
        <legend>通常工作日</legend>
        <div className="shipment-calendar-weekdays">
          {weekdays.map(([day, label]) => (
            <label key={day}>
              <input
                type="checkbox"
                name="workingWeekday"
                value={day}
                defaultChecked={
                  calendar ? calendar.workingWeekdays.includes(day) : day <= 5
                }
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>节假日、停工与调休</legend>
        <div className="shipment-calendar-exceptions">
          {exceptions.map((exception, index) => (
            <div className="shipment-calendar-exception" key={index}>
              <label>
                日期
                <input
                  type="date"
                  name="exceptionDate"
                  value={exception.date}
                  onChange={(event) =>
                    update(index, { date: event.target.value })
                  }
                  required
                />
              </label>
              <label>
                当天是否工作
                <select
                  name="exceptionIsWorking"
                  value={String(exception.isWorking)}
                  onChange={(event) =>
                    update(index, { isWorking: event.target.value === "true" })
                  }
                >
                  <option value="false">不工作</option>
                  <option value="true">工作</option>
                </select>
              </label>
              <label>
                原因
                <input
                  name="exceptionReason"
                  value={exception.reason}
                  onChange={(event) =>
                    update(index, { reason: event.target.value })
                  }
                  maxLength={500}
                  required
                />
              </label>
              <button
                type="button"
                className="button button-secondary"
                aria-label={`删除第 ${index + 1} 个例外日期`}
                onClick={() =>
                  setExceptions((items) =>
                    items.filter((_, position) => position !== index),
                  )
                }
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="button button-secondary"
          onClick={() =>
            setExceptions((items) => [
              ...items,
              { date: "", isWorking: false, reason: "" },
            ])
          }
        >
          <Plus size={16} aria-hidden="true" /> 添加例外日期
        </button>
      </fieldset>
      <label>
        本次日历审核依据
        <textarea
          name="revisionReason"
          minLength={10}
          maxLength={2000}
          required
        />
      </label>
      <label className="shipment-calendar-confirm">
        <input type="checkbox" name="confirmedComplete" required />
        已核对覆盖区间内所有节假日、停工和调休；发布后该版本不可修改。
      </label>
      {error && <p role="alert">{error}</p>}
      <button className="button button-primary" type="submit" disabled={busy}>
        {busy ? "正在发布…" : "发布中国履约日历"}
      </button>
    </Form>
  );
}

export default function ChinaCalendar({
  loaderData,
  actionData,
}: {
  loaderData: Awaited<ReturnType<typeof loader>>["data"];
  actionData?: { error: string };
}) {
  const { calendar, exceptions, commandId, saved } = loaderData;
  const busy = useNavigation().state !== "idle";
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="orders" />
      <main className="admin-main private-review-page shipment-documents-page">
        <Link className="customer-quote-back-link" to="/admin/orders">
          <ArrowLeft size={17} aria-hidden="true" /> 返回订单
        </Link>
        <h1>中国履约日历</h1>
        <p>
          当前版本：{calendar?.version ?? "未发布"}
          。仅用于新订单和待人工落实的约定日期；既有日期不会重算。
        </p>
        {saved && <p role="status">日历版本已发布。</p>}
        <CalendarForm
          key={calendar?.version ?? 0}
          calendar={calendar}
          exceptions={exceptions}
          commandId={commandId}
          error={actionData?.error}
          busy={busy}
        />
      </main>
    </div>
  );
}
