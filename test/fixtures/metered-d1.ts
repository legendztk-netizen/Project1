// Wraps a D1 binding and counts the rows D1 reports as read (meta.rows_read, what D1 bills) by every statement
// run through it, including statements inside batches. Reset `counter.reads` between measurements.
export function metered(database: D1Database) {
  const counter = { reads: 0 };
  const add = (meta: { rows_read?: number } | undefined) => {
    counter.reads += meta?.rows_read ?? 0;
  };
  const statement = (target: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(target, {
      get(object, key) {
        if (key === "bind")
          return (...values: unknown[]) => statement(object.bind(...values));
        if (key === "all" || key === "run")
          return async () => {
            const result = await (
              object as never as Record<
                string,
                () => Promise<{ meta?: { rows_read?: number } }>
              >
            )[key]();
            add(result.meta);
            return result;
          };
        if (key === "first")
          return async (column?: string) => {
            const result = await object.all<Record<string, unknown>>();
            add(result.meta as { rows_read?: number });
            const row = result.results[0] ?? null;
            return column ? (row ? row[column] : null) : row;
          };
        const value = Reflect.get(object, key);
        return typeof value === "function" ? value.bind(object) : value;
      },
    });
  const binding = new Proxy(database, {
    get(object, key) {
      if (key === "prepare")
        return (sql: string) => statement(object.prepare(sql));
      if (key === "batch")
        return async (statements: D1PreparedStatement[]) => {
          const results = await object.batch(statements);
          for (const result of results) add(result.meta);
          return results;
        };
      const value = Reflect.get(object, key);
      return typeof value === "function" ? value.bind(object) : value;
    },
  });
  return { counter, binding };
}
