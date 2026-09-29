import { canAccessAdminPath } from "../domain/admin-module-access";
import type { LoaderFunctionArgs } from "react-router";
import { piPrivateHeaders } from "#workers/proforma-invoice";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { createD1AdminNotifications } from "../infrastructure/d1-admin-notifications";
import { createD1MessageCenter } from "../../message-center/infrastructure/d1-message-center";

export async function loader({ context }: LoaderFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const [unread, messages] = await Promise.all([
    createD1AdminNotifications(env.DB).unreadCount(adminIdentity.id),
    canAccessAdminPath(adminIdentity, "/admin/messages", "GET")
      ? createD1MessageCenter(env.DB).adminUnreadThreads(adminIdentity.id)
      : Promise.resolve(0),
  ]);
  return Response.json({ unread, messages }, { headers: piPrivateHeaders() });
}
