import type { LoaderFunctionArgs } from "react-router";
import { piPrivateHeaders } from "#workers/proforma-invoice";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { createD1AdminNotifications } from "../infrastructure/d1-admin-notifications";

export async function loader({ context }: LoaderFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const unread = await createD1AdminNotifications(env.DB).unreadCount(
    adminIdentity.id,
  );
  return Response.json({ unread }, { headers: piPrivateHeaders() });
}
