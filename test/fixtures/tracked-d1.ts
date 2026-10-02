// Lets a test recognize prepared statements by their SQL text (for example to inject a race right after a
// particular read) instead of depending on how many statements a batch happens to contain.
export function trackStatements(database: D1Database) {
  const sqlOf = new WeakMap<object, string>();
  const original = new WeakMap<object, D1PreparedStatement>();
  const tag = (statement: D1PreparedStatement, sql: string) => {
    const tracked: D1PreparedStatement = new Proxy(statement, {
      get(target, key) {
        if (key === "bind")
          return (...values: unknown[]) => tag(target.bind(...values), sql);
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    sqlOf.set(tracked, sql);
    original.set(tracked, statement);
    return tracked;
  };
  return {
    prepare: (sql: string) => tag(database.prepare(sql), sql),
    // The platform only accepts its own statement objects, so unwrap before running a batch.
    batch: <T = unknown>(statements: D1PreparedStatement[]) =>
      database.batch<T>(
        statements.map((statement) => original.get(statement) ?? statement),
      ),
    sqls: (statements: D1PreparedStatement[]) =>
      statements.map((statement) => sqlOf.get(statement) ?? ""),
  };
}
