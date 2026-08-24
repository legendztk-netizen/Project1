import type { Route } from "./+types/catalog-product-resource";
import { createD1PublicCatalogRepository } from "../../catalog/infrastructure/d1-public-catalog-repository";
import { cloudflareContext } from "#workers/context";

export async function loader({ context, params }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const product = await createD1PublicCatalogRepository(env.DB).findItem(
    params.sku,
  );
  if (!product) {
    return Response.json({ error: "Product not found" }, { status: 404 });
  }
  return Response.json({ product });
}
