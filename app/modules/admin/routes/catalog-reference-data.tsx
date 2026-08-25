import {
  ArrowLeft,
  CircleAlert,
  Database,
  Ruler,
  Save,
  ShieldCheck,
} from "lucide-react";
import { Form, Link, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/catalog-reference-data";
import { createD1ConfiguratorReferenceRepository } from "../../configurator-reference/infrastructure/d1-configurator-reference-repository";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";

export function meta() {
  return [{ title: "Configurator Reference Data | Admin Backoffice" }];
}

function textValue(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function requiredText(form: FormData, key: string) {
  const value = textValue(form, key);
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function normalizedCode(form: FormData, key: string) {
  const value = requiredText(form, key)
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "");
  if (!value) throw new Error(`${key} is invalid`);
  return value;
}

function nullablePrice(form: FormData, key: string) {
  const raw = textValue(form, key);
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`${key} must be a non-negative USD amount`);
  return value;
}

function presets(form: FormData) {
  const values = requiredText(form, "presets")
    .split(",")
    .map((value) => Number(value.trim()));
  if (
    values.length === 0 ||
    values.some((value) => !Number.isInteger(value) || value < 0 || value > 359)
  ) {
    throw new Error("Clocking presets must be whole degrees from 000 to 359");
  }
  return [...new Set(values)];
}

function mutationFromForm(form: FormData) {
  const intent = requiredText(form, "intent");
  if (intent === "save_endpoint_class") {
    const code = normalizedCode(form, "classCode");
    return {
      entryKey: code,
      payload: {
        code,
        displayName: requiredText(form, "displayName"),
        referenceKind: normalizedCode(form, "referenceKind").toLowerCase(),
      },
      registryType: "endpoint_class" as const,
    };
  }
  if (intent === "save_endpoint_assignment") {
    const hoseEndSku = requiredText(form, "hoseEndSku");
    return {
      entryKey: hoseEndSku,
      payload: {
        endpointClassCode: requiredText(form, "endpointClassCode"),
        hoseEndSku,
      },
      registryType: "endpoint_assignment" as const,
    };
  }
  if (intent === "save_measurement_method") {
    const code = requiredText(form, "methodCode").toUpperCase();
    if (!/^M0[1-7]$/.test(code)) throw new Error("Method must be M01-M07");
    return {
      entryKey: code,
      payload: {
        code,
        diagramAssetKey: requiredText(form, "diagramAssetKey"),
        displayName: requiredText(form, "displayName"),
        endpointRule: requiredText(form, "endpointRule"),
        overlayVersion: requiredText(form, "overlayVersion"),
      },
      registryType: "measurement_method" as const,
    };
  }
  if (intent === "save_measurement_mapping") {
    const endAClassCode = requiredText(form, "endAClassCode");
    const endBClassCode = requiredText(form, "endBClassCode");
    const guidanceStatus = requiredText(form, "guidanceStatus");
    if (guidanceStatus !== "guided" && guidanceStatus !== "manual_quote_only") {
      throw new Error("Guidance status is invalid");
    }
    const methodCode =
      guidanceStatus === "guided"
        ? requiredText(form, "methodCode").toUpperCase()
        : null;
    if (methodCode !== null && !/^M0[1-7]$/.test(methodCode))
      throw new Error("Guided mappings require M01-M07");
    const entryKey = `${endAClassCode}:${endBClassCode}`;
    return {
      entryKey,
      payload: {
        endAClassCode,
        endBClassCode,
        guidanceStatus,
        id: entryKey,
        methodCode,
      },
      registryType: "measurement_mapping" as const,
    };
  }
  if (intent === "save_clocking") {
    const tolerance = Number(requiredText(form, "standardToleranceDegrees"));
    if (!Number.isFinite(tolerance) || tolerance <= 0)
      throw new Error("Standard Clocking tolerance must be positive");
    return {
      entryKey: "M08",
      payload: {
        acceptedMaximumDegrees: 359,
        acceptedMinimumDegrees: 0,
        code: "M08",
        measurementDirection: "clockwise",
        notSureOutcome: "manual_review",
        presets: presets(form),
        rendererVersion: requiredText(form, "rendererVersion"),
        standardToleranceDegrees: tolerance,
        tighterToleranceOutcome: "manual_review",
        viewDirection: "end_a_toward_end_b",
        zeroReference: "end_b_at_6_oclock",
      },
      registryType: "clocking_convention" as const,
    };
  }
  if (intent === "save_installed_protection") {
    const code = normalizedCode(form, "protectionCode");
    const availability =
      code === "NONE" ? "available" : requiredText(form, "availability");
    if (
      availability !== "available" &&
      availability !== "temporarily_unavailable" &&
      availability !== "discontinued"
    ) {
      throw new Error("Installed Protection availability is invalid");
    }
    const isNoAdditionalProtection =
      code === "NONE" || textValue(form, "isNoAdditionalProtection") === "true";
    return {
      entryKey: code,
      payload: {
        availability,
        code,
        currency: "USD",
        isNoAdditionalProtection,
        publicName: requiredText(form, "publicName"),
        referencePriceUsd:
          code === "NONE" ? 0 : nullablePrice(form, "referencePriceUsd"),
        specification: requiredText(form, "specification"),
      },
      registryType: "installed_protection" as const,
    };
  }
  if (intent === "save_protection_rule") {
    const hoseSeries = textValue(form, "hoseSeries") || null;
    const applicationCode = textValue(form, "applicationCode") || null;
    if (hoseSeries === null && applicationCode === null)
      throw new Error("A protection rule needs a Hose Series or application");
    const entryKey = normalizedCode(form, "ruleCode");
    return {
      entryKey,
      payload: {
        applicationCode,
        hoseSeries,
        id: entryKey,
        requiresProtection: true,
      },
      registryType: "protection_rule" as const,
    };
  }
  if (intent === "save_estimate_schedule") {
    return {
      entryKey: "DEFAULT",
      payload: {
        assemblyServicePriceUsd: nullablePrice(form, "assemblyServicePriceUsd"),
        currency: "USD",
        ferrulePriceSource: "catalog_sales_offer",
        hoseEndPriceSource: "catalog_sales_offer",
        hosePriceSource: "catalog_sales_offer_per_ft",
        protectionPriceSource: "installed_protection_registry",
      },
      registryType: "assembly_estimate_schedule" as const,
    };
  }
  throw new Error("Unknown configurator registry command");
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = requireAdminRequestContext(context);
  const repository = createD1ConfiguratorReferenceRepository(env.DB);
  const releaseId = new URL(request.url).searchParams.get("release");
  const snapshot = await repository.findDraftSnapshot(releaseId);
  return {
    saved: new URL(request.url).searchParams.get("saved"),
    snapshot,
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { adminIdentity, env } = requireAdminRequestContext(context);
  if (request.method !== "POST")
    throw new Response("Method not allowed", { status: 405 });
  const form = await request.formData();
  const releaseId = requiredText(form, "releaseId");
  try {
    const mutation = mutationFromForm(form);
    const repository = createD1ConfiguratorReferenceRepository(env.DB);
    const snapshot = await repository.findDraftSnapshot(releaseId);
    if (!snapshot) throw new Error("Draft Catalog Release was not found");

    if (mutation.registryType === "endpoint_assignment") {
      const hoseEndSku = String(mutation.payload.hoseEndSku);
      const endpointClassCode = String(mutation.payload.endpointClassCode);
      const hoseEnds = await repository.listDraftHoseEnds(releaseId);
      if (!hoseEnds.some((hoseEnd) => hoseEnd.sku === hoseEndSku)) {
        throw new Error("Hose End SKU is not part of this draft release");
      }
      if (
        !snapshot.endpointClasses.some(
          (endpointClass) => endpointClass.code === endpointClassCode,
        )
      ) {
        throw new Error("Measurement Endpoint Class is not registered");
      }
    }

    if (mutation.registryType === "measurement_mapping") {
      const endAClassCode = String(mutation.payload.endAClassCode);
      const endBClassCode = String(mutation.payload.endBClassCode);
      const methodCode = mutation.payload.methodCode;
      for (const classCode of [endAClassCode, endBClassCode]) {
        if (
          !snapshot.endpointClasses.some(
            (endpointClass) => endpointClass.code === classCode,
          )
        ) {
          throw new Error(`Measurement Endpoint Class ${classCode} is missing`);
        }
      }
      if (
        methodCode !== null &&
        !snapshot.measurementMethods.some(
          (method) => method.code === methodCode,
        )
      ) {
        throw new Error(`Measurement Method ${String(methodCode)} is missing`);
      }
    }

    await repository.saveDraftEntry({
      actorId: adminIdentity.id,
      auditEventId: crypto.randomUUID(),
      ...mutation,
      releaseId,
      updatedAt: new Date().toISOString(),
    });
    return redirect(
      `/admin/catalog/reference-data?release=${encodeURIComponent(releaseId)}&saved=${encodeURIComponent(mutation.registryType)}`,
    );
  } catch (error) {
    return {
      formError:
        error instanceof Error ? error.message : "Reference data was not saved",
    };
  }
}

function RegistryForm({
  children,
  intent,
  releaseId,
}: {
  children: React.ReactNode;
  intent: string;
  releaseId: string;
}) {
  const navigation = useNavigation();
  return (
    <Form className="reference-data-form" method="post">
      <input name="releaseId" type="hidden" value={releaseId} />
      <input name="intent" type="hidden" value={intent} />
      {children}
      <button
        className="button button-primary"
        disabled={navigation.state === "submitting"}
        type="submit"
      >
        <Save size={16} /> Save draft
      </button>
    </Form>
  );
}

function Field({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <label>
      <span>{label}</span>
      {children}
    </label>
  );
}

export default function CatalogReferenceData({
  actionData,
  loaderData,
}: Route.ComponentProps) {
  const snapshot = loaderData.snapshot;
  if (!snapshot) {
    return (
      <main className="reference-data-page" data-surface="admin">
        <Link className="button button-secondary" to="/admin">
          <ArrowLeft size={17} /> Back to overview
        </Link>
        <div className="empty-state">
          <Database size={24} />
          <div>
            <strong>No editable Catalog Release</strong>
            <p>Import a workbook to create a draft release first.</p>
          </div>
        </div>
      </main>
    );
  }

  const schedule = snapshot.assemblyEstimateSchedule;
  const clocking = snapshot.clockingConvention;

  return (
    <main className="reference-data-page" data-surface="admin">
      <div className="diagnostic-toolbar">
        <Link className="button button-secondary" to="/admin">
          <ArrowLeft size={17} /> Back to overview
        </Link>
        <Link
          className="button button-secondary"
          to="/assembly-measurement-guide"
        >
          <Ruler size={17} /> View customer measurement guide
        </Link>
      </div>
      <header>
        <span className="eyebrow">Catalog Release reference data</span>
        <h1>Configurator Registries</h1>
        <p>
          Editing {snapshot.release.releaseNumber}. These records publish with
          this release and become immutable history.
        </p>
      </header>

      {loaderData.saved ? (
        <p className="catalog-update-success" role="status">
          <ShieldCheck size={17} /> Saved{" "}
          {loaderData.saved.replaceAll("_", " ")}.
        </p>
      ) : null}
      {actionData?.formError ? (
        <p className="form-error" role="alert">
          <CircleAlert size={17} /> {actionData.formError}
        </p>
      ) : null}

      <section className="reference-status-grid" aria-label="Registry status">
        <article>
          <span>Measurement methods</span>
          <strong>{snapshot.measurementMethods.length} / 7</strong>
          <small>M01-M07 seed set</small>
        </article>
        <article>
          <span>Customer selection</span>
          <strong>M01-M07</strong>
          <small>Not Sure routes the line to manual review</small>
        </article>
        <article>
          <span>Assembly service price</span>
          <strong>
            {schedule?.assemblyServicePriceUsd === null || !schedule
              ? "Not supplied"
              : `$${schedule.assemblyServicePriceUsd.toFixed(2)}`}
          </strong>
          <small>Missing price does not block publication</small>
        </article>
      </section>

      <section className="reference-section">
        <div>
          <span className="eyebrow">M01-M07</span>
          <h2>Measurement Methods</h2>
          <p>
            Customers review all methods and select the one they used. Not Sure
            routes the assembly to manual review.
          </p>
        </div>
        <div className="reference-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Method</th>
                <th>Name</th>
                <th>Diagram</th>
                <th>Version</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.measurementMethods.map((method) => (
                <tr key={method.code}>
                  <td>{method.code}</td>
                  <td>{method.displayName}</td>
                  <td>{method.diagramAssetKey}</td>
                  <td>v{method.recordVersion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details className="reference-editor">
          <summary>Edit a measurement method</summary>
          <RegistryForm
            intent="save_measurement_method"
            releaseId={snapshot.release.id}
          >
            <Field label="Method">
              <select name="methodCode">
                {snapshot.measurementMethods.map(({ code }) => (
                  <option key={code}>{code}</option>
                ))}
              </select>
            </Field>
            <Field label="Display name">
              <input name="displayName" required />
            </Field>
            <Field label="Endpoint rule">
              <input name="endpointRule" required />
            </Field>
            <Field label="Diagram asset key">
              <input name="diagramAssetKey" required />
            </Field>
            <Field label="Overlay version">
              <input name="overlayVersion" required />
            </Field>
          </RegistryForm>
        </details>
      </section>

      <section className="reference-section">
        <div>
          <span className="eyebrow">M08</span>
          <h2>Clocking Convention</h2>
          <p>
            Any whole degree from 000-359 is accepted. Not Sure and tighter
            tolerance requests require manual review.
          </p>
        </div>
        <RegistryForm intent="save_clocking" releaseId={snapshot.release.id}>
          <Field label="Preset degrees">
            <input
              defaultValue={clocking?.presets.join(", ") ?? ""}
              name="presets"
              required
            />
          </Field>
          <Field label="Standard tolerance (degrees)">
            <input
              defaultValue={clocking?.standardToleranceDegrees ?? 3}
              min="0.1"
              name="standardToleranceDegrees"
              step="0.1"
              type="number"
            />
          </Field>
          <Field label="Renderer version">
            <input
              defaultValue={clocking?.rendererVersion ?? ""}
              name="rendererVersion"
              required
            />
          </Field>
        </RegistryForm>
      </section>

      <section className="reference-section">
        <div>
          <span className="eyebrow">Assembly options</span>
          <h2>Installed Protection</h2>
          <p>
            Standard Export Packaging is mandatory and remains separate from
            these installed sleeves and guards.
          </p>
        </div>
        <div className="reference-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Customer option</th>
                <th>Availability</th>
                <th>Reference Price</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.installedProtections.map((option) => (
                <tr key={option.code}>
                  <td>{option.code}</td>
                  <td>{option.publicName}</td>
                  <td>{option.availability}</td>
                  <td>
                    {option.referencePriceUsd === null
                      ? "Not supplied"
                      : `$${option.referencePriceUsd.toFixed(2)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="reference-data-columns">
          <RegistryForm
            intent="save_installed_protection"
            releaseId={snapshot.release.id}
          >
            <Field label="Option code">
              <input name="protectionCode" required />
            </Field>
            <Field label="Customer name">
              <input name="publicName" required />
            </Field>
            <Field label="Specification">
              <input name="specification" required />
            </Field>
            <Field label="Availability">
              <select name="availability">
                <option value="available">Available</option>
                <option value="temporarily_unavailable">
                  Temporarily Unavailable
                </option>
                <option value="discontinued">Discontinued</option>
              </select>
            </Field>
            <Field label="Reference Price USD (optional)">
              <input
                min="0"
                name="referencePriceUsd"
                step="0.01"
                type="number"
              />
            </Field>
            <input
              name="isNoAdditionalProtection"
              type="hidden"
              value="false"
            />
          </RegistryForm>
          <RegistryForm
            intent="save_protection_rule"
            releaseId={snapshot.release.id}
          >
            <Field label="Rule code">
              <input name="ruleCode" required />
            </Field>
            <Field label="Hose Series (optional)">
              <input name="hoseSeries" />
            </Field>
            <Field label="Application code (optional)">
              <input name="applicationCode" />
            </Field>
          </RegistryForm>
        </div>
      </section>

      <section className="reference-section">
        <div>
          <span className="eyebrow">Admin-only pricing</span>
          <h2>Assembly Estimate Schedule</h2>
          <p>
            Component prices come from the release Sales Offers. A blank service
            price produces no assembly estimate; the system never substitutes a
            guessed value.
          </p>
        </div>
        <RegistryForm
          intent="save_estimate_schedule"
          releaseId={snapshot.release.id}
        >
          <Field label="Assembly service Reference Price USD (optional)">
            <input
              defaultValue={schedule?.assemblyServicePriceUsd ?? ""}
              min="0"
              name="assemblyServicePriceUsd"
              step="0.01"
              type="number"
            />
          </Field>
        </RegistryForm>
      </section>
    </main>
  );
}
