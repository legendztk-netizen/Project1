import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { expect, it } from "vitest";

it("applies 0071 through actual Wrangler with populated message, attachment, outbox, token and capture tables", async () => {
  const directory = mkdtempSync(join(tmpdir(), "inbound-wrangler-migration-"));
  const configPath = join(directory, "wrangler.json");
  const migrations = join(directory, "migrations");
  mkdirSync(migrations);
  for (const file of readdirSync("migrations").filter(
    (name) => /^\d{4}_.*\.sql$/.test(name) && name.slice(0, 4) <= "0070",
  ))
    copyFileSync(join("migrations", file), join(migrations, file));
  writeFileSync(
    configPath,
    JSON.stringify({
      name: "inbound-migration-only",
      compatibility_date: "2026-08-20",
      d1_databases: [
        {
          binding: "DB",
          database_name: "inbound-migration-only",
          database_id: crypto.randomUUID(),
          migrations_dir: migrations,
        },
      ],
      r2_buckets: [
        { binding: "PRIVATE_FILES", bucket_name: "inbound-migration-files" },
      ],
    }),
  );
  function migrate() {
    const result = spawnSync(
      process.execPath,
      [
        "node_modules/wrangler/bin/wrangler.js",
        "d1",
        "migrations",
        "apply",
        "inbound-migration-only",
        "--config",
        configPath,
        "--local",
        "--persist-to",
        directory,
      ],
      {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        env: {
          ...process.env,
          CLOUDFLARE_ENV: "",
          WRANGLER_SEND_METRICS: "false",
        },
      },
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
  }
  let platform:
    | Awaited<
        ReturnType<
          typeof getPlatformProxy<{ DB: D1Database; PRIVATE_FILES: R2Bucket }>
        >
      >
    | undefined;
  const open = () =>
    getPlatformProxy<{ DB: D1Database; PRIVATE_FILES: R2Bucket }>({
      configPath,
      persist: { path: join(directory, "v3") },
      remoteBindings: false,
    });
  try {
    migrate();
    platform = await open();
    const db = platform.env.DB;
    await db.batch([
      db.prepare(
        "INSERT INTO customer_profiles(id,email_normalized,email_display,email_verified_at,created_at,updated_at) VALUES('p','buyer@test.invalid','buyer@test.invalid','2026-09-14','2026-09-14','2026-09-14')",
      ),
      db.prepare(
        "INSERT INTO customer_purchasing_contexts(id,kind,individual_profile_id,created_at,updated_at) VALUES('c','individual','p','2026-09-14','2026-09-14')",
      ),
      db.prepare(`INSERT INTO customer_quote_requests(id,reference_number,profile_id,purchasing_context_id,source_session_id,source_session_version,
        source_address_id,purchasing_context_kind,fulfillment_term,currency,merchandise_subtotal,service_fee_total,idempotency_key,snapshot_json,submitted_at)
        VALUES('q','RFQ-1','p','c','s',1,'a','individual','DDP','USD',0,0,'q','{}','2026-09-14')`),
      db.prepare("INSERT INTO quote_conversations VALUES('q','2026-09-14')"),
      db.prepare(
        "INSERT INTO quote_conversation_messages VALUES('m','q','admin','a','Original message','2026-09-14','command','hash','website','available')",
      ),
      db.prepare(
        "INSERT INTO quote_conversation_attachments(message_id,filename,content_type,byte_size,checksum,object_key) VALUES('m','old.pdf','application/pdf',3,'hash','private-existing')",
      ),
      db.prepare(
        "INSERT INTO quote_notification_outbox(id,message_id,request_id,idempotency_key,state,created_at,next_attempt_at,next_dispatch_at,first_attempt_at,recipient_profile_id,recipient_email,protected_payload,delivery_mode) VALUES('o','m','q','immutable-key','sent',1,1,1,1,'p','buyer@test.invalid','protected','stub')",
      ),
      db
        .prepare(
          "INSERT INTO quote_notification_reply_tokens VALUES(?,'o','q','p','buyer@test.invalid',1,9999999999999,NULL)",
        )
        .bind("a".repeat(64)),
      db.prepare(
        "INSERT INTO quote_notification_local_captures VALUES('o','protected',1)",
      ),
    ]);
    await platform.env.PRIVATE_FILES.put("private-existing", "old");
    const tables = [
      "quote_conversations",
      "quote_conversation_messages",
      "quote_conversation_attachments",
      "quote_notification_outbox",
      "quote_notification_reply_tokens",
      "quote_notification_local_captures",
    ];
    const before = await db.batch(
      tables.map((table) => db.prepare(`SELECT * FROM ${table}`)),
    );
    await platform.dispose();
    platform = undefined;
    copyFileSync(
      existsSync("migrations/0071_quote_inbound_email.sql")
        ? "migrations/0071_quote_inbound_email.sql"
        : ".scratch/quote-inbound-email-migration.sql",
      join(migrations, "0071_quote_inbound_email.sql"),
    );
    migrate();
    platform = await open();
    const migrated = platform.env.DB;
    const after = await migrated.batch(
      tables.map((table) => migrated.prepare(`SELECT * FROM ${table}`)),
    );
    expect(after.map((result) => result.results)).toEqual(
      before.map((result) => result.results),
    );
    expect(
      (await migrated.prepare("PRAGMA foreign_key_check").all()).results,
    ).toEqual([]);
    expect(
      await migrated
        .prepare(
          "SELECT version FROM application_schema_state WHERE singleton=1",
        )
        .first(),
    ).toEqual({ version: 72 });
    expect(
      await (await platform.env.PRIVATE_FILES.get("private-existing"))!.text(),
    ).toBe("old");
    await expect(
      migrated
        .prepare(
          "UPDATE quote_conversation_messages SET body='bad' WHERE id='m'",
        )
        .run(),
    ).rejects.toThrow(/append only/);
    await expect(
      migrated
        .prepare("DELETE FROM quote_conversation_messages WHERE id='m'")
        .run(),
    ).rejects.toThrow(/append only/);
    await expect(
      migrated
        .prepare(
          "UPDATE quote_notification_outbox SET idempotency_key='bad' WHERE id='o'",
        )
        .run(),
    ).rejects.toThrow(/immutable/);
    await expect(
      migrated
        .prepare(
          "UPDATE quote_notification_reply_tokens SET recipient_email='bad' WHERE notification_id='o'",
        )
        .run(),
    ).rejects.toThrow(/immutable/);
  } finally {
    await platform?.dispose();
    rmSync(directory, { recursive: true, force: true });
  }
}, 60_000);
