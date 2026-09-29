import { useState } from "react";
import type { ReadyScheduleBasis } from "../domain/ready-schedule";

export function ReadyScheduleFields({
  prefix,
  value,
  standardOnly,
}: {
  prefix: string;
  value?: ReadyScheduleBasis | null;
  standardOnly: boolean;
}) {
  const [kind, setKind] = useState<ReadyScheduleBasis["kind"]>(
    value?.kind ?? "china_business_days",
  );
  return (
    <div className="shipment-ready-schedule-fields">
      <label>
        预计可发货日期依据
        <select
          name={`${prefix}Kind`}
          value={kind}
          onChange={(event) =>
            setKind(event.target.value as ReadyScheduleBasis["kind"])
          }
          required
        >
          <option value="china_business_days">订单确认后中国履约工作日</option>
          <option value="fixed_date">约定固定日期</option>
        </select>
      </label>
      {kind === "china_business_days" ? (
        <label>
          履约工作日数
          <input
            type="number"
            name={`${prefix}Days`}
            min="1"
            max="365"
            step="1"
            defaultValue={
              value?.kind === "china_business_days"
                ? value.days
                : standardOnly
                  ? 10
                  : ""
            }
            required
          />
        </label>
      ) : (
        <label>
          约定可发货日期
          <input
            type="date"
            name={`${prefix}Date`}
            defaultValue={value?.kind === "fixed_date" ? value.readyDate : ""}
            required
          />
        </label>
      )}
    </div>
  );
}
