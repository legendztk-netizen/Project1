import type { ReactNode } from "react";

import {
  jsonArray,
  jsonObject,
  jsonPath,
  jsonString,
} from "../domain/admin-quote-review";
import { AdminTechnicalTerm } from "../../admin/ui/admin-technical-term";

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
  const performance = jsonObject(hose?.performance);
  const measurement = jsonObject(configuration?.measurementSelection);
  const method = jsonObject(measurement?.method);
  const diagram = jsonObject(measurement?.diagram);
  const length = jsonObject(configuration?.finishedLength);
  const tolerance = jsonObject(length?.tolerance);
  const clocking = jsonObject(configuration?.clocking);
  const convention = jsonObject(clocking?.convention);
  const protection = jsonObject(configuration?.installedProtection);
  const application = jsonObject(configuration?.applicationRequirements);
  const maxPressure = jsonObject(application?.maximumWorkingPressure);
  const minTemperature = jsonObject(application?.minimumOperatingTemperature);
  const maxTemperature = jsonObject(application?.maximumOperatingTemperature);
  const review = jsonObject(snapshot?.review);
  const issues = jsonArray(review?.issues) ?? [];
  const sourceRelease = jsonObject(snapshot?.sourceCatalogRelease);
  const estimate = jsonObject(assembly?.estimateBasis);

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
          <SnapshotField
            label="增强层"
            value={valueText(hose?.reinforcement)}
          />
          <SnapshotField
            label="胶管性能"
            value={
              joined([
                typeof performance?.workingBar === "number"
                  ? `${performance.workingBar} bar`
                  : null,
                typeof performance?.workingPsi === "number"
                  ? `${performance.workingPsi} psi`
                  : null,
                typeof performance?.temperatureMinC === "number" &&
                typeof performance?.temperatureMaxC === "number"
                  ? `${performance.temperatureMinC}–${performance.temperatureMaxC} °C`
                  : null,
              ]) ?? missing
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
            label="测量版本"
            value={
              joined([
                method?.recordVersion,
                diagram?.assetVersion,
                diagram?.overlayVersion,
              ]) ?? missing
            }
          />
          <SnapshotField
            label="长度公差"
            value={
              joined([tolerance?.display, tolerance?.scheduleVersion]) ??
              missing
            }
          />
          <SnapshotField
            label="长度审核路径"
            value={
              joined([
                length?.path,
                ...(jsonArray(length?.manualReviewReasons) ?? []),
              ]) ?? missing
            }
          />
          <SnapshotField
            label="接头相对角度"
            value={
              clocking?.status === "specified"
                ? `${valueText(clocking.targetDisplay)}° clockwise · ±${valueText(clocking.standardToleranceDegrees)}°`
                : clocking?.status === "not_sure"
                  ? "Not Sure · 需要人工确认"
                  : "不适用或快照未记录"
            }
          />
          <SnapshotField
            label="角度规则版本"
            value={
              joined([
                convention?.code,
                convention?.recordVersion,
                convention?.rendererVersion,
              ]) ?? missing
            }
          />
        </SnapshotFields>
      </section>

      <section className="admin-snapshot-subsection">
        <h4>保护层与应用参数</h4>
        <SnapshotFields>
          <SnapshotField
            label="已安装保护层"
            value={
              joined([protection?.code, protection?.publicName]) ?? missing
            }
          />
          <SnapshotField
            label="保护层版本"
            value={valueText(protection?.recordVersion)}
          />
          <SnapshotField
            label="介质"
            value={valueText(application?.fluidMedium)}
          />
          <SnapshotField
            label="最大工作压力"
            value={
              joined([maxPressure?.originalValue, maxPressure?.originalUnit]) ??
              "未提供（Optional）"
            }
          />
          <SnapshotField
            label="工作温度"
            value={
              joined([
                minTemperature?.originalValue,
                maxTemperature?.originalValue,
                minTemperature?.originalUnit,
              ]) ?? "未提供（Optional）"
            }
          />
          <SnapshotField
            label="应用审核原因"
            value={
              joined(jsonArray(application?.reviewReasons) ?? []) ??
              "未提供（Optional）"
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
        <LengthBasedSnapshot line={line} />
      ) : null}
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
