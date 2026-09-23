import { Form } from "react-router";
import type { createShipmentPlanService } from "../application/shipment-plan-service";
import type { QuotedShipmentGroup } from "../domain/shipment-plan";
import { ShipmentGroupFields } from "./shipment-group-fields";

type Plan = Awaited<
  ReturnType<ReturnType<typeof createShipmentPlanService>["adminRead"]>
>;

export function AdminShipmentPlan({
  plan,
  commandId,
  busy,
  error,
}: {
  plan: Plan;
  commandId: string;
  busy: boolean;
  error?: string;
}) {
  const lines = plan.lines ?? [];
  const canMap =
    ["historical_review", "reviewed_mapping"].includes(plan.source ?? "") &&
    plan.originalMode === "split";
  const groupDefaults: QuotedShipmentGroup[] = plan.shipments.map(
    (shipment) => ({
      id: shipment.groupKey,
      label: shipment.displayName,
      allocations: shipment.allocations.map((allocation) => ({
        lineId: allocation.lineId,
        physicalQuantity: allocation.physicalQuantity,
      })),
      freightCents: shipment.freightCents,
      insuranceCents: shipment.insuranceCents,
      dutiesImportCents: shipment.dutiesImportCents,
      transportMethod: shipment.transportMethod,
      incoterm: shipment.incoterm,
      namedPlace: shipment.namedPlace,
    }),
  );
  return (
    <div className="order-shipment-workspace">
      <div className="order-shipment-summary">
        <strong>
          {plan.status === "review"
            ? "计划待核对"
            : `${plan.shipments.length} 批发货计划`}
        </strong>
        <span>计划版本 {plan.version}</span>
      </div>
      {plan.paymentHeld && (
        <p className="order-hold-notice" role="status">
          付款复核期间不可新分配或放行货物。既有批次保留显示。
        </p>
      )}
      {plan.status === "review" && (
        <p role="status">
          原 PI
          的分批描述尚未形成可核对的逐行数量计划，不会自动推断批次或发货时间。
        </p>
      )}
      {plan.sourceText && (
        <div className="order-shipment-original">
          <strong>客户接受的原始分批描述</strong>
          <p>{plan.sourceText}</p>
        </div>
      )}
      {plan.reviewNote && (
        <p className="order-shipment-review-note">
          上次核对依据：{plan.reviewNote}
        </p>
      )}
      {plan.shipments.length > 0 && (
        <div className="order-shipment-list">
          {plan.shipments.map((shipment) => (
            <article key={shipment.id} className="order-shipment-item">
              <div className="order-shipment-item-heading">
                <h3>
                  第 {shipment.sequenceNumber} 批 · {shipment.displayName}
                </h3>
                <span className="orders-status">
                  {shipment.held ? "暂缓放行" : "计划中"}
                </span>
              </div>
              <p>
                {shipment.incoterm} · {shipment.namedPlace} ·{" "}
                {shipment.transportMethod}
              </p>
              <ul>
                {shipment.allocations.map((allocation) => (
                  <li key={allocation.lineId}>
                    <span>
                      {allocation.displayName} · {allocation.sku}
                    </span>
                    <strong>
                      {allocation.physicalQuantity} {allocation.unit}
                      {allocation.lengthPerPiece &&
                        ` · 每件 ${allocation.lengthPerPiece.value} ${allocation.lengthPerPiece.unit}`}
                    </strong>
                  </li>
                ))}
              </ul>
              <p>
                本批运费 USD {(shipment.freightCents / 100).toFixed(2)} · 保险
                USD {(shipment.insuranceCents / 100).toFixed(2)} · 进口费用 USD
                {(shipment.dutiesImportCents / 100).toFixed(2)}
              </p>
            </article>
          ))}
        </div>
      )}
      {canMap && (
        <Form
          method="post"
          className="commercial-settings-form order-shipment-map-form"
        >
          <input type="hidden" name="intent" value="shipment-map" />
          <input type="hidden" name="expectedVersion" value={plan.version} />
          <input type="hidden" name="commandId" value={commandId} />
          <ShipmentGroupFields
            key={plan.version}
            lines={lines.map((line) => ({
              id: line.id,
              sku: line.sku,
              unit: line.unit,
              physicalQuantity: line.quantity ?? 0,
            }))}
            groups={groupDefaults.length ? groupDefaults : undefined}
            charges={plan.originalCharges}
            transportMethod={plan.originalTerms.transportMethod}
          />
          <label>
            与客户已接受 PI 一致的核对依据
            <textarea
              name="reviewNote"
              defaultValue={plan.reviewNote ?? ""}
              minLength={10}
              maxLength={2000}
              required
            />
          </label>
          <label className="quote-confirmation">
            <input type="checkbox" name="matchesAcceptedTerms" required />
            我已逐项核对批次数量、运费和交付条款与客户接受的 PI
            一致；实质变更须另走订单变更确认。
          </label>
          {error && <p role="alert">{error}</p>}
          <button
            type="submit"
            className="button button-primary"
            disabled={
              busy || plan.paymentHeld || lines.some((line) => !line.quantity)
            }
          >
            保存分批映射
          </button>
        </Form>
      )}
    </div>
  );
}
