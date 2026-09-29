import { ArrowLeft } from "lucide-react";
import {
  data,
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
import {
  ChinaCalendarForm,
  ChinaCalendarGuide,
  ChinaCalendarSummary,
  chinaCalendarError,
} from "../../shipment/ui/admin-china-calendar-form";

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
  const inDialog = form.get("responseMode") === "dialog";
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
        error: chinaCalendarError(
          error instanceof Response ? error.status : 400,
          error instanceof Response
            ? await error.text()
            : error instanceof Error
              ? error.message
              : "",
        ),
      },
      { status: error instanceof Response ? error.status : 400 },
    );
  }
  // The order list opens the calendar in a dialog through a fetcher; it
  // reloads the calendar itself instead of following a redirect.
  if (inDialog) return data({ saved: true as const });
  return redirect("/admin/china-calendar?saved=1");
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
        {saved && <p role="status">日历版本已发布。</p>}
        <ChinaCalendarSummary
          calendar={calendar}
          exceptionCount={exceptions.length}
        />
        <ChinaCalendarGuide />
        <ChinaCalendarForm
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
