import type { Route } from "./+types/configurator-compatible-end-a-resource";
import { createD1ConfiguratorRepository } from "../../configurator/infrastructure/d1-configurator-repository";
import { cloudflareContext } from "#workers/context";

export async function loader({ context, request }: Route.LoaderArgs) {
  const hoseSku = new URL(request.url).searchParams.get("hose")?.trim();
  if (!hoseSku) {
    return Response.json({ error: "Hose SKU is required" }, { status: 400 });
  }
  const { env } = context.get(cloudflareContext);
  const candidates = await createD1ConfiguratorRepository(
    env.DB,
  ).findCompatibleEndA(hoseSku);
  return Response.json({ candidates, hoseSku });
}
