// Request-local counters; no SQL, parameters, identities or query strings in logs.
const sources = new WeakMap<D1Database, D1Database>();
export function catalogCacheBinding(database: D1Database): D1Database {
  return sources.get(database) ?? database;
}

const cacheMetrics = new WeakMap<
  D1Database,
  Record<"memory" | "edge" | "miss", number>
>();
export function recordCatalogCache(
  database: D1Database,
  tier: "memory" | "edge" | "miss",
) {
  const counter = cacheMetrics.get(database);
  if (counter) counter[tier]++;
}

export function meterD1(database: D1Database) {
  const metrics = {
    queries: 0,
    rowsRead: 0,
    rowsWritten: 0,
    catalogCache: { memory: 0, edge: 0, miss: 0 },
  };
  const underlying = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const record = (result: D1Result) => {
    metrics.queries++;
    metrics.rowsRead += result.meta.rows_read ?? 0;
    metrics.rowsWritten += result.meta.rows_written ?? 0;
  };
  const statement = (target: D1PreparedStatement): D1PreparedStatement => {
    const proxy = new Proxy(target, {
      get(object, key) {
        if (key === "bind")
          return (...values: unknown[]) => statement(object.bind(...values));
        if (key === "all" || key === "run")
          return async () => {
            const result = await object[key]();
            record(result);
            return result;
          };
        if (key === "first")
          return async (column?: string) => {
            const result = await object.all<Record<string, unknown>>();
            record(result);
            const row = result.results[0] ?? null;
            if (row && column !== undefined && !(column in row))
              throw new Error(`D1_COLUMN_NOTFOUND: Column not found`);
            return column === undefined ? row : (row?.[column] ?? null);
          };
        const value = Reflect.get(object, key);
        return typeof value === "function" ? value.bind(object) : value;
      },
    });
    underlying.set(proxy, target);
    return proxy;
  };
  const binding = new Proxy(database, {
    get(object, key) {
      if (key === "prepare")
        return (sql: string) => statement(object.prepare(sql));
      if (key === "batch")
        return async (statements: D1PreparedStatement[]) => {
          const results = await object.batch(
            statements.map((item) => underlying.get(item) ?? item),
          );
          results.forEach(record);
          return results;
        };
      const value = Reflect.get(object, key);
      return typeof value === "function" ? value.bind(object) : value;
    },
  });
  sources.set(binding, catalogCacheBinding(database));
  cacheMetrics.set(binding, metrics.catalogCache);
  return { binding, metrics };
}

export function catalogRequestArea(pathname: string) {
  const path = pathname.replace(/\.data$/, "");
  if (
    path === "/catalog" ||
    path.startsWith("/catalog/") ||
    path.startsWith("/api/catalog/")
  )
    return "catalog";
  if (path === "/build-a-hose" || path.startsWith("/api/configurator/"))
    return "configurator";
  if (path.includes("quote-list") || path.includes("quote-assembly"))
    return "quote-list";
  return null;
}
