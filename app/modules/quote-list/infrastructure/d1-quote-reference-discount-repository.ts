import {
  noQuoteReferenceDiscount,
  type QuoteReferenceDiscount,
  type QuoteReferenceDiscountLookup,
} from "../domain/quote-reference-discount";

export function createD1QuoteReferenceDiscountRepository(database: D1Database) {
  return {
    async findApplicable(
      input: QuoteReferenceDiscountLookup,
    ): Promise<QuoteReferenceDiscount> {
      const row = await database
        .prepare(
          `SELECT discount_percent AS discountPercent,
                  minimum_quantity AS minimumQuantity,
                  record_version AS recordVersion
           FROM quote_reference_discounts
           WHERE release_id = ? AND sku = ? AND line_kind = ?
             AND minimum_quantity <= ?
           ORDER BY minimum_quantity DESC
           LIMIT 1`,
        )
        .bind(input.releaseId, input.sku, input.lineKind, input.quantity)
        .first<QuoteReferenceDiscount>();
      return row ?? noQuoteReferenceDiscount;
    },
  };
}
