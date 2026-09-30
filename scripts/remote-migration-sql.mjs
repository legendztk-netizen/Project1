/**
 * Builds one SQL script for the pending migrations, each followed by its own
 * `d1_migrations` record. Remote D1 rejects CREATE TRIGGER statements sent
 * through `wrangler d1 migrations apply --remote`, but accepts them in a file
 * import, which is also all-or-nothing. The record inserts share that
 * atomicity, so a failed run leaves the database exactly as it was.
 * @param {string[]} pending migration file names, in the order to apply
 * @param {(name: string) => string} readSql returns the SQL of one migration
 * @returns {string}
 */
export function remoteMigrationSql(pending, readSql) {
  return pending
    .map((name) => {
      if (!/^[0-9A-Za-z_.-]+$/.test(name)) {
        throw new Error(`Unsafe migration name: ${name}`);
      }
      return `${readSql(name).trimEnd()}\n\nINSERT INTO d1_migrations (name) VALUES ('${name}');\n`;
    })
    .join("\n");
}
