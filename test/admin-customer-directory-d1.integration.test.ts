import { afterAll, beforeAll, expect, it } from "vitest";

import { createCustomerIdentityService } from "../app/modules/customer-identity/application/customer-identity-service";
import { customerDirectoryFilters } from "../app/modules/customer-identity/domain/customer-directory";
import { createD1AdminCustomerDirectory } from "../app/modules/customer-identity/infrastructure/d1-admin-customer-directory";
import { createD1QuoteRequestRepository } from "../app/modules/quote-request/infrastructure/d1-quote-request-repository";
import {
  fixtureClock,
  seedAfterSalesOrder,
  shipShipment,
  startAfterSalesDatabase,
  type SeededOrder,
} from "./fixtures/after-sales-order";

let db: D1Database;
let dispose: () => Promise<void>;
let processing: SeededOrder;
let delivered: SeededOrder;
let cancelled: SeededOrder;

const all = { orders: true, quotes: true };
const filters = (params: Record<string, string> = {}) =>
  customerDirectoryFilters(new URLSearchParams(params));

beforeAll(async () => {
  const started = await startAfterSalesDatabase("customer-directory");
  db = started.db;
  dispose = started.dispose;
  processing = await seedAfterSalesOrder(db, "cd1");
  delivered = await seedAfterSalesOrder(db, "cd2");
  for (const shipmentId of Object.values(delivered.shipments))
    await shipShipment(db, delivered.orderId, shipmentId, {
      handoffAt: "2026-09-25T02:00:00.000Z",
      deliveredDate: "2026-09-28",
    });
  cancelled = await seedAfterSalesOrder(db, "cd3");
  const now = fixtureClock;
  await db.batch([
    // A real full cancellation needs both the customer and the exceptional
    // Admin flows; the directory only reads the cancelled quantities they leave.
    db.prepare("DROP TRIGGER order_cancelled_quantity_guard"),
    db
      .prepare(
        `INSERT INTO order_cancellation_requests
           (id,order_id,kind,origin,status,actor_id,reason,
            submission_command_id,submission_hash,created_at,updated_at)
         VALUES ('cd3-cancel',?1,'exceptional','support','resolved','test',
           'Cancelled','cd3-cancel-command','hash',?2,?2)`,
      )
      .bind(cancelled.orderId, now),
    db
      .prepare(
        `INSERT INTO order_cancellation_resolutions
           (id,request_id,order_id,outcome,customer_reason,lines_json,
            financial_json,actor_id,decided_at,command_id,command_hash)
         VALUES ('cd3-resolution','cd3-cancel',?1,'approved','Cancelled','[]',
           '{}','test',?2,'cd3-resolution-command','hash')`,
      )
      .bind(cancelled.orderId, now),
    db
      .prepare(
        `INSERT INTO order_cancelled_quantities
           (resolution_id,order_id,line_id,shipment_id,physical_quantity)
         SELECT 'cd3-resolution',order_id,line_id,NULL,
           CASE WHEN line_kind='length_based_hose'
             THEN json_extract(snapshot_json,'$.lengthOrder.pieceCount')
             ELSE json_extract(snapshot_json,'$.quantity') END
         FROM confirmed_order_lines WHERE order_id=?1`,
      )
      .bind(cancelled.orderId),
    db
      .prepare(
        `INSERT INTO customer_organizations
           (id,legal_name,trade_name,country_code,registration_or_tax_id,
            created_at,updated_at)
         VALUES ('acme','Acme Hydraulics LLC','Acme','CA','BN-123',?1,?1)`,
      )
      .bind(now),
    db
      .prepare(
        `INSERT INTO customer_organization_memberships
           (id,organization_id,profile_id,role,status,created_at)
         VALUES ('acme-buyer','acme','buyer','primary_contact','active',?1)`,
      )
      .bind(now),
    db
      .prepare(
        `INSERT INTO customer_purchasing_contexts
           (id,kind,organization_id,created_at,updated_at)
         VALUES ('acme-context','organization','acme',?1,?1)`,
      )
      .bind(now),
    db
      .prepare(
        `INSERT INTO customer_profile_purchasing_context_access
           (profile_id,context_id,created_at)
         VALUES ('buyer','acme-context',?1)`,
      )
      .bind(now),
    db
      .prepare(
        `INSERT INTO customer_quote_requests
           (id,reference_number,profile_id,purchasing_context_id,
            source_session_id,source_session_version,source_address_id,
            purchasing_context_kind,fulfillment_term,currency,
            merchandise_subtotal,service_fee_total,idempotency_key,
            snapshot_json,submitted_at)
         VALUES ('acme-rfq','RFQ-ACME-1','buyer','acme-context','acme-session',
           '1','acme-address','organization','DDP','USD',100,0,'acme-rfq-key',
           '{}',?1)`,
      )
      .bind(now),
    db.prepare(
      `INSERT INTO customer_profiles
         (id,email_normalized,email_display,email_verified_at,created_at,updated_at)
       VALUES ('early','early@example.test','early@example.test',
         '2026-08-01T03:00:00.000Z','2026-08-01T03:00:00.000Z',
         '2026-08-01T03:00:00.000Z')`,
    ),
    db
      .prepare(
        `INSERT INTO customer_delivery_addresses
           (id,profile_id,label,recipient_name,recipient_email,recipient_phone,
            country_code,state_province,city,postal_code,address_line_1,
            created_at,updated_at)
         VALUES ('other-address','other','Shop','Pat Lee','other@example.test',
           '+1 555 0100','US','TX','Houston','77002','1 Main St',?1,?1)`,
      )
      .bind(now),
  ]);
}, 180_000);

afterAll(async () => {
  await dispose?.();
});

const directory = () => createD1AdminCustomerDirectory(db);

it("counts the RFQs each customer sees in the Personal Center, including organization RFQs", async () => {
  const { records } = await directory().list(filters(), all);
  const ownedByBuyer =
    await createD1QuoteRequestRepository(db).listOwned("buyer");
  expect(ownedByBuyer).toHaveLength(4);
  expect(records.find((record) => record.id === "buyer")).toMatchObject({
    organizationName: "Acme Hydraulics LLC",
    countryCode: "CA",
    quoteCount: ownedByBuyer.length,
  });
  expect(records.find((record) => record.id === "other")).toMatchObject({
    organizationName: null,
    countryCode: "US",
    quoteCount: 0,
    confirmedCents: 0,
  });
});

it("totals confirmed Orders without the fully cancelled one", async () => {
  const { records } = await directory().list(filters(), all);
  expect(records.find((record) => record.id === "buyer")?.confirmedCents).toBe(
    processing.totalCents + delivered.totalCents,
  );
});

it("splits current Orders from delivered and fully cancelled history", async () => {
  const customer = await directory().read("buyer", all);
  expect(customer?.currentOrders?.map((order) => order.id)).toEqual([
    processing.orderId,
  ]);
  expect(customer?.historicalOrders?.map((order) => order.id).sort()).toEqual(
    [cancelled.orderId, delivered.orderId].sort(),
  );
  expect(
    customer?.historicalOrders?.find((order) => order.id === cancelled.orderId),
  ).toMatchObject({ fullyCancelled: true });
  expect(
    customer?.historicalOrders?.find((order) => order.id === delivered.orderId),
  ).toMatchObject({ fullyCancelled: false, stage: "delivered" });
  expect(customer?.quotes?.map((quote) => quote.referenceNumber)).toContain(
    "RFQ-ACME-1",
  );
  expect(customer?.organizations).toEqual([
    expect.objectContaining({
      legalName: "Acme Hydraulics LLC",
      primaryContact: true,
      active: true,
    }),
  ]);
});

it("leaves out RFQs and Orders when the admin may not open those modules", async () => {
  const none = { orders: false, quotes: false };
  const { records } = await directory().list(filters(), none);
  expect(records.find((record) => record.id === "buyer")).toMatchObject({
    quoteCount: null,
    confirmedCents: null,
  });
  expect(await directory().read("buyer", none)).toMatchObject({
    quotes: null,
    currentOrders: null,
    historicalOrders: null,
  });
});

it("searches by email, name, phone and company name", async () => {
  const ids = async (query: string) =>
    (await directory().list(filters({ q: query }), all)).records.map(
      (record) => record.id,
    );
  expect(await ids("ACME")).toEqual(["buyer"]);
  expect(await ids("other@")).toEqual(["other"]);
  expect(await ids("no-such-customer")).toEqual([]);
  expect(await directory().read("missing", all)).toBeNull();
});

it("filters by registration date, type, country and Orders, and sorts by registration date", async () => {
  const ids = async (params: Record<string, string>) =>
    (await directory().list(filters(params), all)).records.map(
      (record) => record.id,
    );
  expect(await ids({})).toEqual(["other", "buyer", "early"]);
  expect(await ids({ sort: "registered_asc" })).toEqual([
    "early",
    "buyer",
    "other",
  ]);
  // 2026-08-01T03:00Z is Aug 1 in Beijing; the fixture customers registered Sep 24.
  expect(await ids({ to: "2026-08-01" })).toEqual(["early"]);
  expect(await ids({ from: "2026-08-02", to: "2026-09-24" })).toEqual([
    "other",
    "buyer",
  ]);
  expect(await ids({ type: "organization" })).toEqual(["buyer"]);
  expect(await ids({ type: "individual" })).toEqual(["other", "early"]);
  expect(await ids({ country: "us" })).toEqual(["other"]);
  expect(await ids({ country: "CA", type: "organization" })).toEqual(["buyer"]);
  expect(await ids({ orders: "with" })).toEqual(["buyer"]);
  expect(await ids({ orders: "without" })).toEqual(["other", "early"]);
  const listed = await directory().list(filters(), all);
  expect(listed.countries).toEqual(["CA", "US"]);
  expect(listed.total).toBe(3);
  // Without the Orders grant the Order filter is ignored rather than applied.
  expect(
    (
      await directory().list(filters({ orders: "with" }), {
        orders: false,
        quotes: true,
      })
    ).total,
  ).toBe(3);
});

it("keeps the registration IP and replaces only the last sign-in on later sign-ins", async () => {
  let clock = new Date("2026-10-18T01:00:00.000Z");
  const service = createCustomerIdentityService(
    {
      APP_ENV: "production",
      DB: db,
      PRODUCTION_SESSION_SIGNING_KEY: "test-only-session-signing-key",
    } as never,
    { deliver: async () => undefined, now: () => clock, otp: () => "123456" },
  );
  const from = (ip: string) =>
    new Request("https://customhoseco.com/register", {
      headers: { "cf-connecting-ip": ip },
    });
  const challenge = await service.requestOtp({
    email: "new.buyer@example.test",
    purpose: "register",
    request: from("203.0.113.7"),
  });
  const registered = await service.verifyOtp({
    challengeId: challenge.challengeId,
    code: "123456",
    location: { country: "us", region: "Texas", city: "Houston" },
    purpose: "register",
    request: from("203.0.113.7"),
  });
  const profileId = registered.profile.id;
  const read = () => directory().read(profileId, all);
  expect(await read()).toMatchObject({
    registration: {
      ip: "203.0.113.7",
      location: { country: "US", region: "Texas", city: "Houston" },
    },
    lastSignIn: {
      at: clock.toISOString(),
      method: "email_code",
      ip: "203.0.113.7",
    },
  });

  clock = new Date("2026-10-18T03:00:00.000Z");
  const signIn = await service.requestOtp({
    email: "new.buyer@example.test",
    purpose: "sign_in",
    request: from("198.51.100.20"),
  });
  await service.verifyOtp({
    challengeId: signIn.challengeId,
    code: "123456",
    location: { country: "CA", region: "Ontario", city: "Toronto" },
    purpose: "sign_in",
    request: from("198.51.100.20"),
  });
  expect(await read()).toMatchObject({
    registration: {
      ip: "203.0.113.7",
      location: { country: "US", region: "Texas", city: "Houston" },
    },
    lastSignIn: {
      at: "2026-10-18T03:00:00.000Z",
      method: "email_code",
      ip: "198.51.100.20",
      location: { country: "CA", region: "Ontario", city: "Toronto" },
    },
  });
  const { records } = await directory().list(filters({ q: "new.buyer" }), all);
  expect(records).toEqual([
    expect.objectContaining({
      id: profileId,
      lastSignInAt: "2026-10-18T03:00:00.000Z",
    }),
  ]);
}, 60_000);
