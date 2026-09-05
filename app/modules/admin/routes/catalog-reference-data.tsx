import {
  ArrowLeft,
  CircleAlert,
  Database,
  Pencil,
  Plus,
  Ruler,
  Save,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Form, Link, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/catalog-reference-data";
import {
  isMeasurementMethodCode,
  type AssemblyEstimateSchedule,
  type ClockingConvention,
  type InstalledProtection,
  type LengthMeasurementMethod,
  type MeasurementMethodCode,
} from "../../configurator-reference/domain/configurator-reference";
import { createD1ConfiguratorReferenceRepository } from "../../configurator-reference/infrastructure/d1-configurator-reference-repository";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { AdminNavigation } from "../ui/admin-navigation";

export function meta() {
  return [{ title: "总成参数配置 | Admin Backoffice" }];
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
    if (!isMeasurementMethodCode(code)) {
      throw new Error("Method must be M01-M07; M08 is reserved for Clocking");
    }
    return {
      entryKey: code,
      payload: {
        code,
        diagramAssetKey: requiredText(form, "diagramAssetKey"),
        diagramAssetVersion: requiredText(form, "diagramAssetVersion"),
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
    if (methodCode !== null && !isMeasurementMethodCode(methodCode)) {
      throw new Error("Guided mappings require a valid measurement method");
    }
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
    const publicName = requiredText(form, "publicName");
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
        publicName,
        referenceBasePriceUsd:
          code === "NONE" ? 0 : nullablePrice(form, "referenceBasePriceUsd"),
        referenceInstallationPricePerStartedFootUsd:
          code === "NONE"
            ? 0
            : nullablePrice(
                form,
                "referenceInstallationPricePerStartedFootUsd",
              ),
        referenceMaterialPricePerFootUsd:
          code === "NONE"
            ? 0
            : nullablePrice(form, "referenceMaterialPricePerFootUsd"),
        referencePriceUsd:
          code === "NONE" ? 0 : nullablePrice(form, "referencePriceUsd"),
        specification: textValue(form, "specification") || publicName,
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
        assemblyServicePricePerStartedFootUsd: nullablePrice(
          form,
          "assemblyServicePricePerStartedFootUsd",
        ),
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
  const url = new URL(request.url);
  const releaseId = url.searchParams.get("release");
  const [activeSnapshot, currentDraftSnapshot] = await Promise.all([
    repository.findActiveSnapshot(),
    repository.findDraftSnapshot(),
  ]);
  const snapshot = releaseId
    ? ([activeSnapshot, currentDraftSnapshot].find(
        (candidate) => candidate?.release.id === releaseId,
      ) ?? null)
    : (activeSnapshot ?? currentDraftSnapshot);
  if (releaseId && !snapshot) {
    throw redirect("/admin/catalog/reference-data");
  }
  return {
    activeRelease: activeSnapshot?.release ?? null,
    currentDraftRelease: currentDraftSnapshot?.release ?? null,
    saved: url.searchParams.get("saved"),
    snapshot,
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { adminIdentity, env } = requireAdminRequestContext(context);
  if (request.method !== "POST")
    throw new Response("Method not allowed", { status: 405 });
  const form = await request.formData();
  try {
    const mutation = mutationFromForm(form);
    const repository = createD1ConfiguratorReferenceRepository(env.DB);
    if (textValue(form, "scope") === "global") {
      if (
        mutation.registryType !== "assembly_estimate_schedule" &&
        mutation.registryType !== "clocking_convention" &&
        mutation.registryType !== "installed_protection" &&
        mutation.registryType !== "measurement_method"
      ) {
        throw new Error("This setting cannot be changed globally");
      }
      const expectedRecordVersion = Number(
        requiredText(form, "expectedRecordVersion"),
      );
      if (
        !Number.isInteger(expectedRecordVersion) ||
        expectedRecordVersion < 0
      ) {
        throw new Error("The global setting version is invalid");
      }
      await repository.saveGlobalEntry({
        actorId: adminIdentity.id,
        auditEventId: crypto.randomUUID(),
        entryKey: mutation.entryKey,
        expectedRecordVersion,
        payload: mutation.payload,
        registryType: mutation.registryType,
        updatedAt: new Date().toISOString(),
      });
      return redirect(
        `/admin/catalog/reference-data?saved=${encodeURIComponent(mutation.registryType)}`,
      );
    }

    const releaseId = requiredText(form, "releaseId");
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

function GlobalRegistryForm({
  children,
  expectedRecordVersion,
  intent,
  onCancel,
}: {
  children: React.ReactNode;
  expectedRecordVersion: number;
  intent: string;
  onCancel: () => void;
}) {
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";
  return (
    <Form className="reference-data-form reference-global-form" method="post">
      <input name="scope" type="hidden" value="global" />
      <input name="intent" type="hidden" value={intent} />
      <input
        name="expectedRecordVersion"
        type="hidden"
        value={expectedRecordVersion}
      />
      {children}
      <div className="reference-dialog-actions">
        <button
          className="button button-secondary"
          disabled={saving}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="button button-primary"
          disabled={saving}
          type="submit"
        >
          <Save size={16} /> {saving ? "Applying..." : "Apply globally"}
        </button>
      </div>
    </Form>
  );
}

function ReferenceDialog({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [onClose]);

  return (
    <div className="reference-dialog-backdrop" role="presentation">
      <div
        aria-labelledby="reference-dialog-title"
        aria-modal="true"
        className="reference-dialog"
        role="dialog"
      >
        <header>
          <h2 id="reference-dialog-title">{title}</h2>
          <button
            aria-label="Close editor"
            className="icon-button"
            onClick={onClose}
            ref={closeRef}
            type="button"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </header>
        {children}
      </div>
    </div>
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

type ReferenceEditor =
  | "clocking"
  | "method-add"
  | "method-edit"
  | "protection-add"
  | "protection-edit"
  | "schedule"
  | null;

function SectionActions({
  onAdd,
  onEdit,
}: {
  onAdd?: () => void;
  onEdit: () => void;
}) {
  return (
    <div className="reference-section-actions">
      <button
        className="button button-secondary"
        onClick={onEdit}
        type="button"
      >
        <Pencil aria-hidden="true" size={16} /> 编辑
      </button>
      {onAdd ? (
        <button className="button button-primary" onClick={onAdd} type="button">
          <Plus aria-hidden="true" size={16} /> 新增
        </button>
      ) : null}
    </div>
  );
}

function ScheduleEditor({
  onClose,
  schedule,
}: {
  onClose: () => void;
  schedule: AssemblyEstimateSchedule | null;
}) {
  return (
    <ReferenceDialog onClose={onClose} title="编辑 Assembly service price">
      <GlobalRegistryForm
        expectedRecordVersion={schedule?.recordVersion ?? 0}
        intent="save_estimate_schedule"
        onCancel={onClose}
      >
        <Field label="Base assembly service price USD (optional)">
          <input
            defaultValue={schedule?.assemblyServicePriceUsd ?? ""}
            min="0"
            name="assemblyServicePriceUsd"
            step="0.01"
            type="number"
          />
        </Field>
        <Field label="Service price per started ft USD (optional)">
          <input
            defaultValue={schedule?.assemblyServicePricePerStartedFootUsd ?? ""}
            min="0"
            name="assemblyServicePricePerStartedFootUsd"
            step="0.01"
            type="number"
          />
        </Field>
      </GlobalRegistryForm>
    </ReferenceDialog>
  );
}

function MeasurementMethodEditor({
  methods,
  mode,
  onClose,
}: {
  methods: LengthMeasurementMethod[];
  mode: "add" | "edit";
  onClose: () => void;
}) {
  const [selectedCode, setSelectedCode] = useState<MeasurementMethodCode>(
    methods[0]?.code ?? "M01",
  );
  const method = methods.find(({ code }) => code === selectedCode) ?? null;
  const editing = mode === "edit";
  return (
    <ReferenceDialog
      onClose={onClose}
      title={editing ? "编辑 M01-M07 测量规则" : "新增 M01-M07 测量规则"}
    >
      {editing ? (
        <label className="reference-dialog-selector">
          <span>Measurement method</span>
          <select
            onChange={(event) => {
              const code = event.currentTarget.value;
              if (isMeasurementMethodCode(code)) setSelectedCode(code);
            }}
            value={selectedCode}
          >
            {methods.map((item) => (
              <option key={item.code} value={item.code}>
                {item.code} · {item.displayName}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <GlobalRegistryForm
        expectedRecordVersion={editing ? (method?.recordVersion ?? 0) : 0}
        intent="save_measurement_method"
        key={editing ? selectedCode : "new"}
        onCancel={onClose}
      >
        <Field label="Method code">
          {editing ? (
            <input name="methodCode" readOnly value={method?.code ?? ""} />
          ) : (
            <input
              name="methodCode"
              pattern="M0[1-7]"
              placeholder="M07"
              required
            />
          )}
        </Field>
        <Field label="Display name">
          <input
            defaultValue={editing ? (method?.displayName ?? "") : ""}
            name="displayName"
            required
          />
        </Field>
        <Field label="Endpoint rule">
          <input
            defaultValue={editing ? (method?.endpointRule ?? "") : ""}
            name="endpointRule"
            required
          />
        </Field>
        <Field label="Diagram asset key">
          <input
            defaultValue={editing ? (method?.diagramAssetKey ?? "") : ""}
            name="diagramAssetKey"
            placeholder="M07-example.jpg"
            required
          />
        </Field>
        <Field label="Diagram asset version">
          <input
            defaultValue={
              editing ? (method?.diagramAssetVersion ?? "1.0.0") : "1.0.0"
            }
            name="diagramAssetVersion"
            required
          />
        </Field>
        <Field label="Overlay version">
          <input
            defaultValue={
              editing ? (method?.overlayVersion ?? "1.0.0") : "1.0.0"
            }
            name="overlayVersion"
            required
          />
        </Field>
      </GlobalRegistryForm>
    </ReferenceDialog>
  );
}

function ClockingEditor({
  clocking,
  onClose,
}: {
  clocking: ClockingConvention | null;
  onClose: () => void;
}) {
  return (
    <ReferenceDialog onClose={onClose} title="编辑 M08 Clocking">
      <GlobalRegistryForm
        expectedRecordVersion={clocking?.recordVersion ?? 0}
        intent="save_clocking"
        onCancel={onClose}
      >
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
            required
            step="0.1"
            type="number"
          />
        </Field>
        <Field label="Renderer version">
          <input
            defaultValue={clocking?.rendererVersion ?? "1.0.0"}
            name="rendererVersion"
            required
          />
        </Field>
      </GlobalRegistryForm>
    </ReferenceDialog>
  );
}

function ProtectionEditor({
  mode,
  onClose,
  protections,
}: {
  mode: "add" | "edit";
  onClose: () => void;
  protections: InstalledProtection[];
}) {
  const [selectedCode, setSelectedCode] = useState(
    protections[0]?.code ?? "NONE",
  );
  const option = protections.find(({ code }) => code === selectedCode) ?? null;
  const editing = mode === "edit";
  return (
    <ReferenceDialog
      onClose={onClose}
      title={editing ? "编辑 Assembly option" : "新增 Assembly option"}
    >
      {editing ? (
        <label className="reference-dialog-selector">
          <span>Installed Protection</span>
          <select
            onChange={(event) => setSelectedCode(event.currentTarget.value)}
            value={selectedCode}
          >
            {protections.map((item) => (
              <option key={item.code} value={item.code}>
                {item.code} · {item.publicName}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <GlobalRegistryForm
        expectedRecordVersion={editing ? (option?.recordVersion ?? 0) : 0}
        intent="save_installed_protection"
        key={editing ? selectedCode : "new"}
        onCancel={onClose}
      >
        <Field label="Code">
          <input
            name="protectionCode"
            readOnly={editing}
            required
            value={editing ? (option?.code ?? "") : undefined}
          />
        </Field>
        <Field label="Customer option">
          <input
            defaultValue={editing ? (option?.publicName ?? "") : ""}
            name="publicName"
            required
          />
        </Field>
        <Field label="Availability">
          <select
            defaultValue={editing ? option?.availability : "available"}
            name="availability"
          >
            <option value="available">Available</option>
            <option value="temporarily_unavailable">
              Temporarily Unavailable
            </option>
            <option value="discontinued">Discontinued</option>
          </select>
        </Field>
        <Field label="Base price USD (optional)">
          <input
            defaultValue={editing ? (option?.referenceBasePriceUsd ?? "") : ""}
            min="0"
            name="referenceBasePriceUsd"
            step="0.01"
            type="number"
          />
        </Field>
        <Field label="Material price per exact ft USD (optional)">
          <input
            defaultValue={
              editing ? (option?.referenceMaterialPricePerFootUsd ?? "") : ""
            }
            min="0"
            name="referenceMaterialPricePerFootUsd"
            step="0.01"
            type="number"
          />
        </Field>
        <Field label="Installation price per started ft USD (optional)">
          <input
            defaultValue={
              editing
                ? (option?.referenceInstallationPricePerStartedFootUsd ?? "")
                : ""
            }
            min="0"
            name="referenceInstallationPricePerStartedFootUsd"
            step="0.01"
            type="number"
          />
        </Field>
        <input
          name="specification"
          type="hidden"
          value={editing ? (option?.specification ?? "") : ""}
        />
        <input
          name="referencePriceUsd"
          type="hidden"
          value={editing ? (option?.referencePriceUsd ?? "") : ""}
        />
        <input
          name="isNoAdditionalProtection"
          type="hidden"
          value={editing && option?.isNoAdditionalProtection ? "true" : "false"}
        />
      </GlobalRegistryForm>
    </ReferenceDialog>
  );
}

export default function CatalogReferenceData({
  actionData,
  loaderData,
}: Route.ComponentProps) {
  const [editor, setEditor] = useState<ReferenceEditor>(null);
  const snapshot = loaderData.snapshot;
  if (!snapshot) {
    return (
      <div className="admin-shell" data-surface="admin">
        <AdminNavigation active="configurator" />
        <main className="reference-data-page">
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
      </div>
    );
  }

  const schedule = snapshot.assemblyEstimateSchedule;
  const clocking = snapshot.clockingConvention;
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="configurator" />
      <main className="reference-data-page">
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
        <header className="catalog-review-header">
          <div>
            <span className="eyebrow">Global configurator rules</span>
            <h1>总成参数配置</h1>
            <p>
              These settings apply across the customer configurator and future
              product catalog releases.
            </p>
          </div>
          <span className="release-status active">Global</span>
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

        <section className="reference-section">
          <div className="reference-section-heading">
            <div>
              <span className="eyebrow">Admin-only pricing</span>
              <h2>Assembly service price</h2>
              <p>
                Component prices come from Sales Offers. These service amounts
                are global reference-price inputs.
              </p>
            </div>
            <SectionActions onEdit={() => setEditor("schedule")} />
          </div>
          <dl className="reference-readonly-values">
            <div>
              <dt>Base service price</dt>
              <dd>
                {schedule?.assemblyServicePriceUsd === null || !schedule
                  ? "Not supplied"
                  : `$${schedule.assemblyServicePriceUsd.toFixed(2)}`}
              </dd>
            </div>
            <div>
              <dt>Per started ft</dt>
              <dd>
                {schedule?.assemblyServicePricePerStartedFootUsd === null ||
                !schedule
                  ? "Not supplied"
                  : `$${schedule.assemblyServicePricePerStartedFootUsd.toFixed(2)}`}
              </dd>
            </div>
            <div>
              <dt>Current version</dt>
              <dd>v{schedule?.recordVersion ?? 0}</dd>
            </div>
          </dl>
        </section>

        <section className="reference-section">
          <div className="reference-section-heading">
            <div>
              <span className="eyebrow">M01-M07</span>
              <h2>Measurement Methods</h2>
              <p>
                Customers review all methods and select the one they used. Not
                Sure routes the assembly to manual review.
              </p>
            </div>
            <SectionActions
              onAdd={() => setEditor("method-add")}
              onEdit={() => setEditor("method-edit")}
            />
          </div>
          <div className="reference-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Name</th>
                  <th>Diagram</th>
                  <th>Asset version</th>
                  <th>Version</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.measurementMethods.map((method) => (
                  <tr key={method.code}>
                    <td>{method.code}</td>
                    <td>{method.displayName}</td>
                    <td>{method.diagramAssetKey}</td>
                    <td>{method.diagramAssetVersion}</td>
                    <td>v{method.recordVersion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="reference-section">
          <div className="reference-section-heading">
            <div>
              <span className="eyebrow">M08</span>
              <h2>Clocking Convention</h2>
              <p>
                Any whole degree from 000-359 is accepted. Not Sure and tighter
                tolerance requests require manual review.
              </p>
            </div>
            <SectionActions onEdit={() => setEditor("clocking")} />
          </div>
          <dl className="reference-readonly-values">
            <div>
              <dt>Preset degrees</dt>
              <dd>{clocking?.presets.join(", ") || "Not supplied"}</dd>
            </div>
            <div>
              <dt>Standard tolerance</dt>
              <dd>
                {clocking
                  ? `±${clocking.standardToleranceDegrees}°`
                  : "Not supplied"}
              </dd>
            </div>
            <div>
              <dt>Renderer version</dt>
              <dd>{clocking?.rendererVersion || "Not supplied"}</dd>
            </div>
          </dl>
        </section>

        <section className="reference-section">
          <div className="reference-section-heading">
            <div>
              <span className="eyebrow">Assembly options</span>
              <h2>Installed Protection</h2>
              <p>
                Standard Export Packaging is mandatory and remains separate from
                these installed sleeves and guards.
              </p>
            </div>
            <SectionActions
              onAdd={() => setEditor("protection-add")}
              onEdit={() => setEditor("protection-edit")}
            />
          </div>
          <div className="reference-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Customer option</th>
                  <th>Availability</th>
                  <th>Length-based reference price</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.installedProtections.map((option) => (
                  <tr key={option.code}>
                    <td>{option.code}</td>
                    <td>{option.publicName}</td>
                    <td>{option.availability}</td>
                    <td>
                      {option.isNoAdditionalProtection
                        ? "$0.00"
                        : option.referenceBasePriceUsd === null ||
                            option.referenceMaterialPricePerFootUsd === null ||
                            option.referenceInstallationPricePerStartedFootUsd ===
                              null
                          ? "Not supplied"
                          : `$${option.referenceBasePriceUsd.toFixed(2)} + $${option.referenceMaterialPricePerFootUsd.toFixed(2)}/exact ft + $${option.referenceInstallationPricePerStartedFootUsd.toFixed(2)}/started ft`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {editor === "schedule" ? (
          <ScheduleEditor onClose={() => setEditor(null)} schedule={schedule} />
        ) : null}
        {editor === "method-edit" || editor === "method-add" ? (
          <MeasurementMethodEditor
            methods={snapshot.measurementMethods}
            mode={editor === "method-edit" ? "edit" : "add"}
            onClose={() => setEditor(null)}
          />
        ) : null}
        {editor === "clocking" ? (
          <ClockingEditor clocking={clocking} onClose={() => setEditor(null)} />
        ) : null}
        {editor === "protection-edit" || editor === "protection-add" ? (
          <ProtectionEditor
            mode={editor === "protection-edit" ? "edit" : "add"}
            onClose={() => setEditor(null)}
            protections={snapshot.installedProtections}
          />
        ) : null}
      </main>
    </div>
  );
}
