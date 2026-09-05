import {
  isMeasurementMethodCode,
  type AssemblyEstimateSchedule,
  type ClockingConvention,
  type ConfiguratorReferenceSnapshot,
  type HoseEndEndpointAssignment,
  type InstalledProtection,
  type InstalledProtectionRule,
  type LengthMeasurementMapping,
  type LengthMeasurementMethod,
  type MeasurementEndpointClass,
  type MeasurementMethodCode,
} from "../domain/configurator-reference";

export type ConfiguratorRegistryType =
  | "assembly_estimate_schedule"
  | "clocking_convention"
  | "endpoint_assignment"
  | "endpoint_class"
  | "installed_protection"
  | "measurement_mapping"
  | "measurement_method"
  | "protection_rule";

export interface ConfiguratorRegistryEntryMutation {
  actorId: string;
  auditEventId: string;
  entryKey: string;
  payload: Record<string, unknown>;
  registryType: ConfiguratorRegistryType;
  releaseId: string;
  updatedAt: string;
}

export type GlobalConfiguratorRegistryType =
  | "assembly_estimate_schedule"
  | "clocking_convention"
  | "installed_protection"
  | "measurement_method";

export interface GlobalConfiguratorRegistryEntryMutation {
  actorId: string;
  auditEventId: string;
  entryKey: string;
  expectedRecordVersion: number;
  payload: Record<string, unknown>;
  registryType: GlobalConfiguratorRegistryType;
  updatedAt: string;
}

const globalConfiguratorRegistryTypes = new Set<ConfiguratorRegistryType>([
  "assembly_estimate_schedule",
  "clocking_convention",
  "installed_protection",
  "measurement_method",
]);

interface RegistryRow {
  entry_key: string;
  payload_json: string;
  record_version: number;
  registry_type: ConfiguratorRegistryType;
}

interface ReleaseRow {
  id: string;
  release_number: string;
  status: "draft" | "published" | "superseded";
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Configurator registry payload must be an object");
  }
  return value as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, key: string) {
  const field = value[key];
  if (typeof field !== "string" || field.trim() === "") {
    throw new Error(`Configurator registry field ${key} is invalid`);
  }
  return field;
}

function nullableStringField(value: Record<string, unknown>, key: string) {
  const field = value[key];
  if (field === null) return null;
  if (typeof field !== "string")
    throw new Error(`Configurator registry field ${key} is invalid`);
  return field;
}

function optionalStringField(
  value: Record<string, unknown>,
  key: string,
): string | null {
  return value[key] === undefined ? null : stringField(value, key);
}

function numberField(value: Record<string, unknown>, key: string) {
  const field = value[key];
  if (typeof field !== "number" || !Number.isFinite(field)) {
    throw new Error(`Configurator registry field ${key} is invalid`);
  }
  return field;
}

function nullableNumberField(value: Record<string, unknown>, key: string) {
  const field = value[key];
  if (field === null) return null;
  return numberField(value, key);
}

function nonNegativeNullableNumberField(
  value: Record<string, unknown>,
  key: string,
) {
  const field = nullableNumberField(value, key);
  if (field !== null && field < 0) {
    throw new Error(`Configurator registry field ${key} is invalid`);
  }
  return field;
}

function exactStringField<const TExpected extends string>(
  value: Record<string, unknown>,
  key: string,
  expected: TExpected,
) {
  const field = stringField(value, key);
  if (field !== expected) {
    throw new Error(`Configurator registry field ${key} is invalid`);
  }
  return expected;
}

function booleanField(value: Record<string, unknown>, key: string) {
  const field = value[key];
  if (typeof field !== "boolean")
    throw new Error(`Configurator registry field ${key} is invalid`);
  return field;
}

function parsePayload(row: RegistryRow) {
  try {
    return record(JSON.parse(row.payload_json));
  } catch {
    throw new Error(
      `Configurator registry ${row.registry_type}/${row.entry_key} is invalid`,
    );
  }
}

function methodCode(value: string): MeasurementMethodCode {
  if (!isMeasurementMethodCode(value))
    throw new Error(`Invalid measurement method ${value}`);
  return value;
}

function endpointClass(row: RegistryRow): MeasurementEndpointClass {
  const value = parsePayload(row);
  const code = stringField(value, "code");
  if (row.entry_key !== code) {
    throw new Error("Measurement Endpoint Class key does not match its code");
  }
  return {
    code,
    displayName: stringField(value, "displayName"),
    recordVersion: row.record_version,
    referenceKind: stringField(value, "referenceKind"),
  };
}

function endpointAssignment(row: RegistryRow): HoseEndEndpointAssignment {
  const value = parsePayload(row);
  const hoseEndSku = stringField(value, "hoseEndSku");
  if (row.entry_key !== hoseEndSku) {
    throw new Error("Hose End assignment key does not match its SKU");
  }
  return {
    endpointClassCode: stringField(value, "endpointClassCode"),
    hoseEndSku,
  };
}

function measurementMethod(row: RegistryRow): LengthMeasurementMethod {
  const value = parsePayload(row);
  const code = methodCode(stringField(value, "code"));
  if (row.entry_key !== code) {
    throw new Error("Measurement Method key does not match its code");
  }
  const storedDiagramAssetKey = stringField(value, "diagramAssetKey");
  const storedDiagramAssetVersion = optionalStringField(
    value,
    "diagramAssetVersion",
  );
  return {
    code,
    // Releases created before migration 0014 used the ImageGen manifest's
    // provisional .png names. The committed guide assets are the reviewed
    // .jpg files, so this adapter keeps those immutable releases readable.
    diagramAssetKey:
      storedDiagramAssetVersion === null
        ? storedDiagramAssetKey.replace(/\.png$/u, ".jpg")
        : storedDiagramAssetKey,
    diagramAssetVersion: storedDiagramAssetVersion ?? "1.0.1-draft",
    displayName: stringField(value, "displayName"),
    endpointRule: stringField(value, "endpointRule"),
    overlayVersion: stringField(value, "overlayVersion"),
    recordVersion: row.record_version,
  };
}

function measurementMapping(row: RegistryRow): LengthMeasurementMapping {
  const value = parsePayload(row);
  const guidanceStatus = stringField(value, "guidanceStatus");
  if (guidanceStatus !== "guided" && guidanceStatus !== "manual_quote_only") {
    throw new Error(`Invalid guidance status ${guidanceStatus}`);
  }
  const rawMethod = nullableStringField(value, "methodCode");
  if (guidanceStatus === "guided" && rawMethod === null) {
    throw new Error("Guided measurement mappings require a method");
  }
  const endAClassCode = stringField(value, "endAClassCode");
  const endBClassCode = stringField(value, "endBClassCode");
  const id = stringField(value, "id");
  const pairKey = `${endAClassCode}:${endBClassCode}`;
  if (row.entry_key !== pairKey || id !== pairKey) {
    throw new Error("Measurement Mapping key does not match its ordered pair");
  }
  return {
    endAClassCode,
    endBClassCode,
    guidanceStatus,
    id,
    methodCode: rawMethod === null ? null : methodCode(rawMethod),
  };
}

function clockingConvention(row: RegistryRow): ClockingConvention {
  const value = parsePayload(row);
  if (row.entry_key !== "M08") {
    throw new Error("Clocking Convention key must be M08");
  }
  const presets = value.presets;
  if (
    !Array.isArray(presets) ||
    presets.length === 0 ||
    presets.some(
      (preset) =>
        !Number.isInteger(preset) || Number(preset) < 0 || Number(preset) > 359,
    )
  ) {
    throw new Error("Clocking presets are invalid");
  }
  const minimum = numberField(value, "acceptedMinimumDegrees");
  const maximum = numberField(value, "acceptedMaximumDegrees");
  const tolerance = numberField(value, "standardToleranceDegrees");
  if (minimum !== 0 || maximum !== 359 || tolerance <= 0) {
    throw new Error("Clocking range or tolerance is invalid");
  }
  return {
    acceptedMaximumDegrees: maximum,
    acceptedMinimumDegrees: minimum,
    code: exactStringField(value, "code", "M08"),
    measurementDirection: exactStringField(
      value,
      "measurementDirection",
      "clockwise",
    ),
    notSureOutcome: exactStringField(value, "notSureOutcome", "manual_review"),
    presets: presets as number[],
    recordVersion: row.record_version,
    rendererVersion: stringField(value, "rendererVersion"),
    standardToleranceDegrees: tolerance,
    tighterToleranceOutcome: exactStringField(
      value,
      "tighterToleranceOutcome",
      "manual_review",
    ),
    viewDirection: exactStringField(
      value,
      "viewDirection",
      "end_a_toward_end_b",
    ),
    zeroReference: exactStringField(
      value,
      "zeroReference",
      "end_b_at_6_oclock",
    ),
  };
}

function installedProtection(row: RegistryRow): InstalledProtection {
  const value = parsePayload(row);
  const code = stringField(value, "code");
  if (row.entry_key !== code) {
    throw new Error("Installed Protection key does not match its code");
  }
  const availability = stringField(value, "availability");
  if (
    availability !== "available" &&
    availability !== "temporarily_unavailable" &&
    availability !== "discontinued"
  ) {
    throw new Error(`Invalid protection availability ${availability}`);
  }
  return {
    availability,
    code,
    currency: exactStringField(value, "currency", "USD"),
    isNoAdditionalProtection: booleanField(value, "isNoAdditionalProtection"),
    publicName: stringField(value, "publicName"),
    recordVersion: row.record_version,
    referenceBasePriceUsd:
      value.referenceBasePriceUsd === undefined
        ? null
        : nonNegativeNullableNumberField(value, "referenceBasePriceUsd"),
    referenceInstallationPricePerStartedFootUsd:
      value.referenceInstallationPricePerStartedFootUsd === undefined
        ? null
        : nonNegativeNullableNumberField(
            value,
            "referenceInstallationPricePerStartedFootUsd",
          ),
    referenceMaterialPricePerFootUsd:
      value.referenceMaterialPricePerFootUsd === undefined
        ? null
        : nonNegativeNullableNumberField(
            value,
            "referenceMaterialPricePerFootUsd",
          ),
    referencePriceUsd: nonNegativeNullableNumberField(
      value,
      "referencePriceUsd",
    ),
    specification: stringField(value, "specification"),
  };
}

function protectionRule(row: RegistryRow): InstalledProtectionRule {
  const value = parsePayload(row);
  const id = stringField(value, "id");
  if (row.entry_key !== id) {
    throw new Error("Installed Protection Rule key does not match its id");
  }
  return {
    applicationCode: nullableStringField(value, "applicationCode"),
    hoseSeries: nullableStringField(value, "hoseSeries"),
    id,
    requiresProtection: booleanField(value, "requiresProtection"),
  };
}

function estimateSchedule(row: RegistryRow): AssemblyEstimateSchedule {
  const value = parsePayload(row);
  if (row.entry_key !== "DEFAULT") {
    throw new Error("Assembly Estimate Schedule key must be DEFAULT");
  }
  return {
    assemblyServicePricePerStartedFootUsd:
      value.assemblyServicePricePerStartedFootUsd === undefined
        ? null
        : nonNegativeNullableNumberField(
            value,
            "assemblyServicePricePerStartedFootUsd",
          ),
    assemblyServicePriceUsd: nonNegativeNullableNumberField(
      value,
      "assemblyServicePriceUsd",
    ),
    currency: exactStringField(value, "currency", "USD"),
    ferrulePriceSource: exactStringField(
      value,
      "ferrulePriceSource",
      "catalog_sales_offer",
    ),
    hoseEndPriceSource: exactStringField(
      value,
      "hoseEndPriceSource",
      "catalog_sales_offer",
    ),
    hosePriceSource: exactStringField(
      value,
      "hosePriceSource",
      "catalog_sales_offer_per_ft",
    ),
    protectionPriceSource: exactStringField(
      value,
      "protectionPriceSource",
      "installed_protection_registry",
    ),
    recordVersion: row.record_version,
  };
}

function oneOrNull<T>(values: T[]) {
  return values.length === 1 ? values[0] : null;
}

function snapshotFromRows(release: ReleaseRow, rows: RegistryRow[]) {
  const byType = (type: ConfiguratorRegistryType) =>
    rows.filter((row) => row.registry_type === type);
  return {
    assemblyEstimateSchedule: oneOrNull(
      byType("assembly_estimate_schedule").map(estimateSchedule),
    ),
    clockingConvention: oneOrNull(
      byType("clocking_convention").map(clockingConvention),
    ),
    endpointAssignments: byType("endpoint_assignment").map(endpointAssignment),
    endpointClasses: byType("endpoint_class").map(endpointClass),
    installedProtectionRules: byType("protection_rule").map(protectionRule),
    installedProtections: byType("installed_protection").map(
      installedProtection,
    ),
    measurementMappings: byType("measurement_mapping").map(measurementMapping),
    measurementMethods: byType("measurement_method").map(measurementMethod),
    release: {
      id: release.id,
      releaseNumber: release.release_number,
      status: release.status,
    },
  } satisfies ConfiguratorReferenceSnapshot;
}

export function createD1ConfiguratorReferenceRepository(database: D1Database) {
  async function findRelease(releaseId?: string | null, draftOnly = false) {
    const filters = [
      draftOnly
        ? `status = 'draft' AND (
             (SELECT release_id FROM catalog_active_release WHERE singleton = 1) IS NULL
             OR created_at > COALESCE(
               (
                 SELECT active_release.created_at
                 FROM catalog_active_release active_pointer
                 INNER JOIN catalog_releases active_release
                   ON active_release.id = active_pointer.release_id
                 WHERE active_pointer.singleton = 1
               ),
               ''
             )
           )`
        : "1 = 1",
    ];
    const statement = database.prepare(
      `SELECT id, release_number, status FROM catalog_releases
       WHERE ${filters.join(" AND ")} ${releaseId ? "AND id = ?" : ""}
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    );
    return (
      releaseId ? statement.bind(releaseId) : statement
    ).first<ReleaseRow>();
  }

  async function findSnapshot(releaseId: string) {
    const release = await findRelease(releaseId);
    if (!release) return null;
    const [releaseRows, globalRows] = await Promise.all([
      database
        .prepare(
          `SELECT registry_type, entry_key, payload_json, record_version
           FROM catalog_configurator_registry_entries
           WHERE release_id = ?
           ORDER BY registry_type, entry_key`,
        )
        .bind(release.id)
        .all<RegistryRow>(),
      database
        .prepare(
          `SELECT registry_type, entry_key, payload_json, record_version
           FROM configurator_global_registry_entries
           ORDER BY registry_type, entry_key`,
        )
        .all<RegistryRow>(),
    ]);
    const rows = [
      ...releaseRows.results.filter(
        (row) => !globalConfiguratorRegistryTypes.has(row.registry_type),
      ),
      ...globalRows.results,
    ];
    return snapshotFromRows(release, rows);
  }

  return {
    async findActiveSnapshot() {
      const release = await database
        .prepare(
          `SELECT r.id, r.release_number, r.status
           FROM catalog_active_release a
           INNER JOIN catalog_releases r ON r.id = a.release_id
           WHERE a.singleton = 1 AND r.status = 'published'`,
        )
        .first<ReleaseRow>();
      return release ? findSnapshot(release.id) : null;
    },

    async findDraftSnapshot(releaseId?: string | null) {
      const release = await findRelease(releaseId, true);
      return release ? findSnapshot(release.id) : null;
    },

    findSnapshot,

    async listDraftHoseEnds(releaseId: string) {
      const result = await database
        .prepare(
          `SELECT e.sku, series.interface_family, series.connection_standard,
                  series.angle, series.sealing_form, e.thread
           FROM catalog_releases r
           INNER JOIN catalog_hose_ends e ON e.import_id = r.source_import_id
           INNER JOIN catalog_hose_end_series series
             ON series.import_id = e.import_id
            AND series.series_code = e.fitting_series
           WHERE r.id = ? AND r.status = 'draft'
           ORDER BY series.interface_family, e.sku`,
        )
        .bind(releaseId)
        .all<{
          angle: string;
          connection_standard: string;
          interface_family: string;
          sealing_form: string;
          sku: string;
          thread: string;
        }>();
      return result.results;
    },

    async saveDraftEntry(operation: ConfiguratorRegistryEntryMutation) {
      const payloadJson = JSON.stringify(operation.payload);
      await database.batch([
        database
          .prepare(
            `INSERT INTO catalog_configurator_registry_entries (
               release_id, registry_type, entry_key, payload_json,
               record_version, updated_at
             )
             SELECT id, ?, ?, ?, 1, ? FROM catalog_releases
             WHERE id = ? AND status = 'draft'
             ON CONFLICT (release_id, registry_type, entry_key) DO UPDATE SET
               payload_json = excluded.payload_json,
               record_version = record_version + 1,
               updated_at = excluded.updated_at`,
          )
          .bind(
            operation.registryType,
            operation.entryKey,
            payloadJson,
            operation.updatedAt,
            operation.releaseId,
          ),
        database
          .prepare(
            `UPDATE catalog_releases
             SET version = version + 1
             WHERE id = ? AND status = 'draft'`,
          )
          .bind(operation.releaseId),
        database
          .prepare(
            `INSERT INTO admin_audit_events (
               id, event_type, entity_type, entity_id,
               actor_id, payload_json, occurred_at
             )
             SELECT ?, 'configurator_registry.saved',
                    'configurator_registry_entry', ?, ?, ?, ?
             FROM catalog_releases
             WHERE id = ? AND status = 'draft'`,
          )
          .bind(
            operation.auditEventId,
            `${operation.releaseId}:${operation.registryType}:${operation.entryKey}`,
            operation.actorId,
            JSON.stringify({
              entryKey: operation.entryKey,
              registryType: operation.registryType,
              releaseId: operation.releaseId,
            }),
            operation.updatedAt,
            operation.releaseId,
          ),
      ]);
      const saved = await database
        .prepare(`SELECT 1 AS found FROM admin_audit_events WHERE id = ?`)
        .bind(operation.auditEventId)
        .first<{ found: number }>();
      if (!saved) throw new Error("Draft registry entry was not saved");
    },

    async saveGlobalEntry(operation: GlobalConfiguratorRegistryEntryMutation) {
      const current = await database
        .prepare(
          `SELECT record_version
           FROM configurator_global_registry_entries
           WHERE registry_type = ? AND entry_key = ?`,
        )
        .bind(operation.registryType, operation.entryKey)
        .first<{ record_version: number }>();
      if ((current?.record_version ?? 0) !== operation.expectedRecordVersion) {
        throw new Error(
          "This global setting changed after the editor was opened. Reload and try again.",
        );
      }

      const payloadJson = JSON.stringify(operation.payload);
      await database.batch([
        database
          .prepare(
            `INSERT INTO configurator_global_registry_entries (
               registry_type, entry_key, payload_json, record_version,
               updated_at, updated_by, last_operation_id
             ) VALUES (?, ?, ?, 1, ?, ?, ?)
             ON CONFLICT (registry_type, entry_key) DO UPDATE SET
               payload_json = excluded.payload_json,
               record_version = record_version + 1,
               updated_at = excluded.updated_at,
               updated_by = excluded.updated_by,
               last_operation_id = excluded.last_operation_id
             WHERE configurator_global_registry_entries.record_version = ?`,
          )
          .bind(
            operation.registryType,
            operation.entryKey,
            payloadJson,
            operation.updatedAt,
            operation.actorId,
            operation.auditEventId,
            operation.expectedRecordVersion,
          ),
        database
          .prepare(
            `INSERT INTO configurator_global_registry_entry_versions (
               operation_id, registry_type, entry_key, payload_json,
               record_version, changed_at, changed_by
             )
             SELECT last_operation_id, registry_type, entry_key, payload_json,
                    record_version, updated_at, updated_by
             FROM configurator_global_registry_entries
             WHERE last_operation_id = ?`,
          )
          .bind(operation.auditEventId),
        database
          .prepare(
            `INSERT INTO admin_audit_events (
               id, event_type, entity_type, entity_id,
               actor_id, payload_json, occurred_at
             )
             SELECT ?, 'configurator_global_registry.saved',
                    'configurator_global_registry_entry', ?, ?, ?, ?
             FROM configurator_global_registry_entries
             WHERE last_operation_id = ?`,
          )
          .bind(
            operation.auditEventId,
            `${operation.registryType}:${operation.entryKey}`,
            operation.actorId,
            JSON.stringify({
              entryKey: operation.entryKey,
              expectedRecordVersion: operation.expectedRecordVersion,
              registryType: operation.registryType,
            }),
            operation.updatedAt,
            operation.auditEventId,
          ),
      ]);
      const saved = await database
        .prepare(
          `SELECT record_version
           FROM configurator_global_registry_entries
           WHERE registry_type = ? AND entry_key = ? AND last_operation_id = ?`,
        )
        .bind(
          operation.registryType,
          operation.entryKey,
          operation.auditEventId,
        )
        .first<{ record_version: number }>();
      if (!saved) {
        throw new Error(
          "This global setting changed while it was being saved. Reload and try again.",
        );
      }
      return { recordVersion: saved.record_version };
    },
  };
}
