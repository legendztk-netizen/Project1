import type { LoaderFunctionArgs } from "react-router";

import { cloudflareContext } from "#workers/context";
import { piCustomerProfile, piRouteId } from "#workers/proforma-invoice";
import { createShipmentDocumentsService } from "../../shipment/application/shipment-documents-service";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { env } = context.get(cloudflareContext);
  const profileId = await piCustomerProfile(env, request);
  return createShipmentDocumentsService(
    env.DB,
    env.PRIVATE_FILES,
  ).customerDownload(
    profileId,
    piRouteId(params.orderId),
    piRouteId(params.shipmentId),
    piRouteId(params.documentId),
  );
}
