// Only public catalog DTOs belong here. Identity/session/quote responses must never
// enter this cache. Every lookup is preceded by a fresh D1 publication token.
export interface PublicCatalogEdgeCache {
  cache: Pick<Cache, "match" | "put">;
  origin: string;
  waitUntil: (promise: Promise<unknown>) => void;
}

export async function catalogCacheKey(
  origin: string,
  token: string,
  scope: string,
) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  const version = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  // Bump the namespace whenever the serialized DTO or its interpretation changes.
  return new Request(
    new URL(
      `/__public-catalog-cache/v1/${version}/${encodeURIComponent(scope)}`,
      origin,
    ),
  );
}

export function storefrontCatalogCache(context: {
  env: { PUBLIC_STOREFRONT_ORIGIN: string };
  ctx: { waitUntil: (promise: Promise<unknown>) => void };
}): PublicCatalogEdgeCache | undefined {
  if (typeof caches === "undefined" || !("default" in caches)) return undefined;
  return {
    cache: (caches as CacheStorage & { default: Cache }).default,
    origin: context.env.PUBLIC_STOREFRONT_ORIGIN,
    waitUntil: (promise) => context.ctx.waitUntil(promise),
  };
}
