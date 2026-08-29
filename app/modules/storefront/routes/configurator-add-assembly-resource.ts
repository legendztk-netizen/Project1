import type { Route } from "./+types/configurator-add-assembly-resource";
import { createAnonymousQuoteListService } from "../../quote-list/application/anonymous-quote-list-service";
import { QuoteListCommandRejected } from "../../quote-list/domain/anonymous-quote-list";
import { parseStandardProductQuantity } from "../../quote-list/domain/anonymous-quote-session";
import { cloudflareContext } from "#workers/context";

export async function action({ context, request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed", ok: false },
      { status: 405 },
    );
  }
  const form = await request.formData();
  const quantity = parseStandardProductQuantity(form.get("quantity"));
  if (quantity === null) {
    return Response.json(
      { error: "Quantity must be a whole number from 1 to 9,999.", ok: false },
      { status: 422 },
    );
  }
  const rawDraft = form.get("draft");
  let draft: unknown;
  try {
    draft = typeof rawDraft === "string" ? JSON.parse(rawDraft) : null;
  } catch {
    return Response.json(
      {
        error: "The assembly draft could not be read. Review it and try again.",
        ok: false,
      },
      { status: 422 },
    );
  }
  const { env } = context.get(cloudflareContext);
  try {
    const service = createAnonymousQuoteListService(env);
    const replaceLineId = form.get("replaceLineId");
    const result =
      typeof replaceLineId === "string" && replaceLineId.trim() !== ""
        ? await service.replaceConfiguredAssembly(
            request,
            replaceLineId.trim(),
            draft,
            quantity,
          )
        : await service.addConfiguredAssembly(request, draft, quantity);
    const headers = new Headers();
    if (result.setCookie) headers.set("Set-Cookie", result.setCookie);
    return Response.json({ error: null, ok: true }, { headers });
  } catch (error) {
    if (error instanceof QuoteListCommandRejected) {
      return Response.json(
        { error: error.message, ok: false },
        { status: 409 },
      );
    }
    throw error;
  }
}
