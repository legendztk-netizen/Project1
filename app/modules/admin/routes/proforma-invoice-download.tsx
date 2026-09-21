import type { LoaderFunctionArgs } from "react-router";
import {
  proformaInvoices,
  piPrivateHeaders,
  piRouteId,
} from "#workers/proforma-invoice";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";

export const headers = piPrivateHeaders;
export async function loader({ context, params, request }: LoaderFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  return proformaInvoices(env).adminDownload(
    adminIdentity,
    piRouteId(params.requestId),
    piRouteId(params.piId),
    new URL(request.url).searchParams.get("disposition") === "inline"
      ? "inline"
      : "attachment",
  );
}
