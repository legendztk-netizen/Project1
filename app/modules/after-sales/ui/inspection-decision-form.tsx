import { useState } from "react";
import { Form } from "react-router";

import type { CaseView } from "../application/case-service";
import type { ReceiptView } from "../application/return-inspection-service";
import { scopedField } from "../application/parse-after-sales-forms";
import {
  customerTermsAllowed,
  RESTOCKING_FEE_PERCENT,
} from "../domain/return-policy";
import { EventAttachmentField } from "./admin-action-dialog";

export const conditionLabels = [
  ["interfaces", "接口 / 螺纹"],
  ["sealingSurfaces", "密封面"],
  ["finish", "表面处理"],
  ["packaging", "包装与配件"],
  ["installationEvidence", "安装痕迹"],
  ["fluidExposure", "接触流体痕迹"],
] as const;

export function InspectionDecisionForm({
  item,
  receipt,
  commandId,
  busy,
}: {
  item: CaseView;
  receipt: ReceiptView;
  commandId: string;
  busy: boolean;
}) {
  const [responsibility, setResponsibility] = useState(
    item.reason === "convenience_return"
      ? "customer"
      : item.reason === "other"
        ? ""
        : "seller",
  );
  const [remedy, setRemedy] = useState("refund");
  const [quantities, setQuantities] = useState(
    receipt.lines.map((line) => line.physicalQuantity),
  );
  const [thirdPartyUsd, setThirdPartyUsd] = useState("");
  const reasonRequired = receipt.lines.some(
    (line, index) => quantities[index] < line.physicalQuantity,
  );
  const customer = responsibility === "customer";
  const name = (lineId: string) =>
    item.lines.find((line) => line.lineId === lineId)?.displayName ?? lineId;

  return (
    <Form
      method="post"
      encType="multipart/form-data"
      className="shipping-change-form after-sales-inspection-form"
    >
      <input type="hidden" name="intent" value="return-decide" />
      <input type="hidden" name="caseId" value={item.id} />
      <input type="hidden" name="receiptId" value={receipt.id} />
      <input type="hidden" name="commandId" value={commandId} />
      <div className="shipping-change-fields">
        <label>
          责任方
          <select
            name="responsibility"
            required
            value={responsibility}
            onChange={(event) => {
              setResponsibility(event.target.value);
              setRemedy("refund");
              setThirdPartyUsd("");
            }}
          >
            {item.reason === "other" && (
              <option value="" disabled>
                请选择责任方
              </option>
            )}
            {customerTermsAllowed(item.reason) && (
              <option value="customer">买家责任 / 客户选择退货</option>
            )}
            {item.reason !== "convenience_return" && (
              <option value="seller">卖方责任</option>
            )}
          </select>
        </label>
        <label>
          处理方式
          <select
            name="remedy"
            required
            value={remedy}
            onChange={(event) => setRemedy(event.target.value)}
          >
            <option value="refund">退款</option>
            {!customer && <option value="replacement">卖方承担的更换</option>}
          </select>
        </label>
      </div>
      {receipt.lines.map((line, index) => (
        <label
          key={`${line.lineId}:${line.shipmentId}`}
          className="after-sales-quantity-row"
        >
          <span>
            <strong>{name(line.lineId)}</strong>
            <small>实收 {line.physicalQuantity} · 批准数量（必填）</small>
          </span>
          <input
            type="number"
            required
            min={0}
            max={line.physicalQuantity}
            step={1}
            defaultValue={line.physicalQuantity}
            aria-label={`${name(line.lineId)} 批准数量`}
            name={scopedField("inspectApprove", line.lineId, line.shipmentId)}
            onChange={(event) =>
              setQuantities((values) =>
                values.map((value, i) =>
                  i === index ? Number(event.target.value) : value,
                ),
              )
            }
          />
        </label>
      ))}
      {customer && (
        <section className="after-sales-refund-summary">
          <strong>买家责任扣费（客户可见）</strong>
          <p>
            系统按批准商品金额扣除 {RESTOCKING_FEE_PERCENT}%
            退货手续费，已履行的原 DDP
            运费及进口费用不退。金额明细自动展示给客户，无需重复填写。
          </p>
          <div className="shipping-change-fields">
            <label>
              额外第三方费用（USD，选填）
              <input
                name="thirdPartyUsd"
                inputMode="decimal"
                value={thirdPartyUsd}
                onChange={(event) => setThirdPartyUsd(event.target.value)}
              />
            </label>
            <label>
              第三方费用凭证（扣费时必填，客户可见）
              <input
                name="thirdPartyEvidence"
                required={Number(thirdPartyUsd) > 0}
              />
            </label>
          </div>
          <small>仅可扣有凭证、不可退回的实际费用；额外扣费需客户确认。</small>
        </section>
      )}
      {responsibility === "seller" && (
        <p className="after-sales-next-step">
          卖方责任不扣退货手续费或第三方费用。商品金额按批准数量计算；需要退回的物流费用和销售税，请在下方填写。
        </p>
      )}
      <label>
        {reasonRequired
          ? "少退 / 不退的原因（必填，客户可见，请用英文）"
          : "给客户的补充说明（选填，请用英文）"}
        <textarea name="customerReason" required={reasonRequired} rows={2} />
      </label>
      <details className="after-sales-inspection-options">
        <summary>物流与销售税调整（选填，金额客户可见）</summary>
        <p>
          留空按 0
          计算；如有应退运费或销售税，仍需填写金额。内部说明不展示给客户。
        </p>
        <div className="shipping-change-fields">
          {responsibility === "seller" && (
            <>
              <label>
                退回原物流费用（USD）
                <input name="logisticsUsd" inputMode="decimal" />
              </label>
              <label>
                物流说明（内部，选填）
                <input name="logisticsNote" />
              </label>
              <label>
                卖方承担的退货 / 更换物流（USD）
                <input name="sellerLogisticsUsd" inputMode="decimal" />
              </label>
              <label>
                卖方物流说明（内部，选填）
                <input name="sellerLogisticsNote" />
              </label>
            </>
          )}
          <label>
            销售税调整（USD）
            <input name="taxUsd" inputMode="decimal" />
          </label>
          <label>
            税务依据（内部，选填）
            <input name="taxNote" />
          </label>
        </div>
      </details>
      {remedy === "replacement" && (
        <details className="after-sales-inspection-options">
          <summary>更换补充信息（选填，客户可见，请用英文）</summary>
          <p>默认按上方批准的商品与数量更换，费用由卖方承担。</p>
          <div className="shipping-change-fields">
            <label>
              更换范围补充
              <input name="replacementScope" />
            </label>
            <label>
              更换费用说明
              <input name="replacementCosts" />
            </label>
            <label>
              更换履约证据
              <input name="replacementEvidence" />
            </label>
          </div>
        </details>
      )}
      <details className="after-sales-inspection-options">
        <summary>线下检验记录与内部备注（选填，仅内部可见）</summary>
        <p>
          可在线下完成质量确认，无需逐项填写。未填写的检验细节不会自动记录为合格。
        </p>
        {receipt.lines.map((line) => (
          <fieldset key={`${line.lineId}:${line.shipmentId}`}>
            <legend>{name(line.lineId)}</legend>
            <div className="shipping-change-fields">
              {conditionLabels.map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    name={scopedField(
                      `inspect-${key}`,
                      line.lineId,
                      line.shipmentId,
                    )}
                  />
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <label>
          内部备注
          <textarea name="internalNote" rows={2} />
        </label>
      </details>
      <details className="after-sales-inspection-options">
        <summary>附给客户的文件（选填）</summary>
        <EventAttachmentField />
        <p>
          这里上传的附件随决定展示给客户；内部检验照片请在收货记录的私密附件中上传。
        </p>
      </details>
      <p>
        提交即确认已完成线下检验。客户会看到处理结果、批准数量及退款明细；实际退款发起仍需另行记录。
      </p>
      <button className="button button-primary" disabled={busy}>
        确认并发布处理结果
      </button>
    </Form>
  );
}
