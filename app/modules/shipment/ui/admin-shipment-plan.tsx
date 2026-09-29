import { Form } from "react-router";
import type { createShipmentPlanService } from "../application/shipment-plan-service";
import type { QuotedShipmentGroup } from "../domain/shipment-plan";
import { ShipmentGroupFields } from "./shipment-group-fields";

export type AdminPlan = Awaited<
  ReturnType<ReturnType<typeof createShipmentPlanService>["adminRead"]>
>;

export function planMappingState(plan: AdminPlan) {
  return {
    canMap:
      plan.status === "review" &&
      ["historical_review", "reviewed_mapping"].includes(plan.source ?? "") &&
      plan.originalMode === "split",
    canRevise:
      plan.status === "ready" &&
      plan.source === "reviewed_mapping" &&
      plan.originalMode === "split",
  };
}

export function AdminShipmentPlanReview({
  plan,
  commandId,
  busy,
  error,
}: {
  plan: AdminPlan;
  commandId: string;
  busy: boolean;
  error?: string;
}) {
  const lines = plan.lines ?? [];
  const { canMap, canRevise } = planMappingState(plan);
  const groupDefaults: QuotedShipmentGroup[] = plan.shipments.map(
    (shipment) => ({
      id: shipment.groupKey,
      label: shipment.displayName,
      allocations: shipment.quotedAllocations,
      freightCents: shipment.freightCents,
      insuranceCents: shipment.insuranceCents,
      dutiesImportCents: shipment.dutiesImportCents,
      transportMethod: shipment.transportMethod,
      incoterm: shipment.incoterm,
      namedPlace: shipment.namedPlace,
    }),
  );
  return (
    <>
      {plan.paymentHeld && (
        <p className="order-hold-notice" role="status">
          付款复核期间不可新分配或放行货物。既有批次保留显示。
        </p>
      )}
      {plan.status === "review" && (
        <p role="status">
          原 PI
          的分批描述需要逐行核对。锁定数量不会分配；解除锁定后可用同一计划补全。
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
      {(canMap || canRevise) && (
        <Form
          method="post"
          className="commercial-settings-form order-shipment-map-form"
        >
          <input
            type="hidden"
            name="intent"
            value={canRevise ? "shipment-revise" : "shipment-map"}
          />
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
              busy ||
              lines.some((line) => !line.quantity) ||
              (canRevise &&
                (plan.paymentHeld || plan.shipments.some((item) => item.held)))
            }
            title={
              canRevise &&
              (plan.paymentHeld || plan.shipments.some((item) => item.held))
                ? "付款或商品数量锁定解除后才能更正分配"
                : undefined
            }
          >
            {canRevise
              ? "更正分批分配"
              : plan.source === "reviewed_mapping"
                ? "补全分批映射"
                : "保存分批映射"}
          </button>
        </Form>
      )}
    </>
  );
}
