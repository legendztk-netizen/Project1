import { createD1PublicCatalogRepository } from "../../catalog/infrastructure/d1-public-catalog-repository";
import type { PublicCatalogItem } from "../../catalog/domain/public-catalog";
import {
  digestCustomerSessionToken,
  readCustomerSessionToken,
} from "../../customer-identity/domain/customer-session";
import { createD1CustomerIdentityRepository } from "../../customer-identity/infrastructure/d1-customer-identity-repository";
import {
  QuoteListCommandRejected,
  type AnonymousQuoteLine,
  type AnonymousQuoteSession,
} from "../domain/anonymous-quote-list";
import {
  createAnonymousQuoteCookie,
  quoteSessionExpiry,
  readAnonymousQuoteSessionId,
} from "../domain/anonymous-quote-session";
import {
  calculateLengthBasedHoseEstimate,
  parseLengthBasedHoseOrder,
  type LengthBasedHoseOrder,
} from "../domain/length-based-hose";
import {
  refreshConfiguredAssemblyQuoteLine,
  refreshLengthBasedHoseQuoteLine,
  refreshStandardQuoteLine,
} from "../domain/quote-list-refresh";
import { noQuoteReferenceDiscount } from "../domain/quote-reference-discount";
import { createD1AnonymousQuoteListRepository } from "../infrastructure/d1-anonymous-quote-list-repository";
import { createD1QuoteReferenceDiscountRepository } from "../infrastructure/d1-quote-reference-discount-repository";
import { prepareConfiguredAssembly } from "./prepare-configured-assembly";
import type { ApplicationBindings } from "#workers/environment";
import {
  customerIdentitySigningKey,
  quoteSessionSigningKey,
} from "#workers/session-secrets";

const savedConfigurationChangedMessage =
  "This saved configuration no longer matches the current catalog or reference data. Its original selections are retained for review.";

type ResolvedQuoteSession = AnonymousQuoteSession & {
  accountOwned: boolean;
};

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

function lengthBasedHoseError(product: PublicCatalogItem | null) {
  if (!product || !product.canAddToQuote || !product.offer) {
    return new QuoteListCommandRejected(
      "This hose is not currently available to add to a quote.",
      "PRODUCT_NOT_AVAILABLE",
    );
  }
  if (
    product.productType !== "hose" ||
    !product.offer.madeToOrder ||
    !product.offer.lengthOrdering
  ) {
    return new QuoteListCommandRejected(
      "This product does not support length-based hose ordering.",
      "LENGTH_BASED_HOSE_REQUIRED",
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
  const discounts = createD1QuoteReferenceDiscountRepository(env.DB);
  const identity = createD1CustomerIdentityRepository(env.DB);
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

  async function cookie(session: ResolvedQuoteSession, date: Date) {
    if (session.accountOwned) return null;
    return createAnonymousQuoteCookie({
      now: date,
      secret,
      secure: env.APP_ENV !== "local",
      sessionId: session.id,
    });
  }

  async function authenticatedProfile(request: Request) {
    const token = readCustomerSessionToken(request);
    if (!token) return null;
    const digest = await digestCustomerSessionToken(
      token,
      customerIdentitySigningKey(env),
    );
    return identity.findProfileBySessionDigest({
      digest,
      now: time().now,
    });
  }

  async function existingSession(request: Request) {
    const profile = await authenticatedProfile(request);
    if (profile) {
      const session = await quoteList.findAccountSession(profile.id);
      return session ? { ...session, accountOwned: true } : null;
    }
    const sessionId = await readAnonymousQuoteSessionId(request, secret);
    if (!sessionId) return null;
    const session = await quoteList.findActiveSession(sessionId, time().now);
    return session ? { ...session, accountOwned: false } : null;
  }

  async function ensureSession(request: Request) {
    const existing = await existingSession(request);
    if (existing) return { created: false, session: existing };
    const current = time();
    const profile = await authenticatedProfile(request);
    if (profile) {
      const accountSession = await quoteList.findOrCreateAccountSession({
        now: current.now,
        profileId: profile.id,
        sessionId: generateId(),
      });
      if (!accountSession) {
        throw new Error("Account Quote List could not be created");
      }
      return {
        created: false,
        session: { ...accountSession, accountOwned: true },
      };
    }
    await quoteList.deleteExpiredSessions(current.now);
    const session: ResolvedQuoteSession = {
      accountOwned: false,
      expiresAt: current.expiresAt,
      id: generateId(),
    };
    await quoteList.createSession(session, current.now);
    return { created: true, session };
  }

  async function configuredAssemblySession(request: Request) {
    const existing = await existingSession(request);
    if (existing) return { created: false, session: existing };
    if (await authenticatedProfile(request)) return ensureSession(request);
    const current = time();
    return {
      created: true,
      session: {
        accountOwned: false,
        expiresAt: current.expiresAt,
        id: generateId(),
      } satisfies ResolvedQuoteSession,
    };
  }

  async function requireProduct(sku: string) {
    const product = await catalog.findItem(sku);
    const rejection = standardProductError(product);
    if (rejection) throw rejection;
    return product!;
  }

  async function requireLengthBasedHose(sku: string) {
    const product = await catalog.findItem(sku);
    const rejection = lengthBasedHoseError(product);
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

  async function lengthCatalogChanged(sku: string) {
    const rejection = lengthBasedHoseError(await catalog.findItem(sku));
    return (
      rejection ??
      new QuoteListCommandRejected(
        "The active catalog changed while this hose was being updated. Try again.",
        "PRODUCT_NOT_AVAILABLE",
      )
    );
  }

  function translateQuantityConstraint(error: unknown): never {
    if (error instanceof Error && error.message.includes("CHECK constraint")) {
      throw new QuoteListCommandRejected(
        "The combined number of pieces must be between 1 and 9,999.",
        "INVALID_QUANTITY",
      );
    }
    throw error;
  }

  async function refreshLinesForDisplay(
    lines: Awaited<ReturnType<typeof quoteList.listLines>>,
    refreshedAt: string,
  ): Promise<AnonymousQuoteLine[]> {
    function refreshDiscounts(
      line: AnonymousQuoteLine,
      currentReleaseId: string | null,
    ) {
      return Promise.all([
        discounts.findApplicable({
          lineKind: line.lineKind,
          quantity: line.quantity,
          releaseId: line.catalogReleaseId,
          sku: line.sku,
        }),
        currentReleaseId
          ? discounts.findApplicable({
              lineKind: line.lineKind,
              quantity: line.quantity,
              releaseId: currentReleaseId,
              sku: line.sku,
            })
          : Promise.resolve(noQuoteReferenceDiscount),
      ]);
    }

    return Promise.all(
      lines.map(async (line) => {
        if (line.lineKind === "standard") {
          const product = await catalog.findItem(line.sku);
          const [formerDiscount, currentDiscount] = await refreshDiscounts(
            line,
            product?.releaseId ?? null,
          );
          return {
            ...line,
            refresh: refreshStandardQuoteLine({
              currentDiscount,
              formerDiscount,
              line,
              product,
              refreshedAt,
            }),
          };
        }
        if (line.lineKind === "length_based_hose") {
          const product = await catalog.findItem(line.sku);
          const [formerDiscount, currentDiscount] = await refreshDiscounts(
            line,
            product?.releaseId ?? null,
          );
          return {
            ...line,
            refresh: refreshLengthBasedHoseQuoteLine({
              currentDiscount,
              formerDiscount,
              line,
              product,
              refreshedAt,
            }),
          };
        }
        try {
          const prepared = await prepareConfiguredAssembly({
            database: env.DB,
            draft: line.configuredAssembly.snapshot.configuration,
            quantity: line.quantity,
            referenceMode: "current",
          });
          const [formerDiscount, currentDiscount] = await refreshDiscounts(
            line,
            prepared.hoseProduct.releaseId,
          );
          return {
            ...line,
            configuredAssembly: {
              ...line.configuredAssembly,
              currentIssue: null,
            },
            refresh: refreshConfiguredAssemblyQuoteLine({
              current: {
                basis: prepared.estimateBasis,
                snapshot: prepared.snapshot,
                unitEstimateAmount: prepared.unitEstimateAmount,
              },
              currentDiscount,
              formerDiscount,
              issue: null,
              line,
              refreshedAt,
            }),
          };
        } catch (error) {
          if (!(error instanceof QuoteListCommandRejected)) throw error;
          const [formerDiscount] = await refreshDiscounts(line, null);
          return {
            ...line,
            configuredAssembly: {
              ...line.configuredAssembly,
              currentIssue: savedConfigurationChangedMessage,
            },
            refresh: refreshConfiguredAssemblyQuoteLine({
              current: null,
              currentDiscount: undefined,
              formerDiscount,
              issue: error.message,
              line,
              refreshedAt,
            }),
          };
        }
      }),
    );
  }

  return {
    async addConfiguredAssembly(
      request: Request,
      draft: unknown,
      quantity: number,
    ) {
      const prepared = await prepareConfiguredAssembly({
        database: env.DB,
        draft,
        quantity,
      });
      const { created, session } = await configuredAssemblySession(request);
      const current = time();
      try {
        const lineId = await quoteList.addConfiguredAssemblyLine({
          estimateBasis: prepared.estimateBasis,
          createSession: created,
          expiresAt: current.expiresAt,
          lineId: generateId(),
          lineIdentity: prepared.lineIdentity,
          now: current.now,
          product: prepared.hoseProduct,
          quantity: prepared.quantity,
          sessionId: session.id,
          snapshot: prepared.snapshot,
          unitEstimateAmount: prepared.unitEstimateAmount,
        });
        if (!lineId) {
          throw new QuoteListCommandRejected(
            "Catalog or configuration reference data changed while the assembly was being added. Review it and try again.",
            "CONFIGURATION_INVALID",
          );
        }
      } catch (error) {
        if (error instanceof QuoteListCommandRejected) throw error;
        translateQuantityConstraint(error);
      }
      return { setCookie: await cookie(session, current.date) };
    },

    async configuredAssemblyDraft(request: Request, lineId: string) {
      const session = await existingSession(request);
      if (!session) {
        throw new QuoteListCommandRejected(
          "That configured assembly is not available in this Quote List.",
          "LINE_NOT_FOUND",
        );
      }
      const current = time();
      const touched = await quoteList.touchSession(
        session.id,
        current.now,
        current.expiresAt,
      );
      if (!touched) {
        throw new QuoteListCommandRejected(
          "That configured assembly is not available in this Quote List.",
          "LINE_NOT_FOUND",
        );
      }
      const storedLine = await quoteList.findDetailedLine(session.id, lineId);
      if (!storedLine || storedLine.lineKind !== "configured_assembly") {
        throw new QuoteListCommandRejected(
          "That configured assembly is not available in this Quote List.",
          "LINE_NOT_FOUND",
        );
      }
      const [line] = await refreshLinesForDisplay([storedLine], current.now);
      if (!line || line.lineKind !== "configured_assembly") {
        throw new QuoteListCommandRejected(
          "That configured assembly is not available in this Quote List.",
          "LINE_NOT_FOUND",
        );
      }
      return {
        line,
        setCookie: await cookie(session, current.date),
      };
    },

    async replaceConfiguredAssembly(
      request: Request,
      lineId: string,
      draft: unknown,
      quantity: number,
    ) {
      const session = await existingSession(request);
      if (!session) {
        throw new QuoteListCommandRejected(
          "The assembly being edited no longer exists.",
          "LINE_NOT_FOUND",
        );
      }
      const source = await quoteList.findLine(session.id, lineId);
      if (!source || source.lineKind !== "configured_assembly") {
        throw new QuoteListCommandRejected(
          "The assembly being edited no longer exists.",
          "LINE_NOT_FOUND",
        );
      }
      const prepared = await prepareConfiguredAssembly({
        database: env.DB,
        draft,
        quantity,
      });
      const current = time();
      try {
        const replacementId = await quoteList.replaceConfiguredAssemblyLine({
          estimateBasis: prepared.estimateBasis,
          expiresAt: current.expiresAt,
          lineId,
          lineIdentity: prepared.lineIdentity,
          newLineId: generateId(),
          now: current.now,
          product: prepared.hoseProduct,
          quantity: prepared.quantity,
          sessionId: session.id,
          snapshot: prepared.snapshot,
          unitEstimateAmount: prepared.unitEstimateAmount,
        });
        if (!replacementId) {
          throw new QuoteListCommandRejected(
            "The catalog changed while this assembly was being saved. The original Quote List line was not changed.",
            "CONFIGURATION_INVALID",
          );
        }
      } catch (error) {
        if (error instanceof QuoteListCommandRejected) throw error;
        translateQuantityConstraint(error);
      }
      return { setCookie: await cookie(session, current.date) };
    },

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
      return { setCookie: await cookie(session, current.date) };
    },

    async addLengthBasedHose(
      request: Request,
      sku: string,
      order: LengthBasedHoseOrder,
    ) {
      const product = await requireLengthBasedHose(sku);
      const ordering = product.offer!.lengthOrdering!;
      const currentOrder = parseLengthBasedHoseOrder(
        {
          lengthPerPiece: String(order.originalLengthValue),
          lengthUnit: order.originalLengthUnit,
          pieceCount: String(order.pieceCount),
        },
        ordering,
      );
      if (!currentOrder.ok) {
        throw new QuoteListCommandRejected(
          "Length ordering requirements changed. Review the current hose requirements and try again.",
          "PRODUCT_NOT_AVAILABLE",
        );
      }
      const estimate = calculateLengthBasedHoseEstimate({
        feeRatePerPiece: ordering.cuttingLabelingFee.ratePerPiece,
        order: currentOrder.value,
        referencePricePerFoot: product.offer!.referencePrice,
      });
      const { session } = await ensureSession(request);
      const current = time();
      try {
        const lineId = await quoteList.addLengthBasedHoseLine({
          estimate,
          expiresAt: current.expiresAt,
          lineId: generateId(),
          now: current.now,
          order: currentOrder.value,
          product,
          sessionId: session.id,
        });
        if (!lineId) throw await lengthCatalogChanged(sku);
      } catch (error) {
        if (error instanceof QuoteListCommandRejected) throw error;
        translateQuantityConstraint(error);
      }
      return { setCookie: await cookie(session, current.date) };
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
        lines: await refreshLinesForDisplay(
          await quoteList.listLines(session.id),
          current.now,
        ),
        setCookie: await cookie(session, current.date),
      };
    },

    async remove(request: Request, lineId: string) {
      const { created, session } = await ensureSession(request);
      const current = time();
      if (created) {
        return { setCookie: await cookie(session, current.date) };
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
      return { setCookie: await cookie(session, current.date) };
    },

    async update(request: Request, lineId: string, quantity: number) {
      const { created, session } = await ensureSession(request);
      const current = time();
      if (created) {
        return { setCookie: await cookie(session, current.date) };
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
      return { setCookie: await cookie(session, current.date) };
    },

    async updateConfiguredAssemblyQuantity(
      request: Request,
      lineId: string,
      quantity: number,
    ) {
      const { created, session } = await ensureSession(request);
      const current = time();
      if (created) {
        throw new QuoteListCommandRejected(
          "That configured assembly no longer exists.",
          "LINE_NOT_FOUND",
        );
      }
      try {
        const updated = await quoteList.updateConfiguredAssemblyQuantity({
          expiresAt: current.expiresAt,
          lineId,
          now: current.now,
          quantity,
          sessionId: session.id,
        });
        if (!updated) {
          throw new QuoteListCommandRejected(
            "That configured assembly no longer exists.",
            "LINE_NOT_FOUND",
          );
        }
      } catch (error) {
        if (error instanceof QuoteListCommandRejected) throw error;
        translateQuantityConstraint(error);
      }
      return { setCookie: await cookie(session, current.date) };
    },

    async updateLengthBasedHose(
      request: Request,
      lineId: string,
      pieceCount: number,
    ) {
      const { created, session } = await ensureSession(request);
      const current = time();
      if (created) {
        return { setCookie: await cookie(session, current.date) };
      }
      const line = await quoteList.findLine(session.id, lineId);
      if (
        !line ||
        line.lineKind !== "length_based_hose" ||
        line.normalizedLengthFt === null
      ) {
        throw new QuoteListCommandRejected(
          "That cut-hose line no longer exists.",
          "LINE_NOT_FOUND",
        );
      }
      const product = await requireLengthBasedHose(line.sku);
      const order: LengthBasedHoseOrder = {
        normalizedLengthFt: line.normalizedLengthFt,
        originalLengthUnit: "ft",
        originalLengthValue: line.normalizedLengthFt,
        pieceCount,
        totalFootage: line.normalizedLengthFt * pieceCount,
      };
      const ordering = product.offer!.lengthOrdering!;
      const estimate = calculateLengthBasedHoseEstimate({
        feeRatePerPiece: ordering.cuttingLabelingFee.ratePerPiece,
        order,
        referencePricePerFoot: product.offer!.referencePrice,
      });
      try {
        const updated = await quoteList.updateLengthBasedHoseLine({
          estimate,
          expiresAt: current.expiresAt,
          lineId,
          now: current.now,
          order,
          product,
          sessionId: session.id,
        });
        if (!updated) throw await lengthCatalogChanged(line.sku);
      } catch (error) {
        if (error instanceof QuoteListCommandRejected) throw error;
        translateQuantityConstraint(error);
      }
      return { setCookie: await cookie(session, current.date) };
    },
  };
}
