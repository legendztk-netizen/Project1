import { describe, expect, it } from "vitest";
import {
  validatePiAcceptance,
  type PiAcceptanceContext,
  type PiAcceptanceInput,
} from "../app/modules/proforma-invoice/domain/pi-acceptance";

// Only the snapshot fields consumed by acceptance are needed for this fixture.
function fixture() {
  const target = {
    piId: "pi-1",
    documentVersion: 2,
    snapshotHash: "a".repeat(64),
  };
  const customer = {
    profileId: "customer-1",
    purchasingContextId: "context-1",
  };
  const context: PiAcceptanceContext = {
    pi: {
      ...target,
      snapshot: {
        schemaVersion: 1,
        documentVersion: 2,
        issuedAt: "2026-09-14T10:00:00.000Z",
        validUntil: "2026-09-28T10:00:00.000Z",
        quoteRevision: { id: "revision-2", requestId: "rfq-1" },
        lines: [
          { id: "standard", madeToOrder: false },
          { id: "custom-a", madeToOrder: true },
          { id: "custom-b", madeToOrder: true },
        ],
        conditions: {
          generalAcknowledgement: {
            version: "general-v3",
            text: "TEST general text from issued PI.",
          },
          cancellation: {
            version: "cancel-v2",
            text: "TEST cancellation text from issued PI.",
          },
          refund: {
            version: "refund-v4",
            text: "TEST refund text from issued PI.",
          },
          madeToOrderAcknowledgements: [
            {
              lineId: "custom-a",
              version: "custom-v2",
              text: "TEST specifications and cancellation for A.",
            },
            {
              lineId: "custom-b",
              version: "custom-v2",
              text: "TEST specifications and cancellation for B.",
            },
          ],
        },
      },
    },
    customer,
    customerAuthorized: true,
    currentPiId: target.piId,
    currentQuoteRevisionId: "revision-2",
    superseded: false,
    alreadyAccepted: false,
    now: "2026-09-15T12:00:00.000Z",
    requestEvidence: {
      requestId: "request-1",
      ipAddress: null,
      userAgent: null,
    },
    source: {
      source: "website",
      customer: { ...customer, verified: true },
      viewing: {
        ...target,
        ...customer,
        id: "view-1",
        kind: "download",
        successful: true,
        occurredAt: "2026-09-15T11:00:00.000Z",
      },
    },
  };
  const input: PiAcceptanceInput = {
    ...target,
    legalName: "  Test Buyer LLC  ",
    acknowledgements: {
      general: { version: "general-v3", confirmed: true },
      madeToOrder: [
        {
          lineIds: ["custom-b", "custom-a"],
          version: "custom-v2",
          cancellationVersion: "cancel-v2",
          specificationsConfirmed: true,
          cancellationConfirmed: true,
        },
      ],
    },
  };
  return { context, input };
}

function emailFixture() {
  const result = fixture();
  const viewing =
    result.context.source.source === "website"
      ? result.context.source.viewing
      : null;
  result.context.source = {
    source: "email",
    admin: {
      id: "admin-1",
      accountType: "subaccount",
      canManageSubaccounts: false,
      email: "admin@example.com",
      source: "cloudflare-access",
    },
    explicitlyConfirmed: true,
    evidence: {
      ...viewing!,
      sourceMessageId: "message-1",
      acknowledgementEvidenceId: "private-evidence-1",
    },
  };
  return result;
}

describe("pure PI acceptance rules", () => {
  it("records exact PI and policy source evidence without inventing metadata or side effects", () => {
    const { context, input } = fixture();
    const before = structuredClone({ context, input });
    const result = validatePiAcceptance(context, input);
    expect(result).toMatchObject({
      piId: "pi-1",
      snapshotHash: "a".repeat(64),
      documentVersion: 2,
      quoteRevisionId: "revision-2",
      requestId: "rfq-1",
      legalName: "Test Buyer LLC",
      acceptedAt: context.now,
      customer: context.customer,
      policySource: {
        piId: "pi-1",
        documentVersion: 2,
        snapshotHash: "a".repeat(64),
        schemaVersion: 1,
      },
      requestEvidence: {
        requestId: "request-1",
        ipAddress: null,
        userAgent: null,
      },
      evidence: { source: "website", id: "view-1", kind: "download" },
    });
    expect(result.acknowledgements.general.text).toBe(
      context.pi.snapshot.conditions.generalAcknowledgement.text,
    );
    expect(result.conditions).toEqual({
      cancellation: context.pi.snapshot.conditions.cancellation,
      refund: context.pi.snapshot.conditions.refund,
    });
    expect(
      result.acknowledgements.madeToOrder.map((ack) => ack.lineId),
    ).toEqual(["custom-a", "custom-b"]);
    expect(Object.isFrozen(result.acknowledgements.madeToOrder[0])).toBe(true);
    expect({ context, input }).toEqual(before);
    expect(Object.isFrozen(input)).toBe(false);
    expect(validatePiAcceptance(context, input)).toEqual(result);
    expect(Object.keys(result)).not.toContain("order");
    expect(Object.keys(result)).not.toContain("payment");
  });

  const guards: Array<
    [string, (context: PiAcceptanceContext, input: PiAcceptanceInput) => void]
  > = [
    [
      "wrong PI id",
      (_, i) => {
        i.piId = "pi-other";
      },
    ],
    [
      "wrong hash",
      (_, i) => {
        i.snapshotHash = "b".repeat(64);
      },
    ],
    [
      "invalid hash",
      (_, i) => {
        i.snapshotHash = "";
      },
    ],
    [
      "wrong document version",
      (_, i) => {
        i.documentVersion++;
      },
    ],
    [
      "invalid version",
      (_, i) => {
        i.documentVersion = NaN;
      },
    ],
    [
      "replacement PI",
      (c) => {
        c.currentPiId = "pi-new";
      },
    ],
    [
      "stale quote revision",
      (c) => {
        c.currentQuoteRevisionId = "revision-new";
      },
    ],
    [
      "superseded",
      (c) => {
        c.superseded = true;
      },
    ],
    [
      "existing acceptance",
      (c) => {
        c.alreadyAccepted = true;
      },
    ],
    [
      "wrong owner",
      (c) => {
        c.customerAuthorized = false;
      },
    ],
    [
      "expiry boundary",
      (c) => {
        c.now = c.pi.snapshot.validUntil;
      },
    ],
    [
      "expired",
      (c) => {
        c.now = "2026-09-29T00:00:00.000Z";
      },
    ],
    [
      "before issuance",
      (c) => {
        c.now = "2026-09-13T00:00:00.000Z";
      },
    ],
    [
      "local timestamp",
      (c) => {
        c.now = "2026-09-15T12:00:00";
      },
    ],
    [
      "missing legal name",
      (_, i) => {
        i.legalName = " ";
      },
    ],
    [
      "oversized legal name",
      (_, i) => {
        i.legalName = "a".repeat(301);
      },
    ],
    [
      "control in legal name",
      (_, i) => {
        i.legalName = "Buyer\nOther";
      },
    ],
    [
      "general not confirmed",
      (_, i) => {
        i.acknowledgements.general.confirmed = false;
      },
    ],
    [
      "stale general",
      (_, i) => {
        i.acknowledgements.general.version = "old";
      },
    ],
    [
      "missing custom lines",
      (_, i) => {
        i.acknowledgements.madeToOrder = [];
      },
    ],
    [
      "missing one line",
      (_, i) => {
        i.acknowledgements.madeToOrder[0].lineIds = ["custom-a"];
      },
    ],
    [
      "foreign line",
      (_, i) => {
        i.acknowledgements.madeToOrder[0].lineIds[0] = "foreign";
      },
    ],
    [
      "duplicate line",
      (_, i) => {
        i.acknowledgements.madeToOrder[0].lineIds = ["custom-a", "custom-a"];
      },
    ],
    [
      "standard line acknowledged as custom",
      (_, i) => {
        i.acknowledgements.madeToOrder[0].lineIds[0] = "standard";
      },
    ],
    [
      "empty group",
      (_, i) => {
        i.acknowledgements.madeToOrder[0].lineIds = [];
      },
    ],
    [
      "specifications unconfirmed",
      (_, i) => {
        i.acknowledgements.madeToOrder[0].specificationsConfirmed = false;
      },
    ],
    [
      "cancellation unconfirmed",
      (_, i) => {
        i.acknowledgements.madeToOrder[0].cancellationConfirmed = false;
      },
    ],
    [
      "stale line policy",
      (_, i) => {
        i.acknowledgements.madeToOrder[0].version = "old";
      },
    ],
    [
      "stale cancellation",
      (_, i) => {
        i.acknowledgements.madeToOrder[0].cancellationVersion = "old";
      },
    ],
    [
      "missing request evidence",
      (c) => {
        c.requestEvidence.requestId = "";
      },
    ],
    [
      "oversized request metadata",
      (c) => {
        c.requestEvidence.userAgent = "x".repeat(4097);
      },
    ],
  ];
  it.each(guards)("rejects %s for either source", (_, change) => {
    for (const make of [fixture, emailFixture]) {
      const { context, input } = make();
      change(context, input);
      expect(() => validatePiAcceptance(context, input)).toThrow();
    }
  });

  it("accepts individually acknowledged custom lines and preserves real request metadata", () => {
    const { context, input } = fixture();
    const group = input.acknowledgements.madeToOrder[0];
    input.acknowledgements.madeToOrder = group.lineIds.map((id) => ({
      ...group,
      lineIds: [id],
    }));
    context.requestEvidence.ipAddress = "192.0.2.1";
    context.requestEvidence.userAgent = "Test agent/1";
    const result = validatePiAcceptance(context, input);
    expect(result.requestEvidence).toEqual(context.requestEvidence);
    expect(result.acknowledgements.madeToOrder).toHaveLength(2);
  });

  it("requires no custom acknowledgement for a standard-only PI", () => {
    const { context, input } = fixture();
    context.pi.snapshot = {
      ...context.pi.snapshot,
      lines: context.pi.snapshot.lines.filter((line) => !line.madeToOrder),
      conditions: {
        ...context.pi.snapshot.conditions,
        madeToOrderAcknowledgements: [],
      },
    };
    input.acknowledgements.madeToOrder = [];
    expect(
      validatePiAcceptance(context, input).acknowledgements.madeToOrder,
    ).toEqual([]);
  });

  it("rejects inconsistent issued policy coverage and missing source text", () => {
    for (const conditions of [
      {
        ...fixture().context.pi.snapshot.conditions,
        madeToOrderAcknowledgements: [],
      },
      {
        ...fixture().context.pi.snapshot.conditions,
        generalAcknowledgement: { version: "general-v3", text: "" },
      },
    ]) {
      const { context, input } = fixture();
      context.pi.snapshot = { ...context.pi.snapshot, conditions };
      expect(() => validatePiAcceptance(context, input)).toThrow();
    }
  });

  it("requires successful, exact, owned and timely website viewing evidence", () => {
    const changes: Array<
      (
        source: Extract<PiAcceptanceContext["source"], { source: "website" }>,
      ) => void
    > = [
      (s) => {
        s.customer.verified = false;
      },
      (s) => {
        s.customer.profileId = "other";
      },
      (s) => {
        s.customer.purchasingContextId = "other";
      },
      (s) => {
        s.viewing.successful = false;
      },
      (s) => {
        s.viewing.piId = "old";
      },
      (s) => {
        s.viewing.snapshotHash = "b".repeat(64);
      },
      (s) => {
        s.viewing.documentVersion = 1;
      },
      (s) => {
        s.viewing.profileId = "other";
      },
      (s) => {
        s.viewing.purchasingContextId = "other";
      },
      (s) => {
        s.viewing.id = "";
      },
      (s) => {
        s.viewing.occurredAt = "2026-09-13T00:00:00.000Z";
      },
      (s) => {
        s.viewing.occurredAt = "2026-09-16T00:00:00.000Z";
      },
    ];
    for (const change of changes) {
      const { context, input } = fixture();
      if (context.source.source !== "website") throw new Error("Fixture");
      change(context.source);
      expect(() => validatePiAcceptance(context, input)).toThrow();
    }
  });

  it("records email acceptance with distinct Admin and customer evidence, not fabricated viewing", () => {
    const { context, input } = emailFixture();
    expect(validatePiAcceptance(context, input).evidence).toEqual({
      source: "email",
      id: "view-1",
      occurredAt: "2026-09-15T11:00:00.000Z",
      actingAdminId: "admin-1",
      sourceMessageId: "message-1",
      acknowledgementEvidenceId: "private-evidence-1",
      explicitlyConfirmed: true,
    });
  });

  it("fails closed for unauthorized, incomplete or mismatched email evidence", () => {
    const changes: Array<
      (
        source: Extract<PiAcceptanceContext["source"], { source: "email" }>,
      ) => void
    > = [
      (s) => {
        s.admin.id = "";
      },
      (s) => {
        s.admin.accountType = "factory" as never;
      },
      (s) => {
        s.explicitlyConfirmed = false;
      },
      (s) => {
        s.evidence.sourceMessageId = "";
      },
      (s) => {
        s.evidence.acknowledgementEvidenceId = "";
      },
      (s) => {
        s.evidence.profileId = "other";
      },
      (s) => {
        s.evidence.purchasingContextId = "other";
      },
      (s) => {
        s.evidence.piId = "other";
      },
      (s) => {
        s.evidence.snapshotHash = "b".repeat(64);
      },
      (s) => {
        s.evidence.documentVersion = 1;
      },
      (s) => {
        s.evidence.occurredAt = "2026-09-16T00:00:00.000Z";
      },
    ];
    for (const change of changes) {
      const { context, input } = emailFixture();
      if (context.source.source !== "email") throw new Error("Fixture");
      change(context.source);
      expect(() => validatePiAcceptance(context, input)).toThrow();
    }
  });
});
