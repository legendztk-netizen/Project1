import { createD1PublicCatalogRepository } from "../../catalog/infrastructure/d1-public-catalog-repository";
import type { PublicCatalogItem } from "../../catalog/domain/public-catalog";
import {
  QuoteListCommandRejected,
  type AnonymousQuoteSession,
} from "../domain/anonymous-quote-list";
import {
  createAnonymousQuoteCookie,
  quoteSessionExpiry,
  readAnonymousQuoteSessionId,
} from "../domain/anonymous-quote-session";
import { createD1AnonymousQuoteListRepository } from "../infrastructure/d1-anonymous-quote-list-repository";
import type { ApplicationBindings } from "#workers/environment";
import { quoteSessionSigningKey } from "#workers/session-secrets";

function standardProductError(product: PublicCatalogItem | null) {
  if (!product || !product.canAddToQuote || !product.offer) {
    return new QuoteListCommandRejected(
      "This product is not currently available to add to a quote.",
      "PRODUCT_NOT_AVAILABLE",
    );
  }
  if (product.offer.madeToOrder) {
    return new QuoteListCommandRejected(
      "This product requires length or configuration details before it can be added.",
      "STANDARD_PRODUCT_REQUIRED",
    );
  }
  return null;
}

export function createAnonymousQuoteListService(
  env: ApplicationBindings,
  dependencies: {
    generateId?: () => string;
    now?: () => Date;
  } = {},
) {
  const catalog = createD1PublicCatalogRepository(env.DB);
  const quoteList = createD1AnonymousQuoteListRepository(env.DB);
  const generateId = dependencies.generateId ?? (() => crypto.randomUUID());
  const now = dependencies.now ?? (() => new Date());
  const secret = quoteSessionSigningKey(env);

  function time() {
    const value = now();
    return {
      date: value,
      expiresAt: quoteSessionExpiry(value),
      now: value.toISOString(),
    };
  }

  async function cookie(sessionId: string, date: Date) {
    return createAnonymousQuoteCookie({
      now: date,
      secret,
      secure: env.APP_ENV !== "local",
      sessionId,
    });
  }

  async function existingSession(request: Request) {
    const sessionId = await readAnonymousQuoteSessionId(request, secret);
    if (!sessionId) return null;
    return quoteList.findActiveSession(sessionId, time().now);
  }

  async function ensureSession(request: Request) {
    const existing = await existingSession(request);
    if (existing) return { created: false, session: existing };
    const current = time();
    await quoteList.deleteExpiredSessions(current.now);
    const session: AnonymousQuoteSession = {
      expiresAt: current.expiresAt,
      id: generateId(),
    };
    await quoteList.createSession(session, current.now);
    return { created: true, session };
  }

  async function requireProduct(sku: string) {
    const product = await catalog.findItem(sku);
    const rejection = standardProductError(product);
    if (rejection) throw rejection;
    return product!;
  }

  async function catalogChanged(sku: string) {
    const rejection = standardProductError(await catalog.findItem(sku));
    return (
      rejection ??
      new QuoteListCommandRejected(
        "The active catalog changed while this item was being updated. Try again.",
        "PRODUCT_NOT_AVAILABLE",
      )
    );
  }

  return {
    async add(request: Request, sku: string, quantity: number) {
      const product = await requireProduct(sku);
      const { session } = await ensureSession(request);
      const current = time();
      try {
        const lineId = await quoteList.addStandardLine({
          expiresAt: current.expiresAt,
          lineId: generateId(),
          now: current.now,
          product,
          quantity,
          sessionId: session.id,
        });
        if (!lineId) throw await catalogChanged(sku);
      } catch (error) {
        if (error instanceof QuoteListCommandRejected) throw error;
        if (
          error instanceof Error &&
          error.message.includes("CHECK constraint")
        ) {
          throw new QuoteListCommandRejected(
            "The combined quantity must be between 1 and 9,999.",
            "INVALID_QUANTITY",
          );
        }
        throw error;
      }
      return { setCookie: await cookie(session.id, current.date) };
    },

    async read(request: Request) {
      const session = await existingSession(request);
      if (!session) return { lines: [], setCookie: null };
      const current = time();
      const touched = await quoteList.touchSession(
        session.id,
        current.now,
        current.expiresAt,
      );
      if (!touched) return { lines: [], setCookie: null };
      return {
        lines: await quoteList.listLines(session.id),
        setCookie: await cookie(session.id, current.date),
      };
    },

    async remove(request: Request, lineId: string) {
      const { created, session } = await ensureSession(request);
      const current = time();
      if (created) {
        return { setCookie: await cookie(session.id, current.date) };
      }
      const removed = await quoteList.removeLine({
        expiresAt: current.expiresAt,
        lineId,
        now: current.now,
        sessionId: session.id,
      });
      if (!removed) {
        throw new QuoteListCommandRejected(
          "That Quote List line no longer exists.",
          "LINE_NOT_FOUND",
        );
      }
      return { setCookie: await cookie(session.id, current.date) };
    },

    async update(request: Request, lineId: string, quantity: number) {
      const { created, session } = await ensureSession(request);
      const current = time();
      if (created) {
        return { setCookie: await cookie(session.id, current.date) };
      }
      const line = await quoteList.findLine(session.id, lineId);
      if (!line) {
        throw new QuoteListCommandRejected(
          "That Quote List line no longer exists.",
          "LINE_NOT_FOUND",
        );
      }
      const product = await requireProduct(line.sku);
      const updated = await quoteList.updateStandardLine({
        expiresAt: current.expiresAt,
        lineId,
        now: current.now,
        product,
        quantity,
        sessionId: session.id,
      });
      if (!updated) throw await catalogChanged(line.sku);
      return { setCookie: await cookie(session.id, current.date) };
    },
  };
}
