import { describe, expect, it } from "vitest";

import { remoteMigrationSql } from "../scripts/remote-migration-sql.mjs";

describe("remote D1 migration script", () => {
  it("records each migration in the same script, in order", () => {
    const sql = remoteMigrationSql(
      ["0001_a.sql", "0002_b.sql"],
      (name: string) => `CREATE TABLE ${name.slice(0, 4)}(x);\n`,
    );

    expect(sql.indexOf("CREATE TABLE 0001")).toBeLessThan(
      sql.indexOf("VALUES ('0001_a.sql')"),
    );
    expect(sql.indexOf("VALUES ('0001_a.sql')")).toBeLessThan(
      sql.indexOf("CREATE TABLE 0002"),
    );
    expect(sql.indexOf("CREATE TABLE 0002")).toBeLessThan(
      sql.indexOf("VALUES ('0002_b.sql')"),
    );
  });

  it("keeps trigger bodies intact and rejects unsafe migration names", () => {
    const trigger =
      "CREATE TRIGGER t BEFORE INSERT ON x BEGIN SELECT 1; END;\n";
    const sql = remoteMigrationSql(["0005_t.sql"], () => trigger);

    expect(sql).toContain(trigger.trimEnd());
    expect(() =>
      remoteMigrationSql(["0001'; DROP TABLE x; --.sql"], () => ""),
    ).toThrow("Unsafe migration name");
  });
});
