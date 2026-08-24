import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FileSpreadsheet,
  Upload,
} from "lucide-react";
import { Form, Link, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/catalog-import";
import { importCatalogWorkbook } from "../../catalog/domain/catalog-workbook-import";
import { createD1CatalogWorkbookImportRepository } from "../../catalog/infrastructure/d1-catalog-workbook-import-repository";
import { readCatalogWorkbook } from "../../catalog/infrastructure/read-catalog-workbook";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";

const maximumWorkbookBytes = 10 * 1024 * 1024;

export function meta() {
  return [{ title: "Catalog Workbook Import | Admin Backoffice" }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = requireAdminRequestContext(context);
  const repository = createD1CatalogWorkbookImportRepository(env.DB);
  const importId = new URL(request.url).searchParams.get("import");
  return {
    review: importId
      ? await repository.findImportReviewById(importId)
      : await repository.findLatestImportReview(),
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { adminIdentity, env } = requireAdminRequestContext(context);
  if (request.method !== "POST") {
    throw new Response("Method not allowed", { status: 405 });
  }

  const form = await request.formData();
  const file = form.get("workbook");
  if (!(file instanceof File) || file.size === 0) {
    return { formError: "Select the approved .xlsx workbook." };
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return { formError: "Only .xlsx workbooks are accepted." };
  }
  if (file.size > maximumWorkbookBytes) {
    return { formError: "The workbook exceeds the 10 MB upload limit." };
  }

  let sheets;
  try {
    sheets = await readCatalogWorkbook(await file.arrayBuffer());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown workbook error";
    return { formError: `The workbook could not be read: ${message}` };
  }

  const repository = createD1CatalogWorkbookImportRepository(env.DB);
  const review = await importCatalogWorkbook(repository, {
    actorId: adminIdentity.id,
    fileName: file.name,
    fileSizeBytes: file.size,
    sheets,
  });
  return redirect(`/admin/catalog/import?import=${review.id}`);
}

function formatBytes(bytes: number) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export default function CatalogImport({
  actionData,
  loaderData,
}: Route.ComponentProps) {
  const navigation = useNavigation();
  const review = loaderData.review;
  const importing = navigation.state === "submitting";

  return (
    <main className="catalog-import-page" data-surface="admin">
      <div className="diagnostic-toolbar">
        <Link className="button button-secondary" to="/admin">
          <ArrowLeft size={17} /> Back to overview
        </Link>
      </div>

      <header>
        <span className="eyebrow">Catalog operations</span>
        <h1>Import product workbook</h1>
        <p>
          Validate worksheets 01-04 and create one reviewable draft release.
        </p>
      </header>

      <section className="catalog-upload-panel">
        <div>
          <FileSpreadsheet size={24} />
          <div>
            <h2>Approved workbook</h2>
            <p>
              Imports Hose, Hose End, Ferrule, and exact compatibility data.
            </p>
          </div>
        </div>
        <Form encType="multipart/form-data" method="post">
          <label className="file-field">
            <span>Excel workbook</span>
            <input accept=".xlsx" name="workbook" required type="file" />
          </label>
          <button
            className="button button-primary"
            disabled={importing}
            type="submit"
          >
            <Upload size={17} />{" "}
            {importing ? "Validating..." : "Upload and validate"}
          </button>
        </Form>
        {actionData?.formError ? (
          <p className="form-error" role="alert">
            <AlertCircle size={17} /> {actionData.formError}
          </p>
        ) : null}
      </section>

      {review ? (
        <section className="catalog-import-review" aria-live="polite">
          <div className={`import-result-heading ${review.status}`}>
            {review.status === "completed" ? (
              <CheckCircle2 size={23} />
            ) : (
              <AlertCircle size={23} />
            )}
            <div>
              <span className="eyebrow">Latest import</span>
              <h2>
                {review.status === "completed"
                  ? "Draft release created"
                  : "Import blocked"}
              </h2>
            </div>
          </div>

          <dl className="import-metadata">
            <div>
              <dt>Source file</dt>
              <dd>{review.sourceFileName}</dd>
            </div>
            <div>
              <dt>File size</dt>
              <dd>{formatBytes(review.sourceFileSizeBytes)}</dd>
            </div>
            <div>
              <dt>Draft release</dt>
              <dd>{review.draftReleaseNumber ?? "Not created"}</dd>
            </div>
            <div>
              <dt>Validation</dt>
              <dd>
                {review.errorCount} errors · {review.warningCount} warnings
              </dd>
            </div>
          </dl>

          {review.status === "completed" ? (
            <>
              <div className="import-summary-grid">
                <article>
                  <span>Hose series</span>
                  <strong>{review.summary.hoseSeriesCount}</strong>
                </article>
                <article>
                  <span>Hose variants</span>
                  <strong>{review.summary.hoseVariantCount}</strong>
                </article>
                <article>
                  <span>Hose ends</span>
                  <strong>{review.summary.hoseEndCount}</strong>
                </article>
                <article>
                  <span>Ferrules</span>
                  <strong>{review.summary.ferruleCount}</strong>
                </article>
                <article>
                  <span>Exact combinations</span>
                  <strong>{review.summary.compatibilityCount}</strong>
                </article>
              </div>
              <p className="import-safety-note">
                All imported SKUs start Temporarily Unavailable. RFQ eligibility
                does not mean production approval; only Approved + Complete
                compatibility data is production-approved.
              </p>
            </>
          ) : null}

          {review.validationResults.length > 0 ? (
            <div className="validation-table-wrap">
              <table className="validation-table">
                <thead>
                  <tr>
                    <th>Worksheet</th>
                    <th>Row</th>
                    <th>Field</th>
                    <th>SKU</th>
                    <th>Severity</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {review.validationResults.map((result, index) => (
                    <tr key={`${result.code}-${result.row}-${index}`}>
                      <td>{result.worksheet}</td>
                      <td>{result.row || "N/A"}</td>
                      <td>{result.field}</td>
                      <td>{result.sku ?? "N/A"}</td>
                      <td>
                        <span className={`severity-badge ${result.severity}`}>
                          {result.severity}
                        </span>
                      </td>
                      <td>{result.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
