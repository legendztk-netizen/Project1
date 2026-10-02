import { beforeAll, afterAll, expect, it } from "vitest";
import { startAfterSalesDatabase } from "./fixtures/after-sales-order";
import { metered } from "./fixtures/metered-d1";
import { createD1AdminQuoteReviewRepository } from "../app/modules/quote-review/infrastructure/d1-admin-quote-review-repository";
import {
  filterAdminQuoteReviews,
  type AdminQuoteReviewFilters,
} from "../app/modules/quote-review/domain/admin-quote-review";
let db: D1Database;
let dispose: () => Promise<void>;
const filters: AdminQuoteReviewFilters = {
  reviewState: "all",
  technicalReview: "all",
  sort: "newest",
};
beforeAll(async () => {
  ({ db, dispose } = await startAfterSalesDatabase("quote-pagination"));
  const statements = Array.from({ length: 76 }, (_, i) => {
    const id = `page-${String(i).padStart(3, "0")}`;
    const snapshot = {
      lines: [
        i % 3 === 0
          ? {
              lineKind: "configured_assembly",
              configuredAssembly: {
                snapshot: {
                  review: { outcome: "technical_review", issues: [] },
                },
              },
            }
          : { lineKind: "standard" },
      ],
    };
    return db
      .prepare(
        `INSERT INTO customer_quote_requests
      (id,reference_number,profile_id,purchasing_context_id,source_session_id,source_session_version,source_address_id,purchasing_context_kind,fulfillment_term,currency,merchandise_subtotal,service_fee_total,idempotency_key,snapshot_json,submitted_at)
      VALUES (?,?,'buyer','buyer-context',?,'1',?,'individual','DDP','USD',100,0,?,?,?)`,
      )
      .bind(
        id,
        id,
        id,
        id,
        id,
        JSON.stringify(snapshot),
        `2026-09-24T${String(Math.floor(i / 4)).padStart(2, "0")}:00:00.000Z`,
      );
  });
  await db.batch(statements);
}, 90000);
afterAll(async () => {
  await dispose?.();
});
it("paginates without gaps and reads technical histories only for the visible page", async () => {
  const full = metered(db);
  const reference = await createD1AdminQuoteReviewRepository(full.binding).list(
    filters,
  );
  const measured = metered(db);
  const repo = createD1AdminQuoteReviewRepository(measured.binding);
  const first = await repo.listPage(filters);
  expect(first.reviews).toEqual(reference.slice(0, 25));
  expect(first.hasNext).toBe(true);
  expect(measured.counter.reads).toBeLessThan(full.counter.reads);
  const combined = [...first.reviews];
  for (let page = 2; page <= 4; page++) {
    const result = await repo.listPage(filters, page);
    combined.push(...result.reviews);
    expect(result.hasNext).toBe(page < 4);
  }
  expect(combined).toEqual(reference);
  expect((await repo.listPage(filters, 0)).page).toBe(1);
  expect((await repo.listPage(filters, NaN)).page).toBe(1);
  expect((await repo.listPage(filters, 5)).reviews).toEqual([]);
});
it("keeps technical filters and priority global, including matches after the first SQL page", async () => {
  const repo = createD1AdminQuoteReviewRepository(db);
  const all = await repo.list(filters);
  for (const f of [
    { ...filters, technicalReview: "required" as const },
    { ...filters, sort: "technical_first" as const },
    { ...filters, reviewState: "quote_ready" as const },
    { ...filters, reviewState: "awaiting_review" as const },
  ]) {
    const expected = filterAdminQuoteReviews(all, f);
    for (let page = 1; page <= 2; page++) {
      const result = await repo.listPage(f, page);
      expect(result.reviews).toEqual(
        expected.slice((page - 1) * 25, page * 25),
      );
      expect(result.hasNext).toBe(expected.length > page * 25);
    }
  }
});
