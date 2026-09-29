# Spec 9: Product Series, Variant, and Commercial Rule Maintenance

> Status: Completed. Extends Spec 8 and supersedes its flat manual-product entry
> and inline worksheet 07 entry decisions where this Spec differs.

## Problem Statement

Product Data Maintenance currently treats each exact SKU as one flat record.
Hose and Hose End variants repeat characteristics that belong to their product
series, product images cannot be inherited explicitly from a maintained series,
and sales, packaging, and price data are mixed into the product-entry form.
This makes a small series-wide correction repetitive and allows text values to
drift between otherwise related variants.

## Solution

Introduce versioned Hose Series and Hose End Series records and make each Hose
or Hose End variant select an existing series. Maintain series and variants
through bilingual modal forms opened from Product Data Maintenance. A series
has an immutable code, an editable name, shared attributes, and a shared
representative image; a variant inherits the series and may select an image
override. Move commercial maintenance into a third Product Data Maintenance
submenu where every product series owns one shared sales rule while exact SKUs
retain their own retail price and optional packaging data.

## User-visible Navigation and Forms

- Hovering or focusing Hose or Hose End in Manual Add/Edit exposes two actions:
  Add Series and Add Variant. Selecting an action opens its modal form.
- All new headings, fields, buttons, guidance, controlled-value labels, and
  validation messages inside product-parameter submission and editing forms
  display English and Chinese. Stable English codes remain the stored values.
- Admin navigation and Product Review and Publication controls, guidance, and
  validation messages remain Simplified Chinese.
- Product Data Maintenance has a third submenu named Sales, Packaging and Price
  / 销售、包装和价格.
- Product-entry modals contain no sales, packaging, or price fields.

## Series Identity and Media

- Hose Series and Hose End Series each have a required Series Code / 系列编号
  and Series Name / 系列名称.
- Series Code is immutable after creation. Series Name is editable in a Catalog
  draft.
- A series referenced by any variant cannot be deleted.
- Each series resolves one shared representative image. A variant inherits that
  image unless it selects an optional reviewed override image.
- Series and image changes remain versioned Catalog draft data and become
  customer-visible only through Catalog publication.

## Hose Series Contract

Required fields:

- Series Code / 系列编号
- Series Name / 系列名称
- Primary Standard / 主标准
- Equivalent Standard / 等效标准
- Temp Min °C / 最低温度
- Temp Max °C / 最高温度

Optional fields:

- Tube Material / 内胶材料
- Reinforcement / 增强层
- Cover Material / 外胶材料
- Cover Color / 外胶颜色
- Cover Finish / 表面
- Fluid Compatibility / 介质兼容

## Hose Variant Contract

Required fields:

- Product Status / 产品状态: Online / 上线, Draft / 草稿, or Discontinued / 停用
- Hose Series / 胶管系列, selected from existing series
- Hose SKU / 胶管SKU
- Hose Dash / 胶管Dash
- Nominal ID in / 公称内径英寸
- ID mm / 内径毫米
- OD mm / 外径毫米
- Working Pressure bar / 工作压力
- Working Pressure psi / 工作压力
- Minimum Burst bar / 最小爆破压力
- Min Bend Radius mm / 最小弯曲半径
- Weight kg/m / 米重
- Notes / 备注

Optional fields:

- Source Document/Page / 来源文件页码
- Technical Data Status / 技术资料状态
- MSHA Marking / MSHA标识
- Skive Requirement / 剥胶要求
- Variant image override / 子体图片覆盖

## Hose End Series Contract

Required fields:

- Series Code / 系列编号
- Series Name / 系列名称
- Interface Family / 接口体系
- Interface Standard / 接口标准
- Gender / 公母
- Swivel/Fixed / 旋转或固定
- Angle / 角度
- Sealing Form / 密封形式

## Hose End Variant Contract

Required fields:

- Product Status / 产品状态: Online / 上线, Draft / 草稿, or Discontinued / 停用
- Fitting Series / 接头系列, selected from existing series
- Hose End SKU / 接头SKU
- Thread / 螺纹
- Connection Dash / 接口Dash
- Hose Tail Dash / 胶管尾Dash
- Material / 材质
- Coating / 表面处理
- Salt Spray h / 盐雾小时
- Max Working bar / 最大工作压力
- Dimension A mm / 总长A
- Cut-off B mm / 扣除量B
- Hex 1 mm / 六角1
- Hex 2 mm / 六角2
- Minimum Bore mm / 最小通径
- Unit Weight g / 单重
- Notes / 备注

Optional fields:

- Competitor Part No. / 竞品参考料号
- Drawing No. / 图纸号
- Drawing Rev / 图纸版本
- Source Document/Page / 来源
- Technical Data Status / 技术资料状态
- Variant image override / 子体图片覆盖

## Product Status Mapping

Variants expose only three business statuses. Internal product, price, RFQ,
and supply fields remain synchronized:

- Online / 上线 maps to Published, Eligible, and Available for Quote.
- Draft / 草稿 maps to Draft and unavailable for customer quote.
- Discontinued / 停用 maps to Archived, Blocked, and Discontinued.

The internal fields are not separate form controls.

## Series Commercial Rule

Every Hose, Hose End, Ferrule, Adapter, and Quick Coupler series has one
editable shared commercial rule containing:

- Sales Unit / 销售单位
- MOQ / 最小起订量
- Lead Time days / 交期天数
- Country of Origin / 原产国
- HS Code / 海关编码
- Notes / 备注
- Quantity Input Mode / 数量输入方式
- Minimum Length per Piece ft / 每根最小长度
- Length Increment ft / 长度步长
- Preset Length 1/2/3 ft / 快捷长度1、2、3
- Continuous Length Confirmation / 连续长度确认

Variants continuously inherit this rule. Editing it in a Catalog draft affects
all variants in that series but does not overwrite their SKU-level prices or
packaging values.

## SKU Price and Packaging Contract

Required or generated fields:

- Sales SKU / 销售SKU is generated from the Product SKU and is not entered
  again.
- Retail Unit Price / 零售单价 is required before an Online variant can publish.
- Currency / 币种 is retained in the data model; the first release fixes and
  defaults it to USD without a manual selector.

Optional fields:

- Package Length ft / 包装长度
- Units per Sales Pack / 每销售包装数量
- Net Unit Weight kg / 单个销售单位净重
- Inner Pack Qty / 内包装数量
- Master Carton Qty / 每外箱数量
- Carton Gross Weight kg / 整箱毛重
- Carton L/W/H cm / 箱长、箱宽、箱高
- Packing Basis / 装箱依据

Factory Unit Price, purchasing Incoterms, and private cost tiers remain outside
this customer-facing commercial maintenance surface.

## Draft Review and Publication

- Product and series forms may save valid records into the current internal
  Catalog draft without inline commercial data.
- An Online variant without a valid SKU Retail Unit Price is blocked from
  publication.
- A series attribute, representative image, or shared commercial-rule change
  appears in the Draft as affecting every inherited variant in that series.
- Compatibility expansion and affected Assembly Series regeneration continue
  to follow the Spec 8 rules and run through 校验、更新总成并发布.
- Publication remains atomic; failure retains the Draft and leaves Active and
  customer-facing data unchanged.

## Testing Decisions

- Migration tests prove existing Hose and Hose End data groups into series
  without losing variant, price, image, or historical-release data.
- Contract tests distinguish series-owned, inherited, variant-owned, required,
  generated, and optional fields.
- UI tests cover hover, focus, keyboard access, modal dismissal, bilingual
  product-parameter forms, Chinese navigation and publication controls, series
  selection, and validation errors.
- Repository and route tests prove immutable Series Codes, editable names,
  delete restriction, representative-image inheritance, optional overrides,
  continuous commercial-rule inheritance, and SKU price isolation.
- End-to-end tests prove a new series, variant, series rule, and SKU price can be
  saved, reviewed as one Draft, and atomically published through the existing
  combined command.

## Out of Scope

- Independent lifecycle statuses for series.
- Additional product types beyond the five named commercial-rule owners.
- Additional currencies in the first release; the schema only preserves the
  future extension point.
- Moving private Cost Basis data into Product Data Maintenance.
- Changing Spec 8 compatibility matching, assembly SKU identity, customer
  measurement method, Clocking, Installed Protection, or production validation.

## Relationship to Spec 8

Spec 9 supersedes the Spec 8 decisions that place worksheet 07 data inside each
manual product form, model Hose and Hose End maintenance only as flat exact-SKU
forms, or require the representative image to be owned only by the exact SKU.
Spec 8 remains authoritative for the current Catalog draft, three-state product
lifecycle, automatic compatibility expansion, affected-series regeneration,
and atomic Product Review and Publication workflow.

Published Spec: https://github.com/legendztk-netizen/Project1/issues/75
