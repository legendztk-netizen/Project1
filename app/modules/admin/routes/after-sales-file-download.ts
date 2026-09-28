import type { LoaderFunctionArgs } from "react-router";

import { piRouteId } from "#workers/proforma-invoice";
import { createAfterSalesFiles } from "../../after-sales/application/after-sales-files";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";

export async function loader({ context, params }: LoaderFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  return createAfterSalesFiles(env.DB, env.PRIVATE_FILES).adminDownload(
    adminIdentity,
    piRouteId(params.orderId),
    piRouteId(params.fileId),
  );
}
