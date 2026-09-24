import type { CustomerQuoteRevision } from "../domain/quote-revision";
import { QuoteRevisionChanges } from "./quote-revision-changes";
import type { QuoteRequestLine } from "../../quote-request/domain/quote-request";
import { referencePriceAdjustment } from "../domain/quote-pricing";

const usd = (cents: number | null) =>
  cents === null ? "Pending" : `USD ${(cents / 100).toFixed(2)}`;
export function CustomerQuoteOffer({
  offer,
  adminSource,
}: {
  offer: CustomerQuoteRevision;
  adminSource?: QuoteRequestLine[];
}) {
  const label = (en: string, zh: string) =>
    adminSource ? `${zh} / ${en}` : en;
  return (
    <section
      className="customer-quote-section"
      aria-label="Current formal quote"
    >
      <h2>
        {adminSource
          ? label("Quote Ready · Revision", "报价已就绪 · 版本")
          : "Formal quote · Revision"}{" "}
        {offer.revisionNumber}
      </h2>
      <div className="customer-offer-lines">
        {offer.lines.map((line, index) => (
          <div key={line.id ?? index}>
            <strong>
              {line.displayName} · {line.sku}
            </strong>
            <span>
              {label("Pricing quantity", "计价数量")} {line.totals.quantity}{" "}
              {line.salesUnit} · {label("Unit price", "单价")}{" "}
              {usd(line.price.unitPriceCents)} / {line.salesUnit}
            </span>
            {line.lengthOrder ? (
              <span>
                {line.quantity} {label("pieces", "件")} ·{" "}
                {line.lengthOrder.originalLengthValue}{" "}
                {line.lengthOrder.originalLengthUnit}{" "}
                {label("per piece", "每件")} · {line.lengthOrder.totalFootage}{" "}
                ft {label("total", "合计")}
              </span>
            ) : null}
            <span>
              {adminSource
                ? (() => {
                    const percentage = adminSource[index]
                      ? referencePriceAdjustment(
                          adminSource[index],
                          line.totals.totalCents,
                        )
                      : null;
                    return percentage === null
                      ? "参考价优惠 / Reference discount：无法计算 / Unavailable"
                      : percentage < 0
                        ? `较参考价上调 / Increase: ${Math.abs(percentage).toFixed(2)}%`
                        : `参考价优惠 / Reference discount: ${percentage.toFixed(2)}%`;
                  })()
                : `Discount ${line.price.discountBasisPoints / 100}%`}{" "}
              · {label("Line total", "行金额")} {usd(line.totals.totalCents)}
            </span>
            {line.assemblyLength ? (
              <span>
                {label("Finished length", "成品长度")}:{" "}
                {line.assemblyLength.originalValue}{" "}
                {line.assemblyLength.originalUnit}
              </span>
            ) : null}
            {line.quotedSpecificationOverrides.length ? (
              <div>
                <strong>
                  {label("Reviewed specification changes", "已审核规格变更")}
                </strong>
                <dl>
                  {line.quotedSpecificationOverrides.map((spec) => (
                    <div key={spec.label}>
                      <dt>{spec.label}</dt>
                      <dd>{spec.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {offer.differences.length ? (
        <QuoteRevisionChanges changes={offer.differences} />
      ) : null}
      <dl className="customer-quote-summary">
        <div>
          <dt>{label("Merchandise", "商品金额")}</dt>
          <dd>{usd(offer.totals.merchandiseCents)}</dd>
        </div>
        {Object.entries(offer.charges).map(([key, value]) => (
          <div key={key}>
            <dt>
              {
                (
                  {
                    freight: label("Freight", "运费"),
                    insurance: label("Insurance", "保险费"),
                    dutiesImport: label(
                      "Duties / import charges",
                      "关税及进口费用",
                    ),
                    salesTax: label("Sales tax", "销售税"),
                    cuttingLabeling: label(
                      "Cutting / labeling",
                      "切割与贴标费",
                    ),
                    assemblyService: label("Assembly service", "总成加工费"),
                    protectionService: label(
                      "Protection service",
                      "保护层安装费",
                    ),
                  } as Record<string, string>
                )[key]
              }
            </dt>
            <dd>{usd(value)}</dd>
          </div>
        ))}
        <div>
          <dt>{label("Total", "总金额")}</dt>
          <dd>{usd(offer.totals.totalCents)}</dd>
        </div>
        <div>
          <dt>{label("Delivery terms", "交付条款")}</dt>
          <dd>
            {offer.incoterm} · {offer.namedPlace}
          </dd>
        </div>
        <div>
          <dt>{label("Transport", "运输方式")}</dt>
          <dd>{offer.transportMethod}</dd>
        </div>
        <div>
          <dt>{label("Shipment plan", "发货安排")}</dt>
          <dd>
            {offer.shipmentMode === "split" ? offer.splitPlan : "Ship together"}
          </dd>
        </div>
        {offer.shipmentGroups?.map((group, index) => (
          <div key={group.id}>
            <dt>{label(`Shipment ${index + 1}`, `第 ${index + 1} 批发货`)}</dt>
            <dd>
              <strong>{group.label}</strong>
              {group.allocations.map((allocation) => {
                const lineIndex = offer.lines.findIndex(
                  (item) => item.id === allocation.lineId,
                );
                const line = offer.lines[lineIndex];
                return (
                  <span key={allocation.lineId} className="shipment-group-line">
                    Line {lineIndex + 1} · {line?.sku ?? allocation.lineId} ·{" "}
                    {line?.displayName ?? allocation.lineId}
                    {line?.lengthOrder &&
                      ` · ${line.lengthOrder.originalLengthValue} ${line.lengthOrder.originalLengthUnit} per piece`}
                    : {allocation.physicalQuantity}{" "}
                    {line?.lineKind === "length_based_hose"
                      ? "pieces"
                      : (line?.salesUnit ?? "units")}
                  </span>
                );
              })}
              <span className="shipment-group-line">
                {group.transportMethod} · {group.incoterm} {group.namedPlace}
              </span>
              <span className="shipment-group-line">
                Freight {usd(group.freightCents)} · Insurance{" "}
                {usd(group.insuranceCents)} · Duties/import{" "}
                {usd(group.dutiesImportCents)}
              </span>
            </dd>
          </div>
        ))}
        <div>
          <dt>{label("Lead time", "交期")}</dt>
          <dd>{offer.leadTime}</dd>
        </div>
        <div>
          <dt>{label("Sales tax treatment", "销售税处理")}</dt>
          <dd>{offer.taxTreatment}</dd>
        </div>
      </dl>
      <address>
        {offer.destination.recipientName}
        <br />
        {offer.destination.addressLine1} {offer.destination.addressLine2}
        <br />
        {offer.destination.city}, {offer.destination.stateProvince}{" "}
        {offer.destination.postalCode} · {offer.destination.countryCode}
      </address>
    </section>
  );
}
