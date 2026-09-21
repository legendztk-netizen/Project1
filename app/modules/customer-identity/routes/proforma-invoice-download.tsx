import type { LoaderFunctionArgs } from "react-router";
import { cloudflareContext } from "#workers/context";
import {
  proformaInvoices,
  piCustomerProfile,
  piPrivateHeaders,
  piRouteId,
} from "#workers/proforma-invoice";

export const headers = piPrivateHeaders;
export async function loader({ context, params, request }: LoaderFunctionArgs) {
  const { env } = context.get(cloudflareContext);
  const profileId = await piCustomerProfile(env, request);
  // Ticket #60 owns view/download evidence; this route only delivers authorized fixed bytes.
  return proformaInvoices(env).customerDownload(
    profileId,
    piRouteId(params.requestId),
    piRouteId(params.piId),
    new URL(request.url).searchParams.get("disposition") === "inline"
      ? "inline"
      : "attachment",
  );
}
