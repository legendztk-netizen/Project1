import { useState } from "react";
import { Form } from "react-router";
import type { ProformaInvoiceSnapshot } from "../../proforma-invoice/domain/proforma-invoice";
import type { createOrderShippingChangeService } from "../application/order-shipping-change-service";
import { splitShipmentIdForChange } from "../domain/order-shipping-change";
import "./order-shipping-changes.css";

type Change = Awaited<
  ReturnType<ReturnType<typeof createOrderShippingChangeService>["adminRead"]>
>[number];
type Destination = ProformaInvoiceSnapshot["destination"];

interface ShipmentInput {
  id: string;
  displayName: string;
  status: string;
  version: number;
  destination: Destination;
  transportMethod: string;
  incoterm: string;
  namedPlace: string;
  carrierName: string | null;
  serviceName: string | null;
  destinationTaxTreatment: string | null;
  allocations: Array<{
    lineId: string;
    displayName: string;
    physicalQuantity: number;
  }>;
  readyDate: string | null;
}

const label: Record<string, string> = {
  pending_review: "待审核",
  proposed: "待客户接受",
  accepted: "客户已接受，待生效",
  effective: "已生效",
  withdrawn: "客户已撤回",
  declined: "已拒绝",
};
const money = (cents: number) =>
  `${cents < 0 ? "-" : ""}USD ${(Math.abs(cents) / 100).toFixed(2)}`;
const field = (shipmentId: string, name: string) =>
  `shipment:${shipmentId}:${name}`;

export function AdminOrderShippingChanges({
  changes,
  shipments,
  milestones,
  commandId,
  busy,
  error,
}: {
  changes: Change[];
  shipments: ShipmentInput[];
  milestones: Array<{
    shipmentId: string;
    status: string;
    version?: number;
    revisedReadyReview?: {
      effectiveChangeId: string;
      verifiedAt: string | null;
    } | null;
  }>;
  commandId: string;
  busy: boolean;
  error?: string;
}) {
  const [splitSelections, setSplitSelections] = useState<
    Record<string, boolean>
  >({});
  const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toLocaleString("sv-SE", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .replace(" ", "T");
  return (
    <div className="shipping-changes admin-shipping-changes">
      {error && (
        <p className="shipping-change-error" role="alert">
          {error}
        </p>
      )}
      {changes.length === 0 && <p>暂无客户发货变更申请。</p>}
      {changes.map((change) => {
        const current = change.proposals.find(
          (item) => item.id === change.currentProposalId,
        );
        const affectedLines = [
          ...new Set(
            change.shipments.flatMap((item) =>
              item.quantities.map((allocation) => allocation.lineId),
            ),
          ),
        ];
        const splitShipmentId = splitShipmentIdForChange(change.id);
        const proposedSplit = current?.after.shipments.find(
          (item) => item.shipmentId === splitShipmentId,
        );
        const splitEnabled = splitSelections[change.id] ?? !!proposedSplit;
        const sourceShipment = shipments.find(
          (item) => item.id === change.shipments[0]?.shipmentId,
        );
        return (
          <section key={change.id} className="shipping-change-record">
            <div className="shipping-change-record-heading">
              <h3>
                {change.kind === "delivery_address"
                  ? "收货地址变更"
                  : "发货计划变更"}
              </h3>
              <strong>{label[change.status] ?? change.status}</strong>
            </div>
            <p>客户请求：{change.requested.note}</p>
            <p>
              涉及批次：
              {change.shipments.map((item) => item.shipmentId).join(" · ")}
            </p>
            {current && (
              <div className="shipping-change-proposal">
                <strong>变更确认版本 {current.version}</strong>
                <p>
                  {current.reason} · 调整 {money(current.adjustmentCents)}
                </p>
                <p>
                  到期：
                  {new Date(current.expiresAt).toLocaleString("zh-CN", {
                    timeZone: "Asia/Shanghai",
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}{" "}
                  北京时间
                </p>
                {current.after.shipments.map((item) => (
                  <p key={item.shipmentId}>
                    {item.shipmentId} · {item.destination.addressLine1},{" "}
                    {item.destination.city} ·{item.incoterm} {item.namedPlace} ·{" "}
                    {item.carrierName || item.transportMethod}
                    {item.readyDate ? ` · 预计可发货 ${item.readyDate}` : ""}
                  </p>
                ))}
                {change.status === "accepted" && (
                  <Form method="post">
                    <input
                      type="hidden"
                      name="intent"
                      value="shipping-change-apply"
                    />
                    <input type="hidden" name="requestId" value={change.id} />
                    <input type="hidden" name="proposalId" value={current.id} />
                    <input
                      type="hidden"
                      name="expectedVersion"
                      value={change.version}
                    />
                    <input type="hidden" name="commandId" value={commandId} />
                    <button className="button button-primary" disabled={busy}>
                      使客户已接受的变更生效
                    </button>
                    {current.adjustmentCents > 0 && (
                      <p>追加款由管理员线下处理；系统不核验到账。</p>
                    )}
                  </Form>
                )}
                {change.status === "effective" && current.refundDueCents && (
                  <p>
                    已记录发起：{money(current.refundInitiatedCents)} ·
                    剩余待退：
                    {money(
                      current.refundDueCents - current.refundInitiatedCents,
                    )}
                  </p>
                )}
              </div>
            )}
            {["pending_review", "proposed", "accepted"].includes(
              change.status,
            ) && (
              <details>
                <summary>{current ? "修订变更提案" : "审核并提出变更"}</summary>
                <Form method="post" className="shipping-change-form">
                  <input
                    type="hidden"
                    name="intent"
                    value="shipping-change-propose"
                  />
                  <input type="hidden" name="requestId" value={change.id} />
                  <input
                    type="hidden"
                    name="expectedVersion"
                    value={change.version}
                  />
                  <input type="hidden" name="commandId" value={commandId} />
                  {change.shipments.map((affected) => {
                    const shipment = shipments.find(
                      (item) => item.id === affected.shipmentId,
                    );
                    if (!shipment)
                      return (
                        <p key={affected.shipmentId}>
                          批次已变化，请先核对订单。
                        </p>
                      );
                    const previous = current?.after.shipments.find(
                      (item) => item.shipmentId === affected.shipmentId,
                    );
                    const destination =
                      previous?.destination ||
                      ("destination" in change.requested &&
                        change.requested.destination) ||
                      shipment.destination;
                    return (
                      <fieldset
                        key={shipment.id}
                        className="shipping-change-admin-shipment"
                      >
                        <legend>
                          {shipment.displayName} · 当前版本 {shipment.version}
                        </legend>
                        <div className="shipping-change-fields">
                          <label>
                            收件人
                            <input
                              name={field(shipment.id, "recipientName")}
                              required
                              defaultValue={destination.recipientName}
                            />
                          </label>
                          <label>
                            地址
                            <input
                              name={field(shipment.id, "addressLine1")}
                              required
                              defaultValue={destination.addressLine1}
                            />
                          </label>
                          <label>
                            地址第二行
                            <input
                              name={field(shipment.id, "addressLine2")}
                              defaultValue={destination.addressLine2 ?? ""}
                            />
                          </label>
                          <label>
                            城市
                            <input
                              name={field(shipment.id, "city")}
                              required
                              defaultValue={destination.city}
                            />
                          </label>
                          <label>
                            州/省
                            <input
                              name={field(shipment.id, "stateProvince")}
                              required
                              defaultValue={destination.stateProvince}
                            />
                          </label>
                          <label>
                            邮编
                            <input
                              name={field(shipment.id, "postalCode")}
                              required
                              defaultValue={destination.postalCode}
                            />
                          </label>
                          <label>
                            国家代码
                            <input
                              name={field(shipment.id, "countryCode")}
                              required
                              maxLength={2}
                              defaultValue={destination.countryCode}
                            />
                          </label>
                          <label>
                            收件电话
                            <input
                              name={field(shipment.id, "recipientPhone")}
                              defaultValue={destination.recipientPhone ?? ""}
                            />
                          </label>
                          <label>
                            收件邮箱
                            <input
                              name={field(shipment.id, "recipientEmail")}
                              defaultValue={destination.recipientEmail ?? ""}
                            />
                          </label>
                          <label>
                            承运商
                            <input
                              name={field(shipment.id, "carrierName")}
                              defaultValue={
                                previous?.carrierName ??
                                shipment.carrierName ??
                                ""
                              }
                            />
                          </label>
                          <label>
                            服务级别
                            <input
                              name={field(shipment.id, "serviceName")}
                              defaultValue={
                                previous?.serviceName ??
                                shipment.serviceName ??
                                ""
                              }
                            />
                          </label>
                          <label>
                            运输方式
                            <input
                              name={field(shipment.id, "transportMethod")}
                              required
                              defaultValue={
                                previous?.transportMethod ??
                                shipment.transportMethod
                              }
                            />
                          </label>
                          <label>
                            贸易条款
                            <select
                              name={field(shipment.id, "incoterm")}
                              defaultValue={
                                previous?.incoterm ?? shipment.incoterm
                              }
                            >
                              <option>DDP</option>
                              <option>DAP</option>
                            </select>
                          </label>
                          <label>
                            指定地点
                            <input
                              name={field(shipment.id, "namedPlace")}
                              required
                              defaultValue={
                                previous?.namedPlace ?? shipment.namedPlace
                              }
                            />
                          </label>
                          <label>
                            目的地税费责任
                            <select
                              name={field(
                                shipment.id,
                                "destinationTaxTreatment",
                              )}
                              defaultValue={
                                previous?.destinationTaxTreatment ??
                                shipment.destinationTaxTreatment ??
                                "As accepted in PI"
                              }
                            >
                              <option value="As accepted in PI">按原 PI</option>
                              <option value="Seller pays import taxes">
                                卖方承担进口税费
                              </option>
                              <option value="Buyer pays import taxes">
                                买方承担进口税费
                              </option>
                            </select>
                          </label>
                          <label>
                            预计可发货日期
                            <input
                              type="date"
                              name={field(shipment.id, "readyDate")}
                              defaultValue={
                                previous?.readyDate ?? shipment.readyDate ?? ""
                              }
                            />
                          </label>
                        </div>
                        <h4>该批次分配</h4>
                        <div className="shipping-change-fields">
                          {affectedLines.map((lineId) => (
                            <label key={lineId}>
                              {shipments
                                .flatMap((item) => item.allocations)
                                .find(
                                  (allocation) => allocation.lineId === lineId,
                                )?.displayName ?? lineId}
                              <input
                                type="number"
                                min="0"
                                step="1"
                                required
                                name={field(
                                  shipment.id,
                                  `allocation:${lineId}`,
                                )}
                                defaultValue={
                                  previous?.allocations.find(
                                    (item) => item.lineId === lineId,
                                  )?.physicalQuantity ??
                                  shipment.allocations.find(
                                    (item) => item.lineId === lineId,
                                  )?.physicalQuantity ??
                                  0
                                }
                              />
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    );
                  })}
                  {change.kind === "shipping_plan" && sourceShipment && (
                    <>
                      <label className="shipping-change-split-toggle">
                        <input
                          type="checkbox"
                          name="createSplitShipment"
                          checked={splitEnabled}
                          onChange={(event) =>
                            setSplitSelections((previous) => ({
                              ...previous,
                              [change.id]: event.target.checked,
                            }))
                          }
                        />
                        新增分批发货批次
                      </label>
                      {splitEnabled && (
                        <fieldset className="shipping-change-admin-shipment">
                          <legend>
                            新增批次（收货地址沿用第一个涉及批次）
                          </legend>
                          <div className="shipping-change-fields">
                            <label>
                              承运商
                              <input
                                name={field(splitShipmentId, "carrierName")}
                                defaultValue={
                                  proposedSplit?.carrierName ??
                                  sourceShipment.carrierName ??
                                  ""
                                }
                              />
                            </label>
                            <label>
                              服务级别
                              <input
                                name={field(splitShipmentId, "serviceName")}
                                defaultValue={
                                  proposedSplit?.serviceName ??
                                  sourceShipment.serviceName ??
                                  ""
                                }
                              />
                            </label>
                            <label>
                              运输方式
                              <input
                                name={field(splitShipmentId, "transportMethod")}
                                required
                                defaultValue={
                                  proposedSplit?.transportMethod ??
                                  sourceShipment.transportMethod
                                }
                              />
                            </label>
                            <label>
                              贸易条款
                              <select
                                name={field(splitShipmentId, "incoterm")}
                                defaultValue={
                                  proposedSplit?.incoterm ??
                                  sourceShipment.incoterm
                                }
                              >
                                <option>DDP</option>
                                <option>DAP</option>
                              </select>
                            </label>
                            <label>
                              指定地点
                              <input
                                name={field(splitShipmentId, "namedPlace")}
                                required
                                defaultValue={
                                  proposedSplit?.namedPlace ??
                                  sourceShipment.namedPlace
                                }
                              />
                            </label>
                            <label>
                              目的地税费责任
                              <select
                                name={field(
                                  splitShipmentId,
                                  "destinationTaxTreatment",
                                )}
                                defaultValue={
                                  proposedSplit?.destinationTaxTreatment ??
                                  sourceShipment.destinationTaxTreatment ??
                                  "As accepted in PI"
                                }
                              >
                                <option value="As accepted in PI">
                                  按原 PI
                                </option>
                                <option value="Seller pays import taxes">
                                  卖方承担进口税费
                                </option>
                                <option value="Buyer pays import taxes">
                                  买方承担进口税费
                                </option>
                              </select>
                            </label>
                            <label>
                              预计可发货日期
                              <input
                                type="date"
                                name={field(splitShipmentId, "readyDate")}
                                defaultValue={
                                  proposedSplit?.readyDate ??
                                  sourceShipment.readyDate ??
                                  ""
                                }
                              />
                            </label>
                          </div>
                          <h4>新增批次分配</h4>
                          <div className="shipping-change-fields">
                            {affectedLines.map((lineId) => (
                              <label key={lineId}>
                                {shipments
                                  .flatMap((item) => item.allocations)
                                  .find((item) => item.lineId === lineId)
                                  ?.displayName ?? lineId}
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  required
                                  name={field(
                                    splitShipmentId,
                                    `allocation:${lineId}`,
                                  )}
                                  defaultValue={
                                    proposedSplit?.allocations.find(
                                      (item) => item.lineId === lineId,
                                    )?.physicalQuantity ?? 0
                                  }
                                />
                              </label>
                            ))}
                          </div>
                        </fieldset>
                      )}
                    </>
                  )}
                  <div className="shipping-change-fields">
                    <label>
                      USD 调整金额（负数为退款）
                      <input
                        type="number"
                        step="0.01"
                        required
                        name="adjustmentUsd"
                        defaultValue={(
                          (current?.adjustmentCents ?? 0) / 100
                        ).toFixed(2)}
                      />
                    </label>
                    <label>
                      提案到期（北京时间）
                      <input
                        type="datetime-local"
                        required
                        name="expiresLocal"
                        defaultValue={expiry}
                      />
                    </label>
                  </div>
                  <label>
                    审核原因
                    <textarea
                      name="reason"
                      required
                      rows={3}
                      defaultValue={current?.reason ?? ""}
                    />
                  </label>
                  <button className="button button-primary" disabled={busy}>
                    发布变更确认
                  </button>
                </Form>
              </details>
            )}
            {["pending_review", "proposed", "accepted"].includes(
              change.status,
            ) && (
              <details>
                <summary>拒绝申请</summary>
                <Form method="post" className="shipping-change-form">
                  <input
                    type="hidden"
                    name="intent"
                    value="shipping-change-decline"
                  />
                  <input type="hidden" name="requestId" value={change.id} />
                  <input
                    type="hidden"
                    name="expectedVersion"
                    value={change.version}
                  />
                  <input type="hidden" name="commandId" value={commandId} />
                  <label>
                    拒绝原因
                    <textarea name="reason" required rows={2} />
                  </label>
                  <button className="button button-secondary" disabled={busy}>
                    确认拒绝
                  </button>
                </Form>
              </details>
            )}
          </section>
        );
      })}
      {milestones
        .filter(
          (item) =>
            item.revisedReadyReview && !item.revisedReadyReview.verifiedAt,
        )
        .map((item) => (
          <section key={item.shipmentId} className="shipping-change-record">
            <h3>{item.shipmentId} · 变更后备妥复核</h3>
            <Form method="post" className="shipping-change-form">
              <input
                type="hidden"
                name="intent"
                value="shipping-change-reverify"
              />
              <input type="hidden" name="shipmentId" value={item.shipmentId} />
              <input
                type="hidden"
                name="effectiveChangeId"
                value={item.revisedReadyReview!.effectiveChangeId}
              />
              <input
                type="hidden"
                name="expectedShipmentVersion"
                value={item.version}
              />
              <input type="hidden" name="commandId" value={commandId} />
              {(
                [
                  "specificationsVerified",
                  "quantitiesVerified",
                  "offlinePreparationVerified",
                  "requiredInspectionVerified",
                ] as const
              ).map((key) => (
                <label key={key} className="shipping-change-choice">
                  <input type="checkbox" name={key} required />
                  {
                    {
                      specificationsVerified: "规格已复核",
                      quantitiesVerified: "数量已复核",
                      offlinePreparationVerified: "线下备货已复核",
                      requiredInspectionVerified: "必要检验已复核",
                    }[key]
                  }
                </label>
              ))}
              <button className="button button-primary" disabled={busy}>
                完成变更后备妥复核
              </button>
            </Form>
          </section>
        ))}
    </div>
  );
}
