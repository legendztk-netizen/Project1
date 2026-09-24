import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import type { QuotedShipmentGroup } from "../domain/shipment-plan";
import { ReadyScheduleFields } from "./ready-schedule-fields";

interface PhysicalLine {
  id: string;
  sku: string;
  physicalQuantity: number;
  unit: string;
}

export function ShipmentGroupFields({
  lines,
  groups,
  charges,
  transportMethod,
  showReadySchedule = false,
  standardOnly = false,
  onDirty,
}: {
  lines: readonly PhysicalLine[];
  groups?: readonly QuotedShipmentGroup[];
  charges: {
    freight: number;
    insurance: number;
    dutiesImport: number;
  };
  transportMethod: string;
  showReadySchedule?: boolean;
  standardOnly?: boolean;
  onDirty?: () => void;
}) {
  const [groupCount, setGroupCount] = useState(
    Math.max(2, groups?.length ?? 2),
  );
  const changeCount = (increment: number) => {
    setGroupCount((count) => count + increment);
    onDirty?.();
  };
  const usd = (cents: number) => (cents / 100).toFixed(2);
  return (
    <div className="shipment-group-editor">
      <div className="shipment-group-editor-heading">
        <h2>分批数量与费用</h2>
        <div className="shipment-group-editor-actions">
          <button
            type="button"
            className="button button-secondary"
            title="减少一批"
            disabled={groupCount <= 2}
            onClick={() => changeCount(-1)}
          >
            <Minus size={16} aria-hidden="true" /> 减少一批
          </button>
          <button
            type="button"
            className="button button-secondary"
            title="增加一批"
            disabled={groupCount >= 20}
            onClick={() => changeCount(1)}
          >
            <Plus size={16} aria-hidden="true" /> 增加一批
          </button>
        </div>
      </div>
      <input type="hidden" name="shipmentGroupCount" value={groupCount} />
      {Array.from({ length: groupCount }, (_, groupIndex) => {
        const group = groups?.[groupIndex];
        return (
          <section key={groupIndex} className="shipment-group-editor-row">
            <h3>第 {groupIndex + 1} 批</h3>
            <input
              type="hidden"
              name={`groupId-${groupIndex}`}
              value={group?.id ?? `batch-${groupIndex + 1}`}
            />
            <div className="shipment-group-editor-grid">
              <label>
                批次名称
                <input
                  name={`groupLabel-${groupIndex}`}
                  defaultValue={group?.label ?? `Batch ${groupIndex + 1}`}
                  required
                />
              </label>
              <label>
                运输方式
                <input
                  name={`groupTransport-${groupIndex}`}
                  defaultValue={group?.transportMethod ?? transportMethod}
                  required
                />
              </label>
              {lines.map((line, lineIndex) => (
                <label key={line.id}>
                  {line.sku} · {line.unit}（总数 {line.physicalQuantity}）
                  <input
                    type="number"
                    min="0"
                    step="1"
                    name={`groupQty-${groupIndex}-${lineIndex}`}
                    defaultValue={
                      group?.allocations.find(
                        (allocation) => allocation.lineId === line.id,
                      )?.physicalQuantity ??
                      (groupIndex === 0 ? line.physicalQuantity : 0)
                    }
                    required
                  />
                </label>
              ))}
              {(
                [
                  ["groupFreight", "freightCents", "freight", "本批运费 USD"],
                  [
                    "groupInsurance",
                    "insuranceCents",
                    "insurance",
                    "本批保险 USD",
                  ],
                  [
                    "groupDuties",
                    "dutiesImportCents",
                    "dutiesImport",
                    "本批进口费用 USD",
                  ],
                ] as const
              ).map(([field, groupKey, chargeKey, label]) => (
                <label key={field}>
                  {label}
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    name={`${field}-${groupIndex}`}
                    defaultValue={usd(
                      group?.[groupKey] ??
                        (groupIndex === 0 ? charges[chargeKey] : 0),
                    )}
                    required
                  />
                </label>
              ))}
            </div>
            {showReadySchedule && (
              <ReadyScheduleFields
                prefix={`groupReady-${groupIndex}`}
                value={group?.readySchedule}
                standardOnly={standardOnly}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}
