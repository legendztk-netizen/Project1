import { it, expect } from "vitest";
import { getPlatformProxy } from "wrangler";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createD1CatalogCutover } from "../app/modules/catalog/infrastructure/d1-catalog-cutover";

it.skipIf(!process.env.CATALOG_CUTOVER_BACKUP)(
  "rehearses the real database snapshot in an isolated local D1",
  async () => {
    const root = resolve(import.meta.dirname, ".."),
      dir = resolve(root, ".scratch/ticket-86/real-rehearsal");
    const localDir = join(
      root,
      ".wrangler/state/v3/d1/miniflare-D1DatabaseObject",
    );
    const filename = readdirSync(localDir).find(
      (n) => n.endsWith(".sqlite") && n !== "metadata.sqlite",
    )!;
    const target = join(dir, "v3/d1/miniflare-D1DatabaseObject");
    mkdirSync(target, { recursive: true });
    copyFileSync(
      resolve(process.env.CATALOG_CUTOVER_BACKUP!),
      join(target, filename),
    );
    execFileSync("pnpm", ["migrate"], {
      cwd: root,
      env: { ...process.env, D1_PERSIST_TO: dir },
      maxBuffer: 16 * 1024 * 1024,
    });
    const platform = await getPlatformProxy<{ DB: D1Database }>({
      configPath: join(root, "wrangler.jsonc"),
      persist: { path: join(dir, "v3") },
      remoteBindings: false,
    });
    try {
      const db = platform.env.DB,
        repo = createD1CatalogCutover(db, {
          id: "cutover-rehearsal",
          accountType: "owner",
          catalogPermission: "edit",
        });
      const inventory = await repo.inventory("real-copy");
      writeFileSync(
        join(root, ".scratch/ticket-86/real-report.json"),
        inventory.report_json,
      );
      const before = (
        await db
          .prepare(
            "SELECT * FROM catalog_runtime_skus WHERE import_id=(SELECT source_import_id FROM catalog_releases WHERE id=(SELECT baseline_release_id FROM catalog_item_publication_state)) ORDER BY sku",
          )
          .all()
      ).results;
      await repo.freeze(inventory.id);
      await repo.commit(inventory.id);
      expect((await repo.commit(inventory.id)).status).toBe("committed");
      const after = (
        await db
          .prepare(
            "SELECT * FROM catalog_runtime_skus WHERE import_id=(SELECT source_import_id FROM catalog_releases WHERE id=(SELECT baseline_release_id FROM catalog_item_publication_state)) ORDER BY sku",
          )
          .all()
      ).results;
      expect(after).toEqual(before);
      expect(
        (await db.prepare("PRAGMA foreign_key_check").all()).results,
      ).toEqual([]);
      writeFileSync(
        join(root, ".scratch/ticket-86/real-result.json"),
        JSON.stringify({
          status: "passed",
          skuCount: after.length,
          fingerprint: inventory.fingerprint,
        }),
      );
    } finally {
      await platform.dispose();
    }
  },
  600000,
);
