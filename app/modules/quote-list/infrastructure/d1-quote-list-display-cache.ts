import type {
  AnonymousQuoteLine,
  QuoteLineRefresh,
} from "../domain/anonymous-quote-list";

// Increment when validation/calculation code changes the meaning of cached results.
const formatVersion = 1;

interface CacheRow {
  line_id: string;
  input_hash: string;
  result_json: string;
}

async function inputHash(line: AnonymousQuoteLine) {
  const bytes = new TextEncoder().encode(JSON.stringify(line));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

function restore(
  line: AnonymousQuoteLine,
  row: CacheRow,
): AnonymousQuoteLine | null {
  try {
    const value = JSON.parse(row.result_json) as {
      refresh: QuoteLineRefresh;
      currentIssue: string | null;
    };
    if (
      !value.refresh ||
      !["ready", "blocked"].includes(value.refresh.status) ||
      !Array.isArray(value.refresh.blockingReasons) ||
      !value.refresh.current ||
      !value.refresh.former ||
      !(value.currentIssue === null || typeof value.currentIssue === "string")
    )
      return null;
    return line.lineKind === "configured_assembly"
      ? {
          ...line,
          refresh: value.refresh,
          configuredAssembly: {
            ...line.configuredAssembly,
            currentIssue: value.currentIssue,
          },
        }
      : { ...line, refresh: value.refresh };
  } catch {
    return null;
  }
}

export function createD1QuoteListDisplayCache(database: D1Database) {
  async function version() {
    const row = await database
      .prepare(
        "SELECT version FROM quote_list_display_revision WHERE singleton = 1",
      )
      .first<{ version: number }>();
    if (!row) throw new Error("Quote List display revision is unavailable");
    return row.version;
  }

  return {
    async read(input: {
      sessionId: string;
      readLines: () => Promise<AnonymousQuoteLine[]>;
      refresh: (lines: AnonymousQuoteLine[]) => Promise<AnonymousQuoteLine[]>;
    }) {
      const dataVersion = await version();
      const lines = await input.readLines();
      if (lines.length === 0) return lines;
      const rows = await database
        .prepare(
          `
        SELECT c.line_id, c.input_hash, c.result_json
        FROM quote_line_display_cache c
        JOIN anonymous_quote_lines l ON l.id = c.line_id
        WHERE l.session_id = ? AND c.data_version = ? AND c.format_version = ?
      `,
        )
        .bind(input.sessionId, dataVersion, formatVersion)
        .all<CacheRow>();
      const cached = new Map(rows.results.map((row) => [row.line_id, row]));
      const hashes = new Map(
        await Promise.all(
          lines.map(async (line) => [line.id, await inputHash(line)] as const),
        ),
      );
      const restored = new Map<string, AnonymousQuoteLine>();
      for (const line of lines) {
        const row = cached.get(line.id);
        if (row && row.input_hash === hashes.get(line.id)) {
          const result = restore(line, row);
          if (result) restored.set(line.id, result);
        }
      }
      const missing = lines.filter((line) => !restored.has(line.id));
      const refreshed = missing.length ? await input.refresh(missing) : [];
      // A concurrent publication invalidates even cache hits read earlier.
      if ((await version()) !== dataVersion)
        return input.refresh(await input.readLines());
      if (refreshed.length) {
        const entries = refreshed.map((line) => ({
          id: line.id,
          hash: hashes.get(line.id),
          result: {
            refresh: line.refresh,
            currentIssue:
              line.lineKind === "configured_assembly"
                ? line.configuredAssembly.currentIssue
                : null,
          },
        }));
        // Bounded payloads and one SQL statement per chunk, not one per line.
        for (let offset = 0; offset < entries.length; offset += 20) {
          await database
            .prepare(
              `
            INSERT INTO quote_line_display_cache(line_id, input_hash, data_version, format_version, result_json)
            SELECT l.id, json_extract(e.value, '$.hash'), ?, ?, json_extract(e.value, '$.result')
            FROM json_each(?) e JOIN anonymous_quote_lines l ON l.id = json_extract(e.value, '$.id')
            WHERE l.session_id = ? AND (SELECT version FROM quote_list_display_revision WHERE singleton = 1) = ?
            ON CONFLICT(line_id) DO UPDATE SET input_hash = excluded.input_hash,
              data_version = excluded.data_version, format_version = excluded.format_version, result_json = excluded.result_json
          `,
            )
            .bind(
              dataVersion,
              formatVersion,
              JSON.stringify(entries.slice(offset, offset + 20)),
              input.sessionId,
              dataVersion,
            )
            .run();
        }
      }
      for (const line of refreshed) restored.set(line.id, line);
      return lines.map((line) => restored.get(line.id)!);
    },
  };
}
