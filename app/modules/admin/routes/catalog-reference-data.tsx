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
  if (!value) throw new Error(`缺少必填字段：${key}`);
  return value;
}

function normalizedCode(form: FormData, key: string) {
  const value = requiredText(form, key)
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "");
  if (!value) throw new Error(`字段格式无效：${key}`);
  return value;
}

function nullablePrice(form: FormData, key: string) {
  const raw = textValue(form, key);
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`${key} 必须是非负的美元金额`);
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
    throw new Error("时钟角预设必须是 000 至 359 的整数角度");
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
      throw new Error("测量方法必须为 M01-M07；M08 专用于时钟角");
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
      throw new Error("引导状态无效");
    }
    const methodCode =
      guidanceStatus === "guided"
        ? requiredText(form, "methodCode").toUpperCase()
        : null;
    if (methodCode !== null && !isMeasurementMethodCode(methodCode)) {
      throw new Error("引导映射必须选择有效的测量方法");
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
      throw new Error("标准时钟角公差必须大于零");
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
      throw new Error("安装防护件的供应状态无效");
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
      throw new Error("防护规则必须指定胶管系列或应用场景");
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
  throw new Error("未知的总成参数配置操作");
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
    throw new Response("不允许使用此请求方法", { status: 405 });
  const form = await request.formData();
  const auditContext = {
    ipAddress: request.headers.get("cf-connecting-ip") ?? "local",
    requestCorrelationId:
      request.headers.get("x-request-id") ??
      request.headers.get("cf-ray") ??
      `local-${crypto.randomUUID()}`,
  };
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
        throw new Error("此设置不能作为全局设置修改");
      }
      const expectedRecordVersion = Number(
        requiredText(form, "expectedRecordVersion"),
      );
      if (
        !Number.isInteger(expectedRecordVersion) ||
        expectedRecordVersion < 0
      ) {
        throw new Error("全局设置版本无效");
      }
      await repository.saveGlobalEntry({
        actorId: adminIdentity.id,
        auditEventId: crypto.randomUUID(),
        entryKey: mutation.entryKey,
        expectedRecordVersion,
        ipAddress: auditContext.ipAddress,
        payload: mutation.payload,
        requestCorrelationId: auditContext.requestCorrelationId,
        registryType: mutation.registryType,
        updatedAt: new Date().toISOString(),
      });
      return redirect(
        `/admin/catalog/reference-data?saved=${encodeURIComponent(mutation.registryType)}`,
      );
    }

    const releaseId = requiredText(form, "releaseId");
    const snapshot = await repository.findDraftSnapshot(releaseId);
    if (!snapshot) throw new Error("未找到目录草稿版本");

    if (mutation.registryType === "endpoint_assignment") {
      const hoseEndSku = String(mutation.payload.hoseEndSku);
      const endpointClassCode = String(mutation.payload.endpointClassCode);
      const hoseEnds = await repository.listDraftHoseEnds(releaseId);
      if (!hoseEnds.some((hoseEnd) => hoseEnd.sku === hoseEndSku)) {
        throw new Error("接头 SKU 不属于此目录草稿版本");
      }
      if (
        !snapshot.endpointClasses.some(
          (endpointClass) => endpointClass.code === endpointClassCode,
        )
      ) {
        throw new Error("测量端点类别尚未登记");
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
          throw new Error(`缺少测量端点类别 ${classCode}`);
        }
      }
      if (
        methodCode !== null &&
        !snapshot.measurementMethods.some(
          (method) => method.code === methodCode,
        )
      ) {
        throw new Error(`缺少测量方法 ${String(methodCode)}`);
      }
    }

    await repository.saveDraftEntry({
      actorId: adminIdentity.id,
      auditEventId: crypto.randomUUID(),
      ...mutation,
      ipAddress: auditContext.ipAddress,
      releaseId,
      requestCorrelationId: auditContext.requestCorrelationId,
      updatedAt: new Date().toISOString(),
    });
    return redirect(
      `/admin/catalog/reference-data?release=${encodeURIComponent(releaseId)}&saved=${encodeURIComponent(mutation.registryType)}`,
    );
  } catch (error) {
    return {
      formError: error instanceof Error ? error.message : "总成参数未保存",
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
          取消
        </button>
        <button
          className="button button-primary"
          disabled={saving}
          type="submit"
        >
          <Save size={16} /> {saving ? "正在应用…" : "应用全局设置"}
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
            aria-label="关闭编辑器"
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
    <ReferenceDialog onClose={onClose} title="编辑总成服务参考价">
      <GlobalRegistryForm
        expectedRecordVersion={schedule?.recordVersion ?? 0}
        intent="save_estimate_schedule"
        onCancel={onClose}
      >
        <Field label="总成基础服务价 USD（可选）">
          <input
            defaultValue={schedule?.assemblyServicePriceUsd ?? ""}
            min="0"
            name="assemblyServicePriceUsd"
            step="0.01"
            type="number"
          />
        </Field>
        <Field label="每起算英尺服务价 USD（可选）">
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
          <span>测量方法</span>
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
        <Field label="方法代码">
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
        <Field label="显示名称">
          <input
            defaultValue={editing ? (method?.displayName ?? "") : ""}
            name="displayName"
            required
          />
        </Field>
        <Field label="端点规则">
          <input
            defaultValue={editing ? (method?.endpointRule ?? "") : ""}
            name="endpointRule"
            required
          />
        </Field>
        <Field label="示意图资源键">
          <input
            defaultValue={editing ? (method?.diagramAssetKey ?? "") : ""}
            name="diagramAssetKey"
            placeholder="M07-example.jpg"
            required
          />
        </Field>
        <Field label="示意图资源版本">
          <input
            defaultValue={
              editing ? (method?.diagramAssetVersion ?? "1.0.0") : "1.0.0"
            }
            name="diagramAssetVersion"
            required
          />
        </Field>
        <Field label="标注层版本">
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
    <ReferenceDialog onClose={onClose} title="编辑 M08 时钟角规则">
      <GlobalRegistryForm
        expectedRecordVersion={clocking?.recordVersion ?? 0}
        intent="save_clocking"
        onCancel={onClose}
      >
        <Field label="预设角度">
          <input
            defaultValue={clocking?.presets.join(", ") ?? ""}
            name="presets"
            required
          />
        </Field>
        <Field label="标准公差（度）">
          <input
            defaultValue={clocking?.standardToleranceDegrees ?? 3}
            min="0.1"
            name="standardToleranceDegrees"
            required
            step="0.1"
            type="number"
          />
        </Field>
        <Field label="渲染器版本">
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
      title={editing ? "编辑总成选项" : "新增总成选项"}
    >
      {editing ? (
        <label className="reference-dialog-selector">
          <span>安装防护件</span>
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
        <Field label="代码">
          <input
            name="protectionCode"
            readOnly={editing}
            required
            value={editing ? (option?.code ?? "") : undefined}
          />
        </Field>
        <Field label="客户选项">
          <input
            defaultValue={editing ? (option?.publicName ?? "") : ""}
            name="publicName"
            required
          />
        </Field>
        <Field label="供应状态">
          <select
            defaultValue={editing ? option?.availability : "available"}
            name="availability"
          >
            <option value="available">可用</option>
            <option value="temporarily_unavailable">暂不可用</option>
            <option value="discontinued">已停产</option>
          </select>
        </Field>
        <Field label="基础价 USD（可选）">
          <input
            defaultValue={editing ? (option?.referenceBasePriceUsd ?? "") : ""}
            min="0"
            name="referenceBasePriceUsd"
            step="0.01"
            type="number"
          />
        </Field>
        <Field label="每实际英尺材料价 USD（可选）">
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
        <Field label="每起算英尺安装价 USD（可选）">
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
            <ArrowLeft size={17} /> 返回总览
          </Link>
          <div className="empty-state">
            <Database size={24} />
            <div>
              <strong>没有可编辑的目录版本</strong>
              <p>请先导入工作簿并创建目录草稿版本。</p>
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
            <ArrowLeft size={17} /> 返回总览
          </Link>
          <Link
            className="button button-secondary"
            to="/assembly-measurement-guide"
          >
            <Ruler size={17} /> 查看客户测量指南
          </Link>
        </div>
        <header className="catalog-review-header">
          <div>
            <span className="eyebrow">全局配置器规则</span>
            <h1>总成参数配置</h1>
            <p>这些设置适用于客户配置器及后续所有产品目录版本。</p>
          </div>
          <span className="release-status active">全局</span>
        </header>

        {loaderData.saved ? (
          <p className="catalog-update-success" role="status">
            <ShieldCheck size={17} /> 已保存{" "}
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
              <span className="eyebrow">仅管理员可见的定价</span>
              <h2>总成服务参考价</h2>
              <p>零部件价格来自销售报价；以下服务金额作为全局参考价输入。</p>
            </div>
            <SectionActions onEdit={() => setEditor("schedule")} />
          </div>
          <dl className="reference-readonly-values">
            <div>
              <dt>基础服务价</dt>
              <dd>
                {schedule?.assemblyServicePriceUsd === null || !schedule
                  ? "未提供"
                  : `$${schedule.assemblyServicePriceUsd.toFixed(2)}`}
              </dd>
            </div>
            <div>
              <dt>每起算英尺</dt>
              <dd>
                {schedule?.assemblyServicePricePerStartedFootUsd === null ||
                !schedule
                  ? "未提供"
                  : `$${schedule.assemblyServicePricePerStartedFootUsd.toFixed(2)}`}
              </dd>
            </div>
            <div>
              <dt>当前版本</dt>
              <dd>v{schedule?.recordVersion ?? 0}</dd>
            </div>
          </dl>
        </section>

        <section className="reference-section">
          <div className="reference-section-heading">
            <div>
              <span className="eyebrow">M01-M07</span>
              <h2>测量方法</h2>
              <p>
                客户查看全部方法并选择实际使用的方法；选择 Not
                Sure（不确定）时转人工审核。
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
                  <th>方法</th>
                  <th>名称</th>
                  <th>示意图</th>
                  <th>资源版本</th>
                  <th>记录版本</th>
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
              <h2>时钟角规则</h2>
              <p>
                接受 000-359 的任意整数角度；Not
                Sure（不确定）和更严公差要求转人工审核。
              </p>
            </div>
            <SectionActions onEdit={() => setEditor("clocking")} />
          </div>
          <dl className="reference-readonly-values">
            <div>
              <dt>预设角度</dt>
              <dd>{clocking?.presets.join(", ") || "未提供"}</dd>
            </div>
            <div>
              <dt>标准公差</dt>
              <dd>
                {clocking ? `±${clocking.standardToleranceDegrees}°` : "未提供"}
              </dd>
            </div>
            <div>
              <dt>渲染器版本</dt>
              <dd>{clocking?.rendererVersion || "未提供"}</dd>
            </div>
          </dl>
        </section>

        <section className="reference-section">
          <div className="reference-section-heading">
            <div>
              <span className="eyebrow">总成选项</span>
              <h2>安装防护件</h2>
              <p>标准出口包装为必选项，并与这些套管和护具选项分别管理。</p>
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
                  <th>代码</th>
                  <th>客户选项</th>
                  <th>供应状态</th>
                  <th>按长度计算的参考价</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.installedProtections.map((option) => (
                  <tr key={option.code}>
                    <td>{option.code}</td>
                    <td>{option.publicName}</td>
                    <td>
                      {{
                        available: "可用",
                        discontinued: "已停产",
                        temporarily_unavailable: "暂不可用",
                      }[option.availability] ?? option.availability}
                    </td>
                    <td>
                      {option.isNoAdditionalProtection
                        ? "$0.00"
                        : option.referenceBasePriceUsd === null ||
                            option.referenceMaterialPricePerFootUsd === null ||
                            option.referenceInstallationPricePerStartedFootUsd ===
                              null
                          ? "未提供"
                          : `$${option.referenceBasePriceUsd.toFixed(2)} + $${option.referenceMaterialPricePerFootUsd.toFixed(2)}/实际英尺 + $${option.referenceInstallationPricePerStartedFootUsd.toFixed(2)}/起算英尺`}
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
