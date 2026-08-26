import type { Route } from "./+types/configurator-compatible-end-a-resource";
import { createD1ConfiguratorRepository } from "../../configurator/infrastructure/d1-configurator-repository";
import { cloudflareContext } from "#workers/context";

export async function loader({ context, request }: Route.LoaderArgs) {
  const searchParams = new URL(request.url).searchParams;
  const hoseSku = searchParams.get("hose")?.trim();
  const releaseId = searchParams.get("release")?.trim();
  if (!releaseId || !hoseSku) {
    return Response.json(
      { error: "Catalog Release ID and Hose SKU are required" },
      { status: 400 },
    );
  }
  const { env } = context.get(cloudflareContext);
  const candidates = await createD1ConfiguratorRepository(
    env.DB,
  ).findCompatibleEndA(releaseId, hoseSku);
  return Response.json({ candidates, hoseSku, releaseId });
}
