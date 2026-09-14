import type { AdminIdentity } from "#workers/admin-access";
import {
  digest,
  privateNote,
  validateEvidence,
} from "../domain/private-review";

export function createPrivateReview(
  database: D1Database,
  bucket: R2Bucket,
  actor: AdminIdentity,
) {
  if (!actor?.id || !["owner", "subaccount"].includes(actor.accountType))
    throw new Response("Forbidden", { status: 403 });

  async function requireQuote(requestId: string) {
    if (
      !(await database
        .prepare("SELECT id FROM customer_quote_requests WHERE id=?")
        .bind(requestId)
        .first())
    )
      throw new Response("Not found", { status: 404 });
  }
  function audit(id: string, requestId: string, type: string, now: string) {
    return database
      .prepare(
        "INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at) VALUES(?,?,'quote_review',?,?,?,?)",
      )
      .bind(
        `private-review:${id}`,
        type,
        requestId,
        actor.id,
        JSON.stringify({ recordId: id }),
        now,
      );
  }
  async function command(
    commandId: string,
    requestId: string,
    intent: string,
    payload: string,
  ) {
    if (!/^[0-9a-f-]{36}$/.test(commandId))
      throw new Response("Command id required", { status: 400 });
    const hash = await digest(new TextEncoder().encode(payload).buffer);
    async function replay() {
      const row = await database
        .prepare("SELECT * FROM quote_private_commands WHERE id=?")
        .bind(commandId)
        .first<{
          request_id: string;
          actor_id: string;
          intent: string;
          payload_hash: string;
          record_id: string;
        }>();
      if (!row) return null;
      if (
        row.request_id !== requestId ||
        row.actor_id !== actor.id ||
        row.intent !== intent ||
        row.payload_hash !== hash
      )
        throw new Response("Command conflict", { status: 409 });
      return row.record_id;
    }
    return {
      replay,
      insert: (id: string) =>
        database
          .prepare(
            "INSERT INTO quote_private_commands(id,request_id,actor_id,intent,payload_hash,record_id) VALUES(?,?,?,?,?,?)",
          )
          .bind(commandId, requestId, actor.id, intent, hash, id),
    };
  }
  return {
    async list(requestId: string) {
      await requireQuote(requestId);
      const notes = await database
        .prepare(
          "SELECT id,body,actor_id,created_at FROM quote_internal_notes WHERE request_id=? ORDER BY created_at,id",
        )
        .bind(requestId)
        .all<{
          id: string;
          body: string;
          actor_id: string;
          created_at: string;
        }>();
      const files = await database
        .prepare(
          "SELECT id,kind,filename,content_type,byte_size,checksum,version,actor_id,created_at FROM quote_private_evidence WHERE request_id=? ORDER BY created_at,id",
        )
        .bind(requestId)
        .all<{
          id: string;
          kind: string;
          filename: string;
          created_at: string;
        }>();
      return { notes: notes.results, files: files.results };
    },
    async appendNote(requestId: string, body: string, commandId: string) {
      await requireQuote(requestId);
      const note = privateNote(body);
      const operation = await command(commandId, requestId, "note", note);
      const replay = await operation.replay();
      if (replay) return replay;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      try {
        await database.batch([
          operation.insert(id),
          database
            .prepare(
              "INSERT INTO quote_internal_notes(id,request_id,actor_id,body,created_at) VALUES(?,?,?,?,?)",
            )
            .bind(id, requestId, actor.id, note, now),
          audit(id, requestId, "quote_review.note_added", now),
        ]);
      } catch (error) {
        const completed = await operation.replay();
        if (completed) return completed;
        throw error;
      }
      return id;
    },
    async upload(
      requestId: string,
      kind: string,
      file: File,
      commandId: string,
    ) {
      await requireQuote(requestId);
      if (!["tax_exemption", "supporting"].includes(kind))
        throw new Response("Invalid evidence type", { status: 400 });
      const validated = await validateEvidence(file);
      const operation = await command(
        commandId,
        requestId,
        "upload",
        JSON.stringify([
          kind,
          validated.filename,
          validated.contentType,
          validated.checksum,
        ]),
      );
      const replay = await operation.replay();
      if (replay) return replay;
      const id = crypto.randomUUID();
      const key = `quote-review/${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      await bucket.put(key, validated.bytes, {
        httpMetadata: { contentType: validated.contentType },
      });
      try {
        await database.batch([
          operation.insert(id),
          database
            .prepare(
              "INSERT INTO quote_private_evidence(id,request_id,actor_id,kind,filename,content_type,byte_size,checksum,object_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
            )
            .bind(
              id,
              requestId,
              actor.id,
              kind,
              validated.filename,
              validated.contentType,
              file.size,
              validated.checksum,
              key,
              now,
            ),
          audit(id, requestId, "quote_review.evidence_added", now),
        ]);
      } catch (error) {
        await bucket.delete(key);
        const completed = await operation.replay();
        if (completed) return completed;
        throw error;
      }
      return id;
    },
    async grant(requestId: string, evidenceId: string) {
      await requireQuote(requestId);
      if (
        !(await database
          .prepare(
            "SELECT id FROM quote_private_evidence WHERE id=? AND request_id=?",
          )
          .bind(evidenceId, requestId)
          .first())
      )
        throw new Response("Not found", { status: 404 });
      const token = crypto.randomUUID();
      const tokenHash = await digest(new TextEncoder().encode(token).buffer);
      await database
        .prepare(
          "INSERT INTO quote_private_download_grants(token_hash,evidence_id,request_id,actor_id,expires_at) VALUES(?,?,?,?,?)",
        )
        .bind(
          tokenHash,
          evidenceId,
          requestId,
          actor.id,
          new Date(Date.now() + 300000).toISOString(),
        )
        .run();
      return token;
    },
    async download(requestId: string, token: string) {
      if (!/^[0-9a-f-]{36}$/.test(token))
        throw new Response("Not found", { status: 404 });
      const hash = await digest(new TextEncoder().encode(token).buffer);
      const file = await database
        .prepare(
          "SELECT e.object_key,e.filename,e.content_type,e.checksum FROM quote_private_download_grants g JOIN quote_private_evidence e ON e.id=g.evidence_id AND e.request_id=g.request_id WHERE g.token_hash=? AND g.request_id=? AND g.actor_id=? AND g.expires_at>?",
        )
        .bind(hash, requestId, actor.id, new Date().toISOString())
        .first<{
          object_key: string;
          filename: string;
          content_type: string;
          checksum: string;
        }>();
      if (!file) throw new Response("Not found", { status: 404 });
      const object = await bucket.get(file.object_key);
      if (!object) throw new Response("Not found", { status: 404 });
      const bytes = await object.arrayBuffer();
      if ((await digest(bytes)) !== file.checksum)
        throw new Response("Evidence integrity failure", { status: 409 });
      return new Response(bytes, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${file.filename}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "sandbox",
          "Referrer-Policy": "no-referrer",
        },
      });
    },
  };
}
