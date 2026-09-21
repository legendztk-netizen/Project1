import type { LoaderFunctionArgs } from "react-router";
import { cloudflareContext } from "#workers/context";
import {
  piAcceptance,
  piAcceptanceRequestEvidence,
} from "#workers/pi-acceptance";
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
  const query = new URL(request.url).searchParams;
  // Version-scoped customer actions mint evidence; legacy/history links remain read-only.
  if (query.has("documentVersion") || query.has("snapshotHash")) {
    if (request.method !== "GET")
      throw new Response("Method not allowed", {
        status: 405,
        headers: headers(),
      });
    const documentVersion = Number(query.get("documentVersion"));
    const snapshotHash = query.get("snapshotHash") ?? "";
    if (
      !Number.isSafeInteger(documentVersion) ||
      documentVersion < 1 ||
      !/^[a-f0-9]{64}$/.test(snapshotHash)
    )
      throw new Response("Exact PI version and snapshot hash required", {
        status: 400,
        headers: headers(),
      });
    const result = await piAcceptance(env).customerView(
      profileId,
      piRouteId(params.requestId),
      { piId: piRouteId(params.piId), documentVersion, snapshotHash },
      query.get("disposition") === "inline" ? "view" : "download",
      piAcceptanceRequestEvidence(request),
    );
    return result.response;
  }
  return proformaInvoices(env).customerDownload(
    profileId,
    piRouteId(params.requestId),
    piRouteId(params.piId),
    new URL(request.url).searchParams.get("disposition") === "inline"
      ? "inline"
      : "attachment",
  );
}
