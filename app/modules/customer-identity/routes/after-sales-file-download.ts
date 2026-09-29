import type { LoaderFunctionArgs } from "react-router";

import { cloudflareContext } from "#workers/context";
import { piCustomerProfile, piRouteId } from "#workers/proforma-invoice";
import { createAfterSalesFiles } from "../../after-sales/application/after-sales-files";

export async function loader({ context, params, request }: LoaderFunctionArgs) {
  const { env } = context.get(cloudflareContext);
  const profileId = await piCustomerProfile(env, request);
  return createAfterSalesFiles(env.DB, env.PRIVATE_FILES).customerDownload(
    profileId,
    piRouteId(params.orderId),
    piRouteId(params.fileId),
  );
}
