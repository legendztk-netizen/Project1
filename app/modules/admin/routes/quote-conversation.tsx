import { redirect } from "react-router";
import type { Route } from "./+types/quote-conversation";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";

// Customer conversations now live in 消息管理; keep old links working.
export function loader({ context, params }: Route.LoaderArgs) {
  requireAdminRequestContext(context);
  return redirect(`/admin/messages/${encodeURIComponent(params.requestId)}`);
}
