import type { ActionFunctionArgs } from "react-router";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import {
  piEmailAcceptance,
  piEmailPrivateHeaders,
  readPiEmailCommand,
} from "#workers/pi-email-acceptance";
import { piAcceptanceRequestEvidence } from "#workers/pi-acceptance";
import type { AcceptPiFromEmailInput } from "../../proforma-invoice/application/pi-email-acceptance-service";

export async function action({ request, context, params }: ActionFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  if (!params.requestId || !params.piId)
    throw new Response("Not found", { status: 404 });
  const input = (await readPiEmailCommand(request)) as AcceptPiFromEmailInput;
  if (input.requestId !== params.requestId || input.piId !== params.piId)
    throw new Response("PI target mismatch", { status: 409 });
  const result = await (
    await piEmailAcceptance(env)
  ).accept(adminIdentity, request, input, piAcceptanceRequestEvidence(request));
  return Response.json(result, { headers: piEmailPrivateHeaders });
}
