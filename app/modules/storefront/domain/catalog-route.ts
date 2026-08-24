import {
  launchCatalogFamilies,
  type CatalogFamilyId,
} from "../../catalog/domain/catalog-family";

export function requireCatalogFamilyId(
  value: string | undefined,
): CatalogFamilyId {
  const match = launchCatalogFamilies.find((family) => family.id === value);
  if (!match) throw new Response("Category not found", { status: 404 });
  return match.id;
}
