import type { LoaderFunctionArgs } from "react-router";
import { piPrivateHeaders } from "#workers/proforma-invoice";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { createD1AdminNotifications } from "../infrastructure/d1-admin-notifications";
import { createD1MessageCenter } from "../../message-center/infrastructure/d1-message-center";

export async function loader({ context }: LoaderFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const [unread, messages] = await Promise.all([
    createD1AdminNotifications(env.DB).unreadCount(adminIdentity.id),
    createD1MessageCenter(env.DB).adminUnreadThreads(adminIdentity.id),
  ]);
  return Response.json({ unread, messages }, { headers: piPrivateHeaders() });
}
