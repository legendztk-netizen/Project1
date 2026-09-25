import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  address,
  buyerId,
  formFromHtml,
  privateNote,
  requestId,
  startPiFlowServer,
  issueTestPi,
  issuePiFlowQuote,
  savePiFlowTerms,
  type PiFlowInvoiceRow,
} from "../fixtures/pi-flow-server";

type Server = Awaited<ReturnType<typeof startPiFlowServer>>;
type InvoiceRow = PiFlowInvoiceRow;
const admin = `/admin/quotes/${requestId}`;
const customer = `/account/quotes/${requestId}`;
const myQuotes = "/account?view=my-quotes";
let server: Server;
let stopServer: (() => Promise<void>) | undefined;
let buyerCookie: string;
let otherCookie: string;
let pi: InvoiceRow;
let originalPdf: Uint8Array;
let acceptanceForm: FormData;

const copyForm = (source: FormData) => {
  const result = new FormData();
  for (const [key, value] of source) result.append(key, value);
  return result;
};
const fields = (values: Record<string, string>) => {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
};
async function html(path: string, cookie = "") {
  const response = await server.request(path, { headers: { cookie } });
  const content = await response.text();
  expect(response.status, `${path}\n${content.slice(0, 3000)}`).toBe(200);
  return content;
}
async function post(path: string, form: FormData, cookie = "", status = 302) {
  const response = await server.post(path, form, cookie);
  expect(
    response.status,
    `${path}\n${(await response.text()).slice(0, 3000)}`,
  ).toBe(status);
}
function privateBoundary(content: string) {
  for (const secret of [
    privateNote,
    "pdf_object_key",
    ...(pi ? [pi.pdf_object_key] : []),
  ])
    expect(content, `Customer boundary leaked ${secret}`).not.toContain(secret);
}
async function drain(replay = false) {
  if (!replay) await scheduled();
  const response = await server.post(
    `/__test/pi/queue${replay ? "?replay=1" : ""}`,
    new FormData(),
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const result = (await response.json()) as {
    delivered: number;
    acknowledged: number;
    retries: number;
  };
  expect(result.retries).toBe(0);
  expect(result.acknowledged).toBe(result.delivered);
  return result;
}
async function scheduled() {
  const response = await server.post("/__test/pi/scheduled", new FormData());
  expect(response.status, await response.clone().text()).toBe(200);
  expect(await response.json()).toMatchObject({ scheduled: true });
}
async function invoice() {
  const rows = await server.query<InvoiceRow>(
    `SELECT p.* FROM proforma_invoices p JOIN proforma_invoice_heads h ON h.pi_id=p.id WHERE h.request_id='${requestId}'`,
  );
  expect(rows).toHaveLength(1);
  return rows[0];
}
async function quoteRevisionRows() {
  return await server.query<{
    id: string;
    revision_number: number;
    snapshot_json: string;
    snapshot_hash: string;
  }>(
    `SELECT id,revision_number,snapshot_json,snapshot_hash FROM quote_revisions WHERE request_id='${requestId}' ORDER BY revision_number`,
  );
}
async function unchangedQuoteRevisions(
  expected: Awaited<ReturnType<typeof quoteRevisionRows>>,
) {
  const actual = await quoteRevisionRows();
  expect(actual).toEqual(expected);
  for (const row of actual)
    expect(createHash("sha256").update(row.snapshot_json).digest("hex")).toBe(
      row.snapshot_hash,
    );
}
async function saveTerms(freight = "20.00", transport = "Air freight") {
  await savePiFlowTerms(server, freight, transport);
}
async function issueQuote(changeReason = "") {
  await issuePiFlowQuote(server, changeReason);
}
async function acceptancePage() {
  const response = await server.request(`${customer}/pi/${pi.id}/accept`, {
    headers: { cookie: buyerCookie },
  });
  const content = await response.text();
  expect(
    response.status,
    "Requires final local build with #60 acceptance route; do not rebuild while other verification runs",
  ).toBe(200);
  privateBoundary(content);
  return content;
}
function confirm(form: FormData) {
  form.set("legalName", "TEST Buyer");
  form.set("generalConfirmed", "on");
  const policies = JSON.parse(String(form.get("linePolicies"))) as unknown[];
  expect(policies).toHaveLength(1);
  policies.forEach((_, index) => {
    form.set(`specifications-${index}`, "on");
    form.set(`cancellation-${index}`, "on");
  });
  return form;
}

async function startNextQuote() {
  const form = formFromHtml(await html(`${admin}/revisions`), "start");
  await post(`${admin}/revisions`, form);
}

async function replacementForm(code: string, customerRequested: boolean) {
  // The interactive form assembles its command in React state. Read its real
  // persisted review tokens without synthesizing revisions or lifecycle rows.
  const form = formFromHtml(await html(`${admin}/pi/lifecycle`), "replace");
  const revision = (
    await server.query<{ id: string; snapshot_hash: string }>(
      `SELECT id,snapshot_hash FROM quote_revisions WHERE request_id='${requestId}' ORDER BY revision_number DESC LIMIT 1`,
    )
  )[0];
  const head = (
    await server.query<{ version: number }>(
      `SELECT version FROM proforma_invoice_heads WHERE request_id='${requestId}'`,
    )
  )[0];
  const acceptance = (
    await server.query<{ id: string }>(
      `SELECT id FROM pi_acceptances WHERE pi_id='${pi.id}'`,
    )
  )[0];
  const seller = (
    await server.query<{ id: string; version: number }>(
      "SELECT id,version FROM seller_identity_versions WHERE status='current'",
    )
  )[0];
  const payment = (
    await server.query<{ id: string; version: number }>(
      "SELECT id,version FROM seller_payment_instruction_versions WHERE status='current' AND channel='bank_transfer'",
    )
  )[0];
  const evidence = (
    await server.query<{ id: string }>(
      `SELECT id FROM quote_internal_notes WHERE request_id='${requestId}' ORDER BY created_at DESC LIMIT 1`,
    )
  )[0];
  form.set("reviewed", "on");
  form.set(
    "command",
    JSON.stringify({
      requestId,
      commandId: randomUUID(),
      quoteRevisionId: revision.id,
      quoteRevisionHash: revision.snapshot_hash,
      sellerIdentityId: seller.id,
      sellerVersion: seller.version,
      paymentChannel: "bank_transfer",
      paymentInstructionId: payment.id,
      paymentInstructionVersion: payment.version,
      replacement: {
        expectedPi: {
          piId: pi.id,
          documentVersion: pi.document_version,
          snapshotHash: pi.snapshot_hash,
        },
        expectedHeadVersion: head.version,
        expectedAcceptanceId: acceptance?.id ?? null,
        nextQuoteRevisionId: revision.id,
        reason: {
          code,
          customerRequested,
          customerDataAccurate: true,
          explanation: customerRequested
            ? "TEST buyer requested sea transport instead of air"
            : "TEST seller underestimated freight; buyer data and shipment unchanged",
          evidenceIds: [evidence.id],
        },
      },
    }),
  );
  return form;
}

// These ordered phases share one isolated RFQ, never any application service mock.
// Run the entire file after the integrated local build. A filtered #59-only run
// is useful while #60-62 are landing and is not full acceptance evidence.
describe.sequential("#63 built Worker RFQ-to-PI acceptance", () => {
  beforeAll(async () => {
    server = await startPiFlowServer({
      onCleanup: (stop) => {
        stopServer = stop;
      },
    });
    buyerCookie = await server.login(address.recipientEmail);
    otherCookie = await server.login("other@pi-flow.example.test");
  }, 180000);
  afterAll(async () => {
    await stopServer?.();
  }, 30000);

  it("issues through real HTTP review, pricing, quote, stub Queue and private R2 PDF", async () => {
    expect(await html(admin)).toContain(requestId);
    expect(await html(myQuotes, buyerCookie)).toContain("RFQ Submitted");
    pi = await issueTestPi(server, {
      afterPrices: async (stale) => {
        stale.set("price-0", "16.00");
        stale.set("discount-0", "0");
        stale.set(
          "reason",
          "TEST stale edit must not overwrite the newer draft",
        );
        await post(`${admin}/pricing`, stale, "", 409);
      },
      afterQuote: async () => {
        const revisions = await server.query<{ snapshot_json: string }>(
          `SELECT snapshot_json FROM quote_revisions WHERE request_id='${requestId}'`,
        );
        expect(revisions).toHaveLength(1);
        expect(JSON.parse(revisions[0].snapshot_json)).toMatchObject({
          source: { lines: [{ currency: "CNY", referenceUnitPrice: 99 }] },
          prices: [{ unitPriceCents: 1500, discountBasisPoints: 0 }],
          totals: { totalCents: 5800 },
        });
        for (const path of [myQuotes, customer, `${customer}.data`]) {
          const content = await html(path, buyerCookie);
          privateBoundary(content);
          if (!path.endsWith(".data"))
            expect(content).toContain("RFQ Submitted");
        }
      },
      beforePdf: async () => {
        expect(
          await server.query("SELECT id FROM proforma_invoices"),
        ).toHaveLength(0);
        expect(
          await server.query("SELECT state FROM proforma_invoice_pdf_jobs"),
        ).toEqual([{ state: "pending" }]);
      },
    });
    expect(pi.document_version).toBe(1);
    expect(
      await server.query(
        "SELECT state,attempts FROM proforma_invoice_pdf_jobs",
      ),
    ).toEqual([{ state: "completed", attempts: 1 }]);
    expect((await drain(true)).delivered).toBeGreaterThan(0);
    expect(await invoice()).toEqual(pi);
    expect(
      await server.query(
        "SELECT state,attempts FROM proforma_invoice_pdf_jobs",
      ),
    ).toEqual([{ state: "completed", attempts: 1 }]);
    const response = await server.request(`${admin}/pi/${pi.id}/pdf`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/pdf");
    expect(response.headers.get("cache-control")).toContain("no-store");
    originalPdf = new Uint8Array(await response.arrayBuffer());
    expect(Buffer.from(originalPdf.slice(0, 5)).toString()).toBe("%PDF-");
    expect(originalPdf.byteLength).toBe(pi.pdf_byte_size);
    expect(createHash("sha256").update(originalPdf).digest("hex")).toBe(
      pi.pdf_sha256,
    );
    const document = await PDFDocument.load(originalPdf);
    expect(document.getPageCount()).toBe(pi.pdf_page_count);
    await writeFile(
      join(server.directory, "TEST-original-pi.pdf"),
      originalPdf,
    );
    const issuedRevisions = await quoteRevisionRows();
    const liveCatalog = async () =>
      await server.query(
        `SELECT s.series_name,v.working_bar,o.reference_price_usd,i.media_version_id
         FROM catalog_skus k
         JOIN catalog_hose_series s ON s.import_id=k.import_id AND s.series_code=k.hose_series
         JOIN catalog_hose_variants v ON v.import_id=k.import_id AND v.sku=k.sku
         JOIN catalog_sales_offers o ON o.import_id=k.import_id AND o.base_sku=k.sku
         JOIN catalog_product_main_images i ON i.import_id=k.import_id AND i.sku=k.sku
         JOIN catalog_releases r ON r.source_import_id=k.import_id
         JOIN catalog_active_release a ON a.release_id=r.id
         WHERE k.sku='601R1_001'`,
      );
    const beforeCatalog = await liveCatalog();
    expect(beforeCatalog).toHaveLength(1);
    // Publish a changed isolated catalog; do not bypass published-row guards.
    // This tests document isolation, not the Admin catalog-edit workflow.
    for (const table of [
      "catalog_imports",
      "catalog_skus",
      "catalog_hose_series",
      "catalog_hose_variants",
      "catalog_sales_offers",
      "catalog_product_main_images",
    ]) {
      const columns = await server.query<{ name: string }>(
        `PRAGMA table_info(${table})`,
      );
      const names = columns.map(({ name }) => `"${name}"`).join(",");
      const values = columns
        .map(({ name }) =>
          name === "id"
            ? "'TEST-after-pi-' || id"
            : name === "import_id"
              ? "'TEST-after-pi-active-import'"
              : `"${name}"`,
        )
        .join(",");
      await server.query(
        `INSERT INTO ${table} (${names}) SELECT ${values} FROM ${table} WHERE ${table === "catalog_imports" ? "id" : "import_id"}='active-import'`,
      );
    }
    for (const sql of [
      "UPDATE catalog_hose_series SET series_name='TEST changed after PI' WHERE id='TEST-after-pi-active-series'",
      "UPDATE catalog_hose_variants SET working_bar=999 WHERE id='TEST-after-pi-active-hose'",
      "UPDATE catalog_sales_offers SET reference_price_usd=777 WHERE id='TEST-after-pi-active-offer'",
      "UPDATE catalog_product_main_images SET media_version_id='uploaded-v2' WHERE id='TEST-after-pi-active-image'",
      "INSERT INTO catalog_releases (id,release_number,status,source_import_id,version,created_at) VALUES ('TEST-after-pi-release','TEST-AFTER-PI','draft','TEST-after-pi-active-import',1,'2026-09-21T00:00:00.000Z')",
      "UPDATE catalog_releases SET status='superseded' WHERE id='active-release' AND status='published'",
      "UPDATE catalog_releases SET status='published',version=version+1,published_at='2026-09-21T00:00:00.000Z' WHERE id='TEST-after-pi-release'",
      "UPDATE catalog_active_release SET release_id='TEST-after-pi-release',version=version+1,updated_at='2026-09-21T00:00:00.000Z' WHERE singleton=1",
    ])
      await server.query(sql);
    expect(await liveCatalog()).toEqual([
      {
        series_name: "TEST changed after PI",
        working_bar: 999,
        reference_price_usd: 777,
        media_version_id: "uploaded-v2",
      },
    ]);
    expect(await liveCatalog()).not.toEqual(beforeCatalog);
    const afterCatalogPdf = await server.request(`${admin}/pi/${pi.id}/pdf`);
    expect(afterCatalogPdf.status).toBe(200);
    expect(new Uint8Array(await afterCatalogPdf.arrayBuffer())).toEqual(
      originalPdf,
    );
    await unchangedQuoteRevisions(issuedRevisions);
    expect(await invoice()).toEqual(pi);
    for (const path of [
      `${customer}/pi/${pi.id}`,
      `${customer}/pi/${pi.id}/pdf`,
    ]) {
      expect(
        (await server.request(path, { headers: { cookie: otherCookie } }))
          .status,
      ).toBe(404);
      expect((await server.request(path)).status).toBe(302);
    }
    expect(
      (
        await server.query("SELECT snapshot_json FROM customer_quote_requests")
      )[0].snapshot_json,
    ).toBe(JSON.stringify(server.source));
  }, 180000);

  it("requires exact PDF viewing and all acknowledgements, then accepts idempotently into My Quotes", async () => {
    expect(
      pi,
      "Run this file unfiltered; the preceding issuance phase is required",
    ).toBeTruthy();
    const path = `${customer}/pi/${pi.id}/accept`;
    const unseen = confirm(formFromHtml(await acceptancePage(), "accept"));
    expect(unseen.get("viewId")).toBe("");
    await post(path, unseen, buyerCookie, 400);
    expect(await server.query("SELECT id FROM pi_acceptances")).toHaveLength(0);
    const target = new URLSearchParams({
      documentVersion: String(pi.document_version),
      snapshotHash: pi.snapshot_hash,
    });
    const pdf = await server.request(`${customer}/pi/${pi.id}/pdf?${target}`, {
      headers: { cookie: buyerCookie },
    });
    expect(pdf.status).toBe(200);
    expect(new Uint8Array(await pdf.arrayBuffer())).toEqual(originalPdf);
    acceptanceForm = confirm(formFromHtml(await acceptancePage(), "accept"));
    expect(acceptanceForm.get("viewId")).toBeTruthy();
    for (const missing of [
      "legalName",
      "generalConfirmed",
      "specifications-0",
      "cancellation-0",
    ]) {
      const incomplete = copyForm(acceptanceForm);
      incomplete.delete(missing);
      await post(path, incomplete, buyerCookie, 400);
    }
    const stale = copyForm(acceptanceForm);
    stale.set("snapshotHash", "0".repeat(64));
    await post(path, stale, buyerCookie, 409);
    await post(path, acceptanceForm, otherCookie, 404);
    const wrongOrigin = await server.request(path, {
      method: "POST",
      body: acceptanceForm,
      headers: { cookie: buyerCookie, origin: "https://attacker.example.test" },
    });
    // React Router's HTTP origin guard runs before the route's 403 guard.
    expect(wrongOrigin.status).toBe(400);
    expect(await server.query("SELECT id FROM pi_acceptances")).toHaveLength(0);
    const results = await Promise.all([
      server.post(path, copyForm(acceptanceForm), buyerCookie),
      server.post(path, copyForm(acceptanceForm), buyerCookie),
    ]);
    for (const response of results)
      expect(response.status, await response.text()).toBe(302);
    await post(path, acceptanceForm, buyerCookie);
    const accepted = await server.query<{
      pi_id: string;
      profile_id: string;
      source: string;
      snapshot_hash: string;
      evidence_json: string;
    }>("SELECT * FROM pi_acceptances");
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({
      pi_id: pi.id,
      profile_id: buyerId,
      source: "website",
      snapshot_hash: pi.snapshot_hash,
    });
    expect(accepted[0].evidence_json).toContain("TEST Buyer");
    for (const [page, status] of [
      [myQuotes, "PI Accepted"],
      [customer, "Payment Pending"],
      [path, "PI Accepted"],
    ]) {
      const content = await html(page, buyerCookie);
      expect(content).toContain(status);
      privateBoundary(content);
    }
    expect(await html(myQuotes, otherCookie)).not.toContain(requestId);
    expect(await invoice()).toEqual(pi);
    // #61 deliberately dispatches copies on the scheduler, not in acceptance.
    expect(
      await server.query(
        "SELECT state,attempts FROM pi_acceptance_copy_outbox",
      ),
    ).toEqual([{ state: "pending", attempts: 0 }]);
    await scheduled();
    await drain();
    await drain(true);
    await scheduled();
    expect(
      await server.query(
        "SELECT state,attempts,delivery_mode FROM pi_acceptance_copy_outbox",
      ),
    ).toEqual([{ state: "sent", attempts: 1, delivery_mode: "stub" }]);
    expect(
      await server.query(
        "SELECT acceptance_id FROM pi_acceptance_copy_captures",
      ),
    ).toHaveLength(1);
    expect(await server.query("SELECT id FROM pi_acceptances")).toHaveLength(1);
    expect(
      (
        await server.query<{ event_type: string }>(
          "SELECT event_type FROM admin_audit_events",
        )
      ).some(({ event_type }) =>
        /payment\.confirmed|order\.created|production\.released/.test(
          event_type,
        ),
      ),
    ).toBe(false);
  }, 180000);

  it("locks accepted seller estimates and replaces through HTTP with new Quote Revision, queued PDF and renewed acceptance", async () => {
    expect(
      acceptanceForm,
      "Run the preceding issuance and acceptance phases",
    ).toBeTruthy();
    const first = pi;
    const originalQuoteRows = await quoteRevisionRows();
    expect(originalQuoteRows).toHaveLength(1);
    const firstAcceptance = await server.query(
      `SELECT * FROM pi_acceptances WHERE pi_id='${first.id}'`,
    );
    expect(firstAcceptance).toHaveLength(1);
    await post(
      `${admin}/private`,
      fields({
        intent: "note",
        commandId: randomUUID(),
        body: "TEST seller estimated freight too low; unchanged buyer data, quantities and transport",
      }),
    );
    await startNextQuote();
    await saveTerms("21.00");
    await issueQuote("TEST seller freight estimate correction");
    const prohibited = await replacementForm(
      "seller_freight_estimate_error",
      false,
    );
    await post(`${admin}/pi/lifecycle`, prohibited, "", 409);
    expect(await invoice()).toEqual(first);
    expect(await server.query("SELECT id FROM proforma_invoices")).toHaveLength(
      1,
    );
    expect(
      await server.query("SELECT pi_id FROM pi_replacement_intents"),
    ).toHaveLength(0);
    expect(
      await server.query(
        `SELECT * FROM pi_acceptances WHERE pi_id='${first.id}'`,
      ),
    ).toEqual(firstAcceptance);

    const earlierQuoteRows = await quoteRevisionRows();
    expect(earlierQuoteRows).toHaveLength(2);
    expect(earlierQuoteRows.slice(0, 1)).toEqual(originalQuoteRows);

    // This is a distinct, documented customer change, not a relabelled seller error.
    await post(
      `${admin}/private`,
      fields({
        intent: "note",
        commandId: randomUUID(),
        body: "TEST buyer explicitly requests sea transport instead of air and a reviewed replacement PI",
      }),
    );
    await startNextQuote();
    await saveTerms("21.00", "Sea freight");
    await issueQuote(
      "TEST customer requests a change from air to sea transport",
    );
    const issuedQuoteRows = await quoteRevisionRows();
    expect(issuedQuoteRows).toHaveLength(3);
    expect(issuedQuoteRows.slice(0, 2)).toEqual(earlierQuoteRows);
    const replacement = await replacementForm(
      "customer_requested_change",
      true,
    );
    await post(`${admin}/pi/lifecycle`, replacement, "", 202);
    await post(`${admin}/pi/lifecycle`, replacement, "", 202);
    expect(await invoice()).toEqual(first);
    expect((await drain()).delivered).toBeGreaterThan(0);
    pi = await invoice();
    expect(pi.id).not.toBe(first.id);
    expect(pi.document_version).toBe(2);
    expect(pi.quote_revision_id).not.toBe(first.quote_revision_id);
    expect(JSON.parse(pi.snapshot_json)).toMatchObject({
      totals: { totalCents: 5900 },
    });
    expect(await server.query("SELECT id FROM proforma_invoices")).toHaveLength(
      2,
    );
    expect(
      await server.query("SELECT pi_id FROM proforma_invoice_heads"),
    ).toEqual([{ pi_id: pi.id }]);
    await drain(true);
    expect(await invoice()).toEqual(pi);
    await unchangedQuoteRevisions(issuedQuoteRows);
    const oldAcceptancePath = `${customer}/pi/${first.id}/accept`;
    // An identical business replay returns the historical receipt, never a new
    // current acceptance. A changed attempt against that version must fail.
    await post(oldAcceptancePath, acceptanceForm, buyerCookie);
    expect(
      await server.query(
        `SELECT id FROM pi_acceptances WHERE pi_id='${pi.id}'`,
      ),
    ).toHaveLength(0);
    const staleAccept = copyForm(acceptanceForm);
    staleAccept.set("commandId", randomUUID());
    staleAccept.set("legalName", "TEST changed acceptance of superseded PI");
    await post(oldAcceptancePath, staleAccept, buyerCookie, 409);
    const staleTarget = new URLSearchParams({
      documentVersion: String(first.document_version),
      snapshotHash: first.snapshot_hash,
    });
    expect(
      (
        await server.request(`${customer}/pi/${first.id}/pdf?${staleTarget}`, {
          headers: { cookie: buyerCookie },
        })
      ).status,
    ).toBe(409);
    const oldPdf = await server.request(`${customer}/pi/${first.id}/pdf`, {
      headers: { cookie: buyerCookie },
    });
    expect(oldPdf.status).toBe(200);
    expect(new Uint8Array(await oldPdf.arrayBuffer())).toEqual(originalPdf);
    expect(
      await server.query(
        `SELECT * FROM proforma_invoices WHERE id='${first.id}'`,
      ),
    ).toEqual([first]);
    expect(
      await server.query(
        `SELECT * FROM pi_acceptances WHERE pi_id='${first.id}'`,
      ),
    ).toEqual(firstAcceptance);
    const history = await html(`${customer}/pi/${pi.id}`, buyerCookie);
    privateBoundary(history);
    expect(history).toContain(first.id);
    expect(history).toMatch(/Superseded|superseded/);
    expect(await html(myQuotes, buyerCookie)).toContain("PI Issued");
    const unseen = confirm(formFromHtml(await acceptancePage(), "accept"));
    expect(unseen.get("viewId")).toBe("");
    await post(`${customer}/pi/${pi.id}/accept`, unseen, buyerCookie, 400);
    const target = new URLSearchParams({
      documentVersion: String(pi.document_version),
      snapshotHash: pi.snapshot_hash,
    });
    const newPdf = await server.request(
      `${customer}/pi/${pi.id}/pdf?${target}`,
      { headers: { cookie: buyerCookie } },
    );
    expect(newPdf.status).toBe(200);
    const newBytes = new Uint8Array(await newPdf.arrayBuffer());
    expect(createHash("sha256").update(newBytes).digest("hex")).toBe(
      pi.pdf_sha256,
    );
    expect(newBytes).not.toEqual(originalPdf);
    const renewed = confirm(formFromHtml(await acceptancePage(), "accept"));
    expect(renewed.get("viewId")).not.toBe(acceptanceForm.get("viewId"));
    await post(`${customer}/pi/${pi.id}/accept`, renewed, buyerCookie);
    await post(`${customer}/pi/${pi.id}/accept`, renewed, buyerCookie);
    expect(await server.query("SELECT id FROM pi_acceptances")).toHaveLength(2);
    expect(await html(myQuotes, buyerCookie)).toContain("PI Accepted");
    await scheduled();
    await drain();
    await drain(true);
    expect(
      await server.query(
        "SELECT acceptance_id FROM pi_acceptance_copy_captures",
      ),
    ).toHaveLength(2);
    await unchangedQuoteRevisions(issuedQuoteRows);
  }, 180000);
});
