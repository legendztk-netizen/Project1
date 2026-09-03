import type { ReactNode } from "react";
import { Package } from "lucide-react";

import {
  jsonArray,
  jsonObject,
  jsonPath,
  jsonString,
} from "../domain/admin-quote-review";
import { AdminTechnicalTerm } from "../../admin/ui/admin-technical-term";
import {
  hoseEndMediaPath,
  hoseEndMediaPathFromDisplayName,
  hoseMediaPath,
} from "../../storefront/ui/catalog-media";
import { M08ClockingPreview } from "../../storefront/ui/m08-clocking-preview";
import "../../storefront/styles/clocking-preview.css";

const missing = <span className="snapshot-missing">快照未记录</span>;

function valueText(value: unknown): ReactNode {
  if (typeof value === "string") return value.trim() || missing;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "是" : "否";
  return missing;
}

function joined(values: unknown[], separator = " · ") {
  const parts = values.flatMap((value) => {
    if (typeof value === "string" && value.trim()) return [value];
    if (typeof value === "number" && Number.isFinite(value)) {
      return [String(value)];
    }
    return [];
  });
  return parts.length > 0 ? parts.join(separator) : null;
}

function submittedClockingAngle(clocking: Record<string, unknown> | null) {
  if (clocking?.status !== "specified") return null;
  const storedDegrees = clocking.targetDegrees;
  const displayDegrees = jsonString(clocking.targetDisplay);
  const angle =
    typeof storedDegrees === "number"
      ? storedDegrees
      : displayDegrees && /^\d{1,3}$/u.test(displayDegrees)
        ? Number(displayDegrees)
        : Number.NaN;
  return Number.isInteger(angle) && angle >= 0 && angle <= 359 ? angle : null;
}

function connectionStandard(value: unknown): ReactNode {
  const text = jsonString(value);
  if (!text) return missing;
  const match = /\b(JIC|NPTF?)\b/.exec(text);
  if (!match || match.index === undefined) return text;
  const term = match[1];
  return (
    <>
      {text.slice(0, match.index)}
      <AdminTechnicalTerm
        explanation={
          term === "JIC"
            ? "JIC 37° 扩口液压连接标准"
            : "NPT/NPTF 美国锥管螺纹体系"
        }
      >
        {term}
      </AdminTechnicalTerm>
      {text.slice(match.index + term.length)}
    </>
  );
}

interface SnapshotPreviewPart {
  alt: string;
  kind: "end" | "hose" | "product";
  src: string | null;
}

function hoseSeriesFromSku(value: unknown) {
  const sku = jsonString(value);
  return sku?.split("_", 1)[0]?.trim() || null;
}

function snapshotPreviewParts(lineValue: unknown): SnapshotPreviewPart[] {
  const line = jsonObject(lineValue);
  if (!line) return [];
  const product = jsonObject(line.productSnapshot);
  if (line.lineKind === "configured_assembly") {
    const configuration = jsonObject(
      jsonPath(line, "configuredAssembly", "snapshot", "configuration"),
    );
    const endA = jsonObject(jsonPath(configuration, "endA", "hoseEnd"));
    const hose = jsonObject(configuration?.hose);
    const endB = jsonObject(jsonPath(configuration, "endB", "hoseEnd"));
    return [
      {
        alt: `End A：${jsonString(endA?.displayName) ?? "图片未记录"}`,
        kind: "end",
        src: hoseEndMediaPath(jsonString(endA?.mediaKey)),
      },
      {
        alt: `${jsonString(hose?.familyName) ?? "胶管"}图片`,
        kind: "hose",
        src: hoseMediaPath(jsonString(hose?.mediaKey)),
      },
      {
        alt: `End B：${jsonString(endB?.displayName) ?? "图片未记录"}`,
        kind: "end",
        src: hoseEndMediaPath(jsonString(endB?.mediaKey)),
      },
    ];
  }

  const category = jsonString(line.category) ?? jsonString(product?.category);
  const mediaKey = jsonString(product?.mediaKey);
  const displayName = jsonString(line.displayName) ?? "商品";
  if (category === "hydraulic-hose" || line.lineKind === "length_based_hose") {
    return [
      {
        alt: `${displayName}图片`,
        kind: "hose",
        src: hoseMediaPath(mediaKey ?? hoseSeriesFromSku(line.sku)),
      },
    ];
  }
  if (category === "hose-ends") {
    return [
      {
        alt: `${displayName}图片`,
        kind: "product",
        src:
          hoseEndMediaPath(mediaKey) ??
          hoseEndMediaPathFromDisplayName(displayName),
      },
    ];
  }
  return [{ alt: `${displayName}图片未记录`, kind: "product", src: null }];
}

function SnapshotPreviewImage({ part }: { part: SnapshotPreviewPart }) {
  return (
    <div className="customer-quote-preview-part" data-kind={part.kind}>
      {part.src ? (
        <img alt={part.alt} src={part.src} />
      ) : (
        <span aria-label={part.alt} className="customer-quote-preview-fallback">
          <Package aria-hidden="true" size={20} />
        </span>
      )}
    </div>
  );
}

function SnapshotProductPreview({
  className,
  line,
}: {
  className?: string;
  line: unknown;
}) {
  const parts = snapshotPreviewParts(line);
  return (
    <figure
      className={`customer-quote-product-preview${className ? ` ${className}` : ""}`}
      data-assembly={parts.length === 3 || undefined}
      data-compact
    >
      {parts.length > 0 ? (
        parts.map((part, partIndex) => (
          <SnapshotPreviewImage key={`${part.kind}-${partIndex}`} part={part} />
        ))
      ) : (
        <SnapshotPreviewImage
          part={{ alt: "商品图片未记录", kind: "product", src: null }}
        />
      )}
    </figure>
  );
}

export function AdminQuoteRequestPreview({ snapshot }: { snapshot: unknown }) {
  const lines = jsonArray(jsonPath(snapshot, "lines")) ?? [];
  const visibleLines = lines.slice(0, 3);
  return (
    <div
      aria-label={`提交商品图片，共 ${lines.length} 行`}
      className="admin-quote-request-preview"
      data-count={visibleLines.length}
    >
      {visibleLines.map((line, lineIndex) => {
        return <SnapshotProductPreview key={lineIndex} line={line} />;
      })}
      {lines.length > visibleLines.length ? (
        <span className="customer-quote-preview-more">
          +{lines.length - visibleLines.length}
        </span>
      ) : null}
    </div>
  );
}

export function SnapshotField({
  label,
  value,
}: {
  label: ReactNode;
  value: ReactNode;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value ?? missing}</dd>
    </div>
  );
}

function SnapshotFields({ children }: { children: ReactNode }) {
  return <dl className="admin-snapshot-fields">{children}</dl>;
}

function EndSnapshot({ end, label }: { end: unknown; label: string }) {
  const value = jsonObject(end);
  const hoseEnd = jsonObject(value?.hoseEnd);
  const ferrule = jsonObject(value?.ferrule);
  return (
    <section className="admin-snapshot-subsection">
      <h4>{label}</h4>
      <SnapshotFields>
        <SnapshotField
          label={
            <AdminTechnicalTerm explanation="商品的唯一库存识别编号">
              SKU
            </AdminTechnicalTerm>
          }
          value={valueText(hoseEnd?.sku)}
        />
        <SnapshotField label="名称" value={valueText(hoseEnd?.displayName)} />
        <SnapshotField
          label="连接标准 / 螺纹"
          value={
            jsonString(hoseEnd?.connectionStandard) ? (
              <>
                {connectionStandard(hoseEnd?.connectionStandard)}
                {jsonString(hoseEnd?.thread)
                  ? ` · ${jsonString(hoseEnd?.thread)}`
                  : null}
              </>
            ) : (
              missing
            )
          }
        />
        <SnapshotField
          label="连接尺寸 / 管尾尺寸"
          value={
            joined([hoseEnd?.connectionDash, hoseEnd?.hoseTailDash]) ?? missing
          }
        />
        <SnapshotField
          label="角度 / 密封形式"
          value={joined([hoseEnd?.angle, hoseEnd?.sealingForm]) ?? missing}
        />
        <SnapshotField
          label="兼容关系 ID"
          value={valueText(value?.compatibilityId)}
        />
        <SnapshotField
          label="总成工作压力"
          value={
            typeof value?.assemblyWorkingBar === "number"
              ? `${value.assemblyWorkingBar} bar`
              : missing
          }
        />
        <SnapshotField label="套筒 SKU" value={valueText(ferrule?.sku)} />
        <SnapshotField
          label="套筒系列 / 胶管结构"
          value={
            joined([ferrule?.series, ferrule?.hoseConstruction]) ?? missing
          }
        />
        <SnapshotField
          label="套筒管尾 / 剥胶要求"
          value={
            joined([ferrule?.hoseTailDash, ferrule?.skiveRequirement]) ??
            missing
          }
        />
      </SnapshotFields>
    </section>
  );
}

function ConfiguredAssemblySnapshot({
  line,
}: {
  line: Record<string, unknown>;
}) {
  const assembly = jsonObject(line.configuredAssembly);
  const snapshot = jsonObject(assembly?.snapshot);
  const configuration = jsonObject(snapshot?.configuration);
  const hose = jsonObject(configuration?.hose);
  const measurement = jsonObject(configuration?.measurementSelection);
  const method = jsonObject(measurement?.method);
  const length = jsonObject(configuration?.finishedLength);
  const tolerance = jsonObject(length?.tolerance);
  const clocking = jsonObject(configuration?.clocking);
  const protection = jsonObject(configuration?.installedProtection);
  const review = jsonObject(snapshot?.review);
  const issues = jsonArray(review?.issues) ?? [];
  const sourceRelease = jsonObject(snapshot?.sourceCatalogRelease);
  const estimate = jsonObject(assembly?.estimateBasis);
  const clockingAngle = submittedClockingAngle(clocking);

  return (
    <div className="admin-configured-snapshot">
      <section className="admin-snapshot-subsection">
        <h4>胶管</h4>
        <SnapshotFields>
          <SnapshotField
            label="系列 / 名称"
            value={joined([hose?.series, hose?.familyName]) ?? missing}
          />
          <SnapshotField
            label={
              <AdminTechnicalTerm explanation="商品的唯一库存识别编号">
                SKU
              </AdminTechnicalTerm>
            }
            value={valueText(hose?.sku)}
          />
          <SnapshotField
            label="Dash 号 / 公称内径"
            value={
              joined([
                hose?.dash,
                typeof hose?.nominalIdIn === "number"
                  ? `${hose.nominalIdIn} in ID`
                  : null,
              ]) ?? missing
            }
          />
          <SnapshotField
            label="标准"
            value={
              joined([hose?.primaryStandard, hose?.equivalentStandard]) ??
              missing
            }
          />
        </SnapshotFields>
      </section>

      <div className="admin-snapshot-pair">
        <EndSnapshot end={configuration?.endA} label="End A" />
        <EndSnapshot end={configuration?.endB} label="End B" />
      </div>

      <section className="admin-snapshot-subsection">
        <h4>长度、测量与接头相对角度（Clocking）</h4>
        <SnapshotFields>
          <SnapshotField
            label="成品总长"
            value={
              joined([
                length?.originalValue,
                length?.originalUnit,
                typeof length?.canonicalMm === "string"
                  ? `${length.canonicalMm} mm canonical`
                  : null,
              ]) ?? missing
            }
          />
          <SnapshotField
            label="测量方法"
            value={
              measurement?.state === "not_sure"
                ? "Not Sure · 需要人工确认"
                : (joined([method?.code, method?.displayName]) ?? missing)
            }
          />
          <SnapshotField
            label="长度公差"
            value={
              joined([tolerance?.display, tolerance?.scheduleVersion]) ??
              missing
            }
          />
          {clocking?.status === "specified" ? (
            <>
              <SnapshotField
                label="接头相对角度"
                value={`${valueText(clocking.targetDisplay)}° clockwise`}
              />
              <SnapshotField
                label="角度公差"
                value={`±${valueText(clocking.standardToleranceDegrees)}°`}
              />
            </>
          ) : clocking?.status === "not_sure" ? (
            <SnapshotField
              label="接头相对角度"
              value="Not Sure · 需要人工确认"
            />
          ) : null}
        </SnapshotFields>
        {clockingAngle !== null ? (
          <div className="admin-clocking-preview">
            <M08ClockingPreview angle={clockingAngle} />
          </div>
        ) : null}
      </section>

      <section className="admin-snapshot-subsection">
        <h4>保护层</h4>
        <SnapshotFields>
          <SnapshotField
            label="已安装保护层"
            value={
              joined([protection?.code, protection?.publicName]) ?? missing
            }
          />
        </SnapshotFields>
      </section>

      <section className="admin-snapshot-subsection">
        <h4>提交时审核结果与版本</h4>
        <SnapshotFields>
          <SnapshotField label="审核结果" value={valueText(review?.outcome)} />
          <SnapshotField
            label="来源目录发布版本"
            value={
              joined([sourceRelease?.number, sourceRelease?.id]) ?? missing
            }
          />
          <SnapshotField
            label="配置目录发布版本"
            value={
              joined([
                jsonPath(configuration, "catalogRelease", "number"),
                jsonPath(configuration, "catalogRelease", "id"),
              ]) ?? missing
            }
          />
          <SnapshotField
            label="估价版本"
            value={
              joined([
                estimate?.catalogReleaseId,
                estimate?.scheduleRecordVersion,
                estimate?.protectionRecordVersion,
              ]) ?? missing
            }
          />
        </SnapshotFields>
        {issues.length > 0 ? (
          <ul className="admin-review-issue-list">
            {issues.map((issueValue, index) => {
              const issue = jsonObject(issueValue);
              return (
                <li key={`${jsonString(issue?.code) ?? "issue"}-${index}`}>
                  <strong>{jsonString(issue?.kind) ?? "未分类"}</strong>
                  <span>{jsonString(issue?.message) ?? "快照未记录说明"}</span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </div>
  );
}

const productSpecLabels: Record<string, string> = {
  "Body material": "主体材料",
  "Body size": "主体尺寸",
  "Catalog model": "目录型号",
  Coating: "表面处理",
  "Connection form 1": "连接形式 1",
  "Connection form 2": "连接形式 2",
  "Connection mechanism": "连接机构",
  "Connection standard": "连接标准",
  Cover: "外胶层",
  "Equivalent standard": "等效标准",
  "Ferrule series": "套筒系列",
  "Fluid compatibility": "介质兼容性",
  Form: "形式",
  Gender: "公母形式",
  "Hose construction": "胶管结构",
  "Hose dash": "胶管 Dash 号",
  "Hose tail dash": "管尾 Dash 号",
  "Interface 1": "接口 1",
  "Interface 2": "接口 2",
  "Interface family": "接口系列",
  "Interchange standard": "互换标准",
  Material: "材料",
  "Maximum working pressure": "最大工作压力",
  "Minimum bend radius": "最小弯曲半径",
  "Minimum bore": "最小通径",
  "Minimum burst pressure": "最小爆破压力",
  "Nominal ID": "胶管内径（Hose Inside Diameter）",
  "Outside diameter": "外径",
  "Port gender": "端口公母形式",
  "Port interface": "端口接口",
  "Port thread": "端口螺纹",
  "Primary standard": "主要标准",
  Reinforcement: "增强层",
  Role: "角色",
  "Seal material": "密封材料",
  "Sealing form": "密封形式",
  "Size 1": "尺寸 1",
  "Size 2": "尺寸 2",
  "Skive requirement": "剥胶要求",
  "Temperature range": "温度范围",
  Thread: "螺纹",
  "Tube material": "内胶层材料",
  "Unit weight": "单件重量",
  Valving: "阀结构",
  Weight: "重量",
  "Working pressure": "工作压力",
};

const hiddenProductSpecs = new Set([
  "Cover",
  "Fluid compatibility",
  "Maximum working pressure",
  "Minimum bend radius",
  "Minimum burst pressure",
  "Reinforcement",
  "Temperature range",
  "Tube material",
  "Unit weight",
  "Weight",
  "Working pressure",
]);

function ProductParameterSnapshot({ line }: { line: Record<string, unknown> }) {
  const product = jsonObject(line.productSnapshot);
  if (!product) {
    return (
      <section className="admin-snapshot-subsection">
        <h4>产品参数（提交时快照）</h4>
        <p className="snapshot-warning">
          该 RFQ 提交时尚未保存产品参数快照，不能使用当前目录数据反推。
        </p>
      </section>
    );
  }
  const savedSpecs = jsonArray(product.specs) ?? [];
  const specs = savedSpecs.filter((specValue) => {
    const spec = jsonObject(specValue);
    const label = jsonString(spec?.label);
    return !label || !hiddenProductSpecs.has(label);
  });
  return (
    <section className="admin-snapshot-subsection">
      <h4>产品参数（提交时快照）</h4>
      <SnapshotFields>
        <SnapshotField
          label="产品类型"
          value={valueText(product.productType)}
        />
        <SnapshotField label="产品系列" value={valueText(product.familyName)} />
        {specs.map((specValue, index) => {
          const spec = jsonObject(specValue);
          const label = jsonString(spec?.label);
          return (
            <SnapshotField
              key={`${label ?? "parameter"}-${index}`}
              label={
                label ? (productSpecLabels[label] ?? label) : "参数名称未记录"
              }
              value={valueText(spec?.value)}
            />
          );
        })}
      </SnapshotFields>
      {savedSpecs.length === 0 ? (
        <p className="snapshot-warning">该商品没有已保存的参数项。</p>
      ) : null}
    </section>
  );
}

function LengthBasedSnapshot({ line }: { line: Record<string, unknown> }) {
  const length = jsonObject(line.lengthOrder);
  return (
    <section className="admin-snapshot-subsection">
      <h4>按长度销售胶管</h4>
      <SnapshotFields>
        <SnapshotField
          label="每件长度"
          value={
            joined(
              [length?.originalLengthValue, length?.originalLengthUnit],
              " ",
            ) ?? missing
          }
        />
        <SnapshotField
          label="标准化英尺"
          value={valueText(length?.normalizedLengthFt)}
        />
        <SnapshotField label="件数" value={valueText(length?.pieceCount)} />
        <SnapshotField label="总英尺" value={valueText(length?.totalFootage)} />
        <SnapshotField
          label="切割贴标费率"
          value={valueText(line.cuttingLabelingFeeRate)}
        />
        <SnapshotField
          label="切割贴标费"
          value={valueText(line.cuttingLabelingFeeAmount)}
        />
      </SnapshotFields>
    </section>
  );
}

export function AdminQuoteSnapshotLine({
  index,
  line: lineValue,
}: {
  index: number;
  line: unknown;
}) {
  const line = jsonObject(lineValue);
  if (!line) {
    return (
      <article className="admin-quote-line">
        <h3>商品行 {index + 1}</h3>
        <p className="snapshot-warning">
          该历史商品行不是可识别的对象，以下保留原始快照。
        </p>
        <SnapshotJson value={lineValue} />
      </article>
    );
  }
  const kind = jsonString(line.lineKind);
  const refresh = jsonObject(line.refresh);
  const current = jsonObject(refresh?.current);
  const release = jsonObject(refresh?.currentCatalogRelease);
  return (
    <article className="admin-quote-line">
      <header>
        <span className="admin-line-number">{index + 1}</span>
        <div>
          <span className="eyebrow">{kind ?? "未知商品类型"}</span>
          <h3>{jsonString(line.displayName) ?? "商品名称快照未记录"}</h3>
          <p>
            <AdminTechnicalTerm explanation="商品的唯一库存识别编号">
              SKU
            </AdminTechnicalTerm>{" "}
            {valueText(line.sku)}
          </p>
        </div>
        <SnapshotProductPreview
          className="admin-quote-line-preview"
          line={line}
        />
      </header>

      <SnapshotFields>
        <SnapshotField label="数量" value={valueText(line.quantity)} />
        <SnapshotField label="销售单位" value={valueText(line.salesUnit)} />
        <SnapshotField label="币种" value={valueText(line.currency)} />
        <SnapshotField
          label="目录版本 ID"
          value={valueText(line.catalogReleaseId)}
        />
        <SnapshotField
          label="提交参考单价"
          value={valueText(line.referenceUnitPrice)}
        />
        <SnapshotField
          label="提交商品金额"
          value={valueText(current?.discountedMerchandiseAmount)}
        />
        <SnapshotField
          label="折扣版本"
          value={valueText(current?.discountRecordVersion)}
        />
        <SnapshotField
          label="刷新目录版本"
          value={joined([release?.number, release?.id]) ?? missing}
        />
      </SnapshotFields>

      {kind === "length_based_hose" ? (
        <>
          <ProductParameterSnapshot line={line} />
          <LengthBasedSnapshot line={line} />
        </>
      ) : null}
      {kind === "standard" ? <ProductParameterSnapshot line={line} /> : null}
      {kind === "configured_assembly" ? (
        <ConfiguredAssemblySnapshot line={line} />
      ) : null}
      <SnapshotJson label={`商品行 ${index + 1} 原始快照`} value={lineValue} />
    </article>
  );
}

export function SnapshotJson({
  label = "查看原始询价快照",
  value,
}: {
  label?: string;
  value: unknown;
}) {
  return (
    <details className="admin-raw-snapshot">
      <summary>{label}</summary>
      <pre>{JSON.stringify(value, null, 2) ?? "null"}</pre>
    </details>
  );
}
