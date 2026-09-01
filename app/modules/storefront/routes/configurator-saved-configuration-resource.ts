import { data } from "react-router";

import type { Route } from "./+types/configurator-saved-configuration-resource";
import { cloudflareContext } from "#workers/context";
import { createSavedConfigurationService } from "../../customer-identity/application/saved-configuration-service";
import { requireTrustedAuthPost } from "../../customer-identity/application/trusted-auth-request";
import { SavedConfigurationRejected } from "../../customer-identity/domain/saved-configuration";

export function loader() {
  throw new Response("Not found", { status: 404 });
}

export async function action({ context, request }: Route.ActionArgs) {
  const { env, runtime } = context.get(cloudflareContext);
  requireTrustedAuthPost({
    environment: runtime.environment,
    request,
    storefrontOrigin: env.PUBLIC_STOREFRONT_ORIGIN,
  });
  const form = await request.formData();
  const commandId = form.get("commandId");
  const snapshot = form.get("snapshot");
  if (
    typeof commandId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      commandId,
    )
  ) {
    return data(
      { error: "A valid save command is required.", ok: false },
      { status: 422 },
    );
  }
  if (typeof snapshot !== "string") {
    return data(
      { error: "A configuration snapshot is required.", ok: false },
      { status: 422 },
    );
  }
  try {
    const saved = await createSavedConfigurationService(env).create({
      commandId,
      request,
      snapshotJson: snapshot,
    });
    if (!saved) {
      return data(
        { error: "Sign in before saving this configuration.", ok: false },
        { status: 401 },
      );
    }
    return data({ error: null, id: saved.id, ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof SavedConfigurationRejected) {
      return data({ error: error.message, ok: false }, { status: 422 });
    }
    throw error;
  }
}
