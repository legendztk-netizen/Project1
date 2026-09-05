import { Save, Search } from "lucide-react";
import { Form } from "react-router";

import type {
  CatalogSeriesOption,
  CommercialProductType,
  CommercialSkuRecord,
  SeriesCommercialRule,
  SkuPricePackaging,
} from "../../catalog/domain/catalog-commercial-maintenance";

const productTypeLabels: Record<CommercialProductType, string> = {
  adapter: "Adapter / 过渡接头",
  ferrule: "Ferrule / 套筒",
  hose: "Hose / 胶管",
  hose_end: "Hose End / 压接接头",
  quick_coupler: "Quick Coupler / 快速接头",
};

function optionalValue(value: number | string | null | undefined) {
  return value ?? "";
}

export function CatalogCommercialMaintenance({
  exact,
  formError,
  productType,
  rule,
  selectedSeries,
  series,
  sku,
  skuRecord,
}: {
  exact: SkuPricePackaging | null;
  formError: string | null;
  productType: CommercialProductType;
  rule: SeriesCommercialRule | null;
  selectedSeries: string;
  series: CatalogSeriesOption[];
  sku: string;
  skuRecord: CommercialSkuRecord | null;
}) {
  return (
    <>
      {formError ? <p className="form-error">{formError}</p> : null}
      <section className="catalog-upload-panel">
        <div>
          <div>
            <h2>Series Commercial Rule / 系列销售、包装和价格规则</h2>
            <p>
              Variants continuously inherit this current rule. /
              子体持续继承当前系列规则。
            </p>
          </div>
        </div>
        <Form method="get">
          <label>
            <span>Product Type / 产品类型</span>
            <select defaultValue={productType} name="productType">
              {Object.entries(productTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Series / 系列</span>
            <select defaultValue={selectedSeries} name="series">
              <option value="">Select series / 选择系列</option>
              {series.map((item) => (
                <option key={item.seriesCode} value={item.seriesCode}>
                  {item.seriesCode} · {item.seriesName}
                </option>
              ))}
            </select>
          </label>
          <button className="button button-secondary" type="submit">
            <Search size={16} /> Load / 加载
          </button>
        </Form>
        {selectedSeries ? (
          <Form method="post" noValidate>
            <input name="intent" type="hidden" value="save_series_rule" />
            <input name="productType" type="hidden" value={productType} />
            <input name="seriesCode" type="hidden" value={selectedSeries} />
            <label>
              <span>Sales Unit / 销售单位</span>
              <input
                defaultValue={rule?.salesUnit ?? ""}
                name="salesUnit"
                required
              />
            </label>
            <label>
              <span>MOQ / 最小起订量</span>
              <input
                defaultValue={rule?.moq ?? ""}
                min="0"
                name="moq"
                required
                type="number"
              />
            </label>
            <label>
              <span>Lead Time days / 交期天数</span>
              <input
                defaultValue={rule?.leadTimeDays ?? ""}
                min="0"
                name="leadTimeDays"
                required
                type="number"
              />
            </label>
            <label>
              <span>Country of Origin / 原产国</span>
              <input
                defaultValue={rule?.countryOfOrigin ?? ""}
                name="countryOfOrigin"
                required
              />
            </label>
            <label>
              <span>HS Code / 海关编码</span>
              <input defaultValue={optionalValue(rule?.hsCode)} name="hsCode" />
            </label>
            <label>
              <span>Quantity Input Mode / 数量输入方式</span>
              <input
                defaultValue={rule?.quantityInputMode ?? ""}
                name="quantityInputMode"
                required
              />
            </label>
            <label>
              <span>Minimum Length per Piece ft / 每根最小长度（英尺）</span>
              <input
                defaultValue={optionalValue(rule?.minimumLengthPerPieceFt)}
                min="0"
                name="minimumLengthPerPieceFt"
                step="any"
                type="number"
              />
            </label>
            <label>
              <span>Length Increment ft / 长度步长（英尺）</span>
              <input
                defaultValue={optionalValue(rule?.lengthIncrementFt)}
                min="0"
                name="lengthIncrementFt"
                step="any"
                type="number"
              />
            </label>
            {[1, 2, 3].map((number) => (
              <label key={number}>
                <span>{`Preset Length ${number} ft / 快捷长度${number}（英尺）`}</span>
                <input
                  defaultValue={optionalValue(
                    rule?.[`presetLength${number}Ft` as "presetLength1Ft"],
                  )}
                  min="0"
                  name={`presetLength${number}Ft`}
                  step="any"
                  type="number"
                />
              </label>
            ))}
            <label>
              <span>Continuous Length Confirmation / 连续长度确认</span>
              <input
                defaultValue={optionalValue(rule?.continuousLengthConfirmation)}
                name="continuousLengthConfirmation"
              />
            </label>
            <label>
              <span>Notes / 备注</span>
              <textarea
                defaultValue={optionalValue(rule?.notes)}
                name="notes"
              />
            </label>
            <button className="button button-primary" type="submit">
              <Save size={16} /> Save Series Rule / 保存系列规则
            </button>
          </Form>
        ) : null}
      </section>

      <section className="catalog-upload-panel">
        <div>
          <div>
            <h2>Exact SKU Price and Packaging / 子体价格和包装</h2>
            <p>
              Online products require a retail price before publication. /
              上线产品发布前必须填写零售价格。
            </p>
          </div>
        </div>
        <Form method="get">
          <input name="productType" type="hidden" value={productType} />
          {selectedSeries ? (
            <input name="series" type="hidden" value={selectedSeries} />
          ) : null}
          <label>
            <span>Product SKU / 产品 SKU</span>
            <input defaultValue={sku} name="sku" />
          </label>
          <button className="button button-secondary" type="submit">
            <Search size={16} /> Search / 搜索
          </button>
        </Form>
        {skuRecord ? (
          <Form method="post" noValidate>
            <input name="intent" type="hidden" value="save_sku_price" />
            <label>
              <span>Sales SKU / 销售 SKU</span>
              <input name="sku" readOnly value={skuRecord.sku} />
            </label>
            <label>
              <span>Retail Unit Price / 零售单价</span>
              <input
                defaultValue={optionalValue(exact?.referencePrice)}
                min="0"
                name="referencePrice"
                step="any"
                type="number"
              />
            </label>
            <label>
              <span>Currency / 币种</span>
              <input readOnly value="USD" />
            </label>
            <label>
              <span>Package Length ft / 包装长度（英尺）</span>
              <input
                defaultValue={optionalValue(exact?.packageLengthFt)}
                min="0"
                name="packageLengthFt"
                step="any"
                type="number"
              />
            </label>
            <label>
              <span>Units per Sales Pack / 每销售包装数量</span>
              <input
                defaultValue={optionalValue(exact?.unitsPerSalesPack)}
                min="0"
                name="unitsPerSalesPack"
                step="any"
                type="number"
              />
            </label>
            <label>
              <span>Net Unit Weight kg / 单个销售单位净重（千克）</span>
              <input
                defaultValue={optionalValue(exact?.netUnitWeightKg)}
                min="0"
                name="netUnitWeightKg"
                step="any"
                type="number"
              />
            </label>
            <label>
              <span>Inner Pack Qty / 内包装数量</span>
              <input
                defaultValue={optionalValue(exact?.innerPackQty)}
                min="0"
                name="innerPackQty"
                step="any"
                type="number"
              />
            </label>
            <label>
              <span>Master Carton Qty / 每外箱数量</span>
              <input
                defaultValue={optionalValue(exact?.masterCartonQty)}
                min="0"
                name="masterCartonQty"
                step="any"
                type="number"
              />
            </label>
            <label>
              <span>Carton Gross Weight kg / 整箱毛重（千克）</span>
              <input
                defaultValue={optionalValue(exact?.cartonGrossWeightKg)}
                min="0"
                name="cartonGrossWeightKg"
                step="any"
                type="number"
              />
            </label>
            <label>
              <span>Carton L cm / 箱长（厘米）</span>
              <input
                defaultValue={optionalValue(exact?.cartonLCm)}
                min="0"
                name="cartonLCm"
                step="any"
                type="number"
              />
            </label>
            <label>
              <span>Carton W cm / 箱宽（厘米）</span>
              <input
                defaultValue={optionalValue(exact?.cartonWCm)}
                min="0"
                name="cartonWCm"
                step="any"
                type="number"
              />
            </label>
            <label>
              <span>Carton H cm / 箱高（厘米）</span>
              <input
                defaultValue={optionalValue(exact?.cartonHCm)}
                min="0"
                name="cartonHCm"
                step="any"
                type="number"
              />
            </label>
            <label>
              <span>Packing Basis / 装箱依据</span>
              <input
                defaultValue={optionalValue(exact?.packingBasis)}
                name="packingBasis"
              />
            </label>
            <button className="button button-primary" type="submit">
              <Save size={16} /> Save SKU Price / 保存子体价格
            </button>
          </Form>
        ) : sku ? (
          <p>SKU not found / 未找到 SKU</p>
        ) : null}
      </section>
    </>
  );
}
