import type { Route } from "./+types/catalog-release-product-resource";
import { createD1CatalogPublicationRepository } from "../../catalog/infrastructure/d1-catalog-publication-repository";
import { cloudflareContext } from "#workers/context";

export async function loader({ context, params }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const product = await createD1CatalogPublicationRepository(
    env.DB,
  ).findHistoricalPublicProduct(params.releaseId, params.sku);
  if (!product) {
    return Response.json({ error: "Product not found" }, { status: 404 });
  }
  return Response.json({ product });
}
