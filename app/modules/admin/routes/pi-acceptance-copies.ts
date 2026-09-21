import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import {
  piAcceptanceCopies,
  piEmailPrivateHeaders,
  readPiEmailCommand,
} from "#workers/pi-email-acceptance";
import type { ReconcilePiAcceptanceCopyInput } from "../../proforma-invoice/application/pi-acceptance-copies";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const query = new URL(request.url).searchParams;
  const service = await piAcceptanceCopies(env);
  const capture = query.get("capture");
  const result = capture
    ? await service.readLocalCapture(adminIdentity, capture)
    : await service.listAdmin(adminIdentity, {
        limit: query.has("limit") ? Number(query.get("limit")) : undefined,
        before: query.get("before") ?? undefined,
        unresolved: query.get("unresolved") === "true",
      });
  return Response.json(result, { headers: piEmailPrivateHeaders });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const input = (await readPiEmailCommand(request)) as Record<string, unknown>;
  if (input.action === "reconcile") {
    await (
      await piAcceptanceCopies(env)
    ).reconcileAdmin(
      adminIdentity,
      request,
      input as unknown as ReconcilePiAcceptanceCopyInput,
    );
    return Response.json(
      { status: "reconciled" },
      { headers: piEmailPrivateHeaders },
    );
  }
  if (
    input.action !== "retry" ||
    typeof input.acceptanceId !== "string" ||
    typeof input.reason !== "string"
  )
    throw new Response("Copy retry command required", { status: 400 });
  await (
    await piAcceptanceCopies(env)
  ).retryAdmin(adminIdentity, request, input.acceptanceId, input.reason);
  return Response.json({ status: "retry" }, { headers: piEmailPrivateHeaders });
}
