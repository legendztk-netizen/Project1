import { Package } from "lucide-react";
import type { ProformaInvoiceSnapshot } from "../domain/proforma-invoice";
import {
  hoseEndMediaPath,
  hoseMediaPath,
} from "../../storefront/ui/catalog-media";

type Line = ProformaInvoiceSnapshot["lines"][number];
const usd = (cents: number | null) =>
  cents === null ? "Pending" : `USD ${(cents / 100).toFixed(2)}`;

export function ConfirmedOrderLine({
  line,
  locale = "en",
}: {
  line: Line;
  locale?: "en" | "zh";
}) {
  const label = (english: string, chinese: string) =>
    locale === "zh" ? chinese : english;
  const images = line.assembly
    ? [
        {
          alt: "End A",
          src: hoseEndMediaPath(line.assembly.endA.hoseEnd.mediaKey),
        },
        { alt: "Hose", src: hoseMediaPath(line.assembly.hose.mediaKey) },
        {
          alt: "End B",
          src: hoseEndMediaPath(line.assembly.endB.hoseEnd.mediaKey),
        },
      ]
    : [{ alt: line.displayName, src: line.product.mainImageUrl }];
  return (
    <section className="customer-quote-section confirmed-order-line">
      <div className="confirmed-order-line-heading">
        <div>
          <h2>{line.displayName}</h2>
          <p>SKU {line.sku}</p>
        </div>
        <div
          className="customer-quote-product-preview"
          data-assembly={!!line.assembly || undefined}
        >
          {images.map((image, index) => (
            <div className="customer-quote-preview-part" key={index}>
              {image.src ? (
                <img src={image.src} alt={image.alt} />
              ) : (
                <span
                  className="customer-quote-preview-fallback"
                  aria-label="Product image unavailable"
                >
                  <Package size={24} />
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
      <dl className="customer-quote-summary">
        <div>
          <dt>{label("Quantity", "数量")}</dt>
          <dd>
            {line.quantity} {line.salesUnit}
          </dd>
        </div>
        <div>
          <dt>{label("Unit price", "单价")}</dt>
          <dd>{usd(line.price.unitPriceCents)}</dd>
        </div>
        <div>
          <dt>{label("Line total", "行金额")}</dt>
          <dd>{usd(line.totals.totalCents)}</dd>
        </div>
        {line.lengthOrder && (
          <div>
            <dt>{label("Length", "长度")}</dt>
            <dd>
              {line.lengthOrder.originalLengthValue}{" "}
              {line.lengthOrder.originalLengthUnit} {label("per piece", "每件")}{" "}
              · {line.lengthOrder.pieceCount} {label("pieces", "件")}
            </dd>
          </div>
        )}
        {line.assembly && (
          <div>
            <dt>{label("Finished length", "成品长度")}</dt>
            <dd>
              {line.assembly.finishedLength.originalValue}{" "}
              {line.assembly.finishedLength.originalUnit}
            </dd>
          </div>
        )}
      </dl>
      {line.product.specifications.length > 0 && (
        <dl className="customer-quote-summary">
          {line.product.specifications.map((spec, index) => (
            <div key={`${spec.label}-${index}`}>
              <dt>{spec.label}</dt>
              <dd>{spec.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {line.assembly && (
        <dl className="customer-quote-summary">
          <div>
            <dt>End A</dt>
            <dd>{line.assembly.endA.hoseEnd.displayName}</dd>
          </div>
          <div>
            <dt>End B</dt>
            <dd>{line.assembly.endB.hoseEnd.displayName}</dd>
          </div>
          <div>
            <dt>{label("Measurement", "测量方式")}</dt>
            <dd>
              {line.assembly.measurement.method?.displayName ??
                label("Technical review", "技术审核")}
            </dd>
          </div>
          <div>
            <dt>{label("Clocking", "接头相对角度")}</dt>
            <dd>
              {line.assembly.clocking?.status === "specified"
                ? `${line.assembly.clocking.targetDisplay}°`
                : label("Not applicable", "不适用")}
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
