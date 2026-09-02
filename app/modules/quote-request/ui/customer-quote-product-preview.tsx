import { Package } from "lucide-react";

import type { AnonymousQuoteLine } from "../../quote-list/domain/anonymous-quote-list";
import {
  hoseEndMediaPath,
  hoseEndMediaPathFromDisplayName,
  hoseMediaPath,
} from "../../storefront/ui/catalog-media";

interface PreviewPart {
  alt: string;
  kind: "end" | "hose" | "product";
  src: string | null;
}

function hoseSeriesFromSku(sku: string) {
  return sku.split("_", 1)[0]?.trim() || null;
}

export function quoteLinePreviewParts(line: AnonymousQuoteLine): PreviewPart[] {
  if (line.lineKind === "configured_assembly") {
    const configuration = line.configuredAssembly.snapshot.configuration;
    return [
      {
        alt: configuration.endA
          ? `End A: ${configuration.endA.hoseEnd.displayName}`
          : "End A image pending",
        kind: "end",
        src: hoseEndMediaPath(configuration.endA?.hoseEnd.mediaKey),
      },
      {
        alt: `${configuration.hose.familyName} hose`,
        kind: "hose",
        src: hoseMediaPath(configuration.hose.mediaKey),
      },
      {
        alt: configuration.endB
          ? `End B: ${configuration.endB.hoseEnd.displayName}`
          : "End B image pending",
        kind: "end",
        src: hoseEndMediaPath(configuration.endB?.hoseEnd.mediaKey),
      },
    ];
  }

  if (line.category === "hydraulic-hose") {
    const series = hoseSeriesFromSku(line.sku);
    return [
      {
        alt: `${series ?? line.displayName} hose series`,
        kind: "hose",
        src: hoseMediaPath(series),
      },
    ];
  }

  if (line.category === "hose-ends") {
    return [
      {
        alt: `${line.displayName} product series`,
        kind: "product",
        src: hoseEndMediaPathFromDisplayName(line.displayName),
      },
    ];
  }

  return [
    {
      alt: `${line.displayName} image pending`,
      kind: "product",
      src: null,
    },
  ];
}

function PreviewImage({ part }: { part: PreviewPart }) {
  return (
    <div className="customer-quote-preview-part" data-kind={part.kind}>
      {part.src ? (
        <img alt={part.alt} src={part.src} />
      ) : (
        <span aria-label={part.alt} className="customer-quote-preview-fallback">
          <Package aria-hidden="true" size={24} />
        </span>
      )}
    </div>
  );
}

export function CustomerQuoteProductPreview({
  compact = false,
  line,
}: {
  compact?: boolean;
  line: AnonymousQuoteLine;
}) {
  const parts = quoteLinePreviewParts(line);
  return (
    <figure
      aria-label={`Product preview for ${line.displayName}`}
      className="customer-quote-product-preview"
      data-assembly={line.lineKind === "configured_assembly" || undefined}
      data-compact={compact || undefined}
    >
      {parts.map((part, index) => (
        <PreviewImage key={`${part.kind}-${index}`} part={part} />
      ))}
    </figure>
  );
}

export function CustomerQuoteRequestPreview({
  lines,
}: {
  lines: AnonymousQuoteLine[];
}) {
  const visibleLines = lines.slice(0, 3);
  const hiddenCount = lines.length - visibleLines.length;
  return (
    <div
      aria-label={`${lines.length} submitted product ${lines.length === 1 ? "preview" : "previews"}`}
      className="customer-quote-request-preview"
      data-count={visibleLines.length}
    >
      {visibleLines.map((line) => (
        <CustomerQuoteProductPreview compact key={line.id} line={line} />
      ))}
      {hiddenCount > 0 ? (
        <span className="customer-quote-preview-more">+{hiddenCount}</span>
      ) : null}
    </div>
  );
}
