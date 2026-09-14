import { data, Link } from "react-router";
import type { Route } from "./+types/quote-notification-capture";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { quoteNotifications } from "#workers/quote-notifications";
import { AdminNavigation } from "../ui/admin-navigation";

export function headers() {
  return {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
  };
}
export async function loader({ context, params }: Route.LoaderArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const email = await (
    await quoteNotifications(env)
  ).readLocalCapture(adminIdentity, params.notificationId);
  return data({ email }, { headers: headers() });
}
export default function NotificationCapture({
  loaderData,
}: Route.ComponentProps) {
  const { email } = loaderData;
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="quotes" />
      <main className="admin-main private-review-page">
        <Link to="/admin/quote-notifications">返回邮件通知</Link>
        <h1>本地测试邮件（未实际发送）</h1>
        <section className="quote-message">
          <p>To: {email.to.join(", ")}</p>
          <p>From: {email.from}</p>
          <p>Reply-To: {email.reply_to}</p>
          <h2>{email.subject}</h2>
          <p>{email.text}</p>
        </section>
      </main>
    </div>
  );
}
