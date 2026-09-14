import type { Route } from "./+types/quote-private-download";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { createPrivateReview } from "../../quote-review/infrastructure/d1-private-review";

export async function loader({ context, params, request }: Route.LoaderArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  return createPrivateReview(env.DB, env.PRIVATE_FILES, adminIdentity).download(
    params.requestId,
    new URL(request.url).searchParams.get("token") ?? "",
  );
}
