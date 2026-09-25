import type { LoaderFunctionArgs } from "react-router";

import { piRouteId } from "#workers/proforma-invoice";
import { createShipmentDocumentsService } from "../../shipment/application/shipment-documents-service";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";

export async function loader({ context, params }: LoaderFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  return createShipmentDocumentsService(
    env.DB,
    env.PRIVATE_FILES,
  ).adminDownload(
    adminIdentity,
    piRouteId(params.orderId),
    piRouteId(params.shipmentId),
    piRouteId(params.documentId),
  );
}
