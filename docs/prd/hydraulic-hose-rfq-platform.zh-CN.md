# 北美液压软管询价与定制平台 PRD

> 文档状态：已确认需求汇总稿  
> 版本：1.0  
> 更新日期：2026-09-02  
> 目标市场：北美，首发以美国为主  
> 卖方主体：Hangzhou Rongyao Trading Co., Ltd.  
> 前台品牌：待最终确认；`Rongyao Hydraulics` 仅为开发占位名称

## 1. 文档目的

本文档将项目前期讨论、`grill with docs` 访谈结论、已确认 ADR、产品数据模型和各业务 Spec 汇总为一份顶层产品需求文档，用于统一产品、设计、开发、测试和运营对首版网站的理解。

本文档描述全局业务目标与模块边界，不代替各模块 Spec 的详细验收规则。发生冲突时，按以下顺序判断：

1. 用户最后明确确认的决定；
2. 已接受的 ADR；
3. 对应模块的最新 Spec；
4. 本 PRD；
5. 早期范围文档、备忘录和聊天记录。

## 2. 产品概述

建设一个面向北美客户的英文液压软管产品与定制询价平台。网站同时提供：

- 标准液压胶管、压接接头、过渡接头和快速接头目录；
- 可校验兼容关系的液压胶管总成配置器；
- Quote List、询价、报价、PI、人工付款确认和正式订单流程；
- 管理后台、工厂移动作业页、物流进度和售后处理；
- 每根定制总成的二维码追溯能力。

网站不是在线即时结账商城。客户先选择产品或完成总成配置，通过 `Quote List` 提交询价；卖方确认技术方案、价格、运费、税费、贸易术语和交期后签发 PI，并在实际收到款项后安排生产或发货。

## 3. 背景与机会

### 3.1 客户问题

- 液压胶管、接头、套筒之间存在复杂兼容关系，普通客户难以仅凭型号正确选择。
- 客户可能只知道尺寸、接口、角度、压力、应用设备或现有零件外形。
- 传统产品目录提供大量料号，但通常不能阻止错误组合。
- 定制总成还涉及成品总长测量、双弯头 Clocking、保护层和应用条件等要求。
- 中国直发北美需要在报价前确认运费、贸易术语、税务处理、交期和进口责任。

### 3.2 商业机会

- 利用中国工厂现有压接和液压耐压测试设备，以较低固定成本启动项目。
- 通过配置器而非单纯商品货架形成差异化，提高有效询盘质量。
- 同时覆盖个人客户、小型维修商、终端企业和后续批发客户。
- 通过网站生成生产资料和二维码，降低销售到工厂之间的重复录入与沟通成本。

## 4. 产品目标

### 4.1 首版目标

1. 让客户能找到合适的标准产品，并使用 `Add to Quote` 加入 Quote List。
2. 让客户能完成受兼容数据约束的双端液压胶管总成配置。
3. 在不强制提前注册的情况下，尽量减少客户放弃配置或询价。
4. 将已验证的询价顺畅推进到 Quote、PI、付款确认和正式订单。
5. 让两名初始管理人员通过一个后台完成产品、报价、订单、生产、发货和售后操作。
6. 给中国工厂提供简单、少文字、可在微信内打开的移动作业流程。
7. 为每根出厂总成建立可追溯但不过度暴露内部信息的二维码记录。

### 4.2 商业目标

- 前期优先增加有效访问、配置完成率和询价数量。
- 不以在线支付转化率为目标，因为首版不提供网站结账。
- 不追求一次性覆盖所有特殊接口和制造组合；不支持的需求进入人工询价。

### 4.3 尚未设定的量化指标

以下指标应在上线前建立埋点，但当前没有经过确认的目标值，不得自行编造：

- 产品页到 Quote List 的加入率；
- 配置器开始率、完成率和错误退出率；
- Quote List 到 RFQ 的提交率；
- RFQ 到 PI、PI 到付款确认的转化率；
- 首次人工响应时间和 Quote 周期；
- 配置错误、售后和复购比例。

## 5. 用户与角色

| 角色             | 定义                           | 核心需求                                                  |
| ---------------- | ------------------------------ | --------------------------------------------------------- |
| 游客             | 未验证邮箱的访问者             | 浏览、配置、建立匿名 Quote List                           |
| 个人客户         | 以个人法定身份询价和采购       | 提交个人 RFQ、接受 PI、查看订单                           |
| 企业客户         | 以公司法定身份询价和采购       | 使用 Organization Purchasing Context 提交 RFQ             |
| 批发客户         | 后续获批特定商业条款的企业客户 | 首版沿用企业流程，专属条款后续扩展                        |
| Owner            | 唯一主后台账号                 | 拥有全部业务和子账号管理权限                              |
| Admin Subaccount | Owner 创建的独立员工账号       | 按勾选权限操作；首个子账号除创建/管理子账号外拥有全部权限 |
| 工厂工人         | 通过限时批次链接进入的操作人员 | 查看简明作业要求、扫码、上传照片和选择结果                |
| 二维码访客       | 扫描成品总成标签的人           | 查看有限的公开产品验证信息                                |

客服聊天只帮助客户识别不认识或不确定的总成配件，不代替网站选品、配置、提交询价或下单流程。

## 6. 产品范围

### 6.1 核心胶管系列

- `601R1`：SAE 100 R1AT / EN 853 1SN；
- `601R2`：SAE 100 R2AT / EN 853 2SN；
- `EN1SC`：EN 857 1SC；
- `EN2SC`：EN 857 2SC；
- `EN4SP`：EN 856 4SP；
- `EN4SH`：EN 856 4SH。

### 6.2 标准商品类别

- Packaged Hose：固定长度包装胶管；
- Length-Based Hose：客户指定长度的裁切胶管；
- Crimp Hose Ends：压接接头；
- Ferrules：套筒，主要作为总成自动解析的内部组件；
- Adapters：过渡接头；
- Quick Couplers：快速接头；
- Made-to-order Hose Assemblies：定制胶管总成。

规划基线包括 82 个固定包装胶管销售 SKU、136 个核心过渡接头 SKU、57 个快速接头 SKU，以及持续扩展的压接接头 SKU。实际可发布数量以通过校验并激活的 Catalog Release 为准，代码和页面不得写死 SKU 总数。

### 6.3 包装胶管规则

- 1 英寸及以下可以固定包装长度销售。
- 1/2 英寸及以下提供 50 ft、100 ft。
- 5/8 英寸至 1 英寸提供 25 ft、50 ft。
- 1 英寸以上作为大口径胶管展示，仅接受定制询价。
- 客户指定任意裁切长度时属于 Length-Based Hose，适用定制生产和取消规则。

### 6.4 总成首发尺寸

配置器支持 Dash `-4`、`-6`、`-8`、`-10`、`-12`、`-16`，对应 1/4、3/8、1/2、5/8、3/4 和 1 英寸内径。Dash `-3`、`-5`、`-14` 等其他尺寸可以作为商品存在，但总成配置需人工审核。

### 6.5 接口范围

前台按以下 Interface Family 分组：

- JIC 37°；
- NPT/NPTF；
- ORFS；
- BSPP/BSPT。

数据层必须永久保留精确的 Connection Standard、螺纹、性别、密封形式、连接尺寸、胶管尾尺寸和角度。NPT 与 NPTF、BSPP 与 BSPT 不得因前台分组而合并。

DIN、JIS、Komatsu、特殊法兰、焊接和 Stand Tube 等未进入引导配置的类型仍可展示或接受人工询价，不得伪装成已自动验证的组合。

### 6.6 SKU 规则

- 胶管：`系列号_三位序号`，例如 `601R2_001`。
- 压接接头：`系列号_Gender_SwivelOrFixed_ConnectionDash_HoseTailDash`，例如 `JIC_F_SW_06_06`。
- 套筒：`系列号_HoseConstruction_三位序号`。
- 过渡接头：`ADP_形状_接口1_连接形式1_尺寸1_接口2_连接形式2_尺寸2`。
- 快速接头：`QDC_标准_角色_BodyDash_后端接口_PortDash`。
- 兼容组合：`COMP_四位序号`。

## 7. 全局产品数据模型

### 7.1 设计原则

- Excel 是产品数据导入和审核来源，不是线上交易数据库。
- D1 中已发布的 Catalog Release 是前台产品事实来源。
- 产品定义与交易快照分离；产品更新不能改写历史 RFQ、PI、订单和总成记录。
- 前台分组标签不得替代精确工程属性。
- RFQ 可选不等于已通过生产验证。

### 7.2 核心对象

| 对象                       | 责任                                            |
| -------------------------- | ----------------------------------------------- |
| Catalog Product Family     | 面向客户的产品系列页，聚合同类尺寸或接口变体    |
| SKU Variant                | 可进入询价和交易快照的精确商品                  |
| Hose Series                | 胶管系列标准、结构和公共别名                    |
| Hose Size Variant          | 系列与具体内径的精确组合                        |
| Connection Standard        | 精确接口、螺纹系统、密封形式与标准              |
| Hose End                   | 精确压接接头 SKU 及其接口、形状、尺寸和尾端属性 |
| Ferrule                    | 精确套筒 SKU 及适用结构、尺寸、材质和表面处理   |
| RFQ-Eligible Combination   | 胶管、接头、套筒的精确可询价关系                |
| Adapter / Quick Coupler    | 独立销售的过渡接头和快速接头                    |
| Measurement Endpoint Class | 接头成品长度测量端点分类                        |
| Length Measurement Method  | M01-M07 有序映射、规则、图和版本                |
| Clocking Convention        | 双弯头角度规则、方向、容差和示意版本            |
| Installed Protection       | 保护层选项、适用范围、价格和版本                |
| Assembly Estimate Schedule | 胶管、两端接头、套筒、装配和保护层的估价输入    |
| Catalog Release            | 一次原子发布的产品、兼容性、价格和视觉版本      |

### 7.3 七张产品表

1. `01_胶管主数据`；
2. `02_压接接头`；
3. `03_套筒`；
4. `04_兼容压接`；
5. `05_过渡接头`；
6. `06_快速接头`；
7. `07_价格包装`。

工作簿必须整体校验后形成一个 Draft Catalog Release。发布必须是原子操作，不能让前台看到跨表不一致的部分数据。

`Catalog Publication Status`、`Supply Availability`、`RFQ Eligibility`、`Qualification Status` 和 `Technical Data Status` 是独立字段。导入时缺少 Supply Availability 的商品默认 `Temporarily Unavailable`，后台支持按工作表类别、胶管系列或多选商品批量修改，避免逐个开放数百个 SKU。

首批数据以及后续新增 SKU、整套新系列都使用同一流程：`数据导入 → Draft Catalog Release → 产品目录检查或批量调整 → Preview 确认 → 全量校验并原子发布`。后台不设置独立的“目录发布”菜单。产品目录中的一次确认会处理整个草稿版本，而不只是当前筛选或选中的 SKU；系统自动比较线上版本、汇总新增/修改/下架、检查产品与配置器数据，并在无阻断错误时切换完整版本。阻断错误直接显示在产品目录中，草稿保留且线上版本不变。

### 7.4 兼容性与责任边界

- 配置器只允许存在精确 RFQ-Eligible Combination 的胶管、接头和套筒组合。
- 禁止仅根据 Dash 相同、螺纹相似、名称相近或图片相似推断兼容性。
- 当前市场参考数据可以用于 RFQ 选择，但不能向客户宣称已经测试或生产批准。
- PI 签发前，卖方必须确认组合可生产，或向客户提供经审核的替代方案。
- 缺少或歧义的测量端点映射自动降级为 `Manual Quote Only`，系统不得猜测。

## 8. 客户前台

### 8.1 信息架构

- 首页直接突出产品目录和 `Build a Hose`，不做纯营销落地页。
- 产品目录按胶管、接头、过渡接头、快速接头等分类浏览和搜索。
- 同一系列的尺寸 SKU 聚合到标准 Product Family 页面，通过变体选择切换。
- 标准商品按钮统一使用 `Add to Quote`。
- 配置总成按钮使用 `Add Assembly to Quote`。
- Quote List 提交按钮使用 `Request Quote`。
- 产品页不使用 `Request Quote` 代替 `Add to Quote`。

### 8.2 前台措辞

普通美国零售客户不需要在所有页面看到大量 RFQ、PI 等外贸术语：

- 前台临时清单称 `Quote List`；
- 个人中心使用 `My Quotes` 汇总 RFQ、Quote 和 PI；
- `Orders` 只显示已付款确认后创建的正式订单；
- 详情页可以显示 `RFQ Submitted → Quote Ready → PI Accepted → Payment Pending → Payment Confirmed → Order Created`。

### 8.3 产品图片

- 产品图片用于帮助客户识别外形，不作为制造图纸或兼容性依据。
- 胶管和接头可使用经过人工审核的 AI 重绘图片，但必须保持实际产品结构、比例、角度和密封特征。
- 相同外形类别可以共享代表图，精确 SKU 仍由文字参数和数据关系确定。

### 8.4 支持聊天

- 聊天入口用于咨询不认识或不确定的配件。
- 客服可以帮助客户定位候选商品或配置步骤。
- 聊天不直接创建订单、不代替 Quote List、不提交 RFQ，也不承诺兼容或生产。
- 客服回答后，客户仍回到网站正常流程完成配置与询价。

## 9. 总成配置器

### 9.1 配置顺序

1. 选择胶管系列和 Hose Size Variant；
2. 选择 End A；
3. 选择 End B；
4. 选择 M01-M07 长度测量方式或 `Not Sure`；
5. 输入 Finished Overall Assembly Length；
6. 双弯头时设置 Clocking；
7. 选择 Installed Protection；
8. 可选填写 Operating Conditions；
9. 设置数量并审核摘要；
10. `Add Assembly to Quote`。

### 9.2 接头筛选

- 只显示与已选胶管存在当前 RFQ-Eligible Combination 的接头。
- 支持按 Interface Family、形状、性别、旋转/固定、Connection Dash 筛选。
- 支持用 SKU、螺纹、Dash 和别名搜索。
- 可以在完全兼容时复制 End A 到 End B。
- 套筒由系统分别为 End A、End B 自动解析，客户不手选。

### 9.3 成品总长

- 客户输入包含两端接头在内的 Finished Overall Assembly Length，不输入原始切管长度。
- 英制默认，支持英尺、整英寸和 1/8 英寸；公制支持 1 mm。
- 引导配置最大 50 ft，超长需求转人工询价。
- M01-M07 测量图采用版本化位图底图和代码叠加标识。
- 当前最小 OAL 数据不足时，长度可进入人工技术审核，不得伪造最小值。
- 标准长度公差采用项目已确认的 SAE J517 规则；更严公差转人工审核。

### 9.4 Clocking

- 仅当 End A 和 End B 都为弯头时必填。
- 从 End A 朝 End B 观察，以 End B 的 6 点钟方向为 `000`，顺时针计量。
- 提供预设角度，同时允许 `000-359` 任意整数。
- 标准容差为 `±3°`。
- `Not Sure` 或更严容差进入人工技术审核。

### 9.5 保护和应用条件

- 所有订单强制使用 Standard Export Packaging。
- Installed Protection 是总成上永久安装的附加保护，与运输包装分开。
- 默认允许 `No additional installed protection`，除非胶管或应用规则明确要求保护。
- 首版支持黑色塑料 Spiral Guard 和黑色 Nylon Protective Sleeving 全长安装。
- 局部保护、钢丝弹簧、防火套、爆裂约束套和特殊颜色转人工询价。
- Operating Conditions 默认折叠并标记 Optional；可填写介质、最大工作压力和温度。
- `Other`、`Not Sure` 或超范围值可以提交，但标记 Technical Review Required。

### 9.6 参考估价

- 标准商品显示美元 Reference Price；总成显示一个 `Estimated Price`，两者均不是最终报价。
- 总成估价内部包含胶管长度、End A、End B、两个套筒、装配服务和已选保护层，但前台不展示组件级价格拆分。
- 设成品精确长度为 `F` 英尺；英寸除以 12，毫米除以 304.8，计算过程中不提前取整。
- 装配服务费：`USD 0.50 × ceil(F)`。
- Nylon Protective Sleeving：`USD 8.00 + USD 1.35 × F + USD 1.00 × ceil(F)`。
- Plastic Spiral Guard：`USD 8.00 + USD 1.00 × F + USD 1.00 × ceil(F)`。
- 每个最终展示金额在公式计算完成后保留两位小数。
- 价格输入随 Catalog Release 版本化；Quote List 打开或提交前刷新，变化时同时提示旧估价和新估价。
- 最终产品价格、运费、税费、贸易术语和交期以 Quote/PI 为准。

### 9.7 预览与错误处理

- 使用代码渲染具有科技感的响应式 2D 技术示意，标记 `Not to scale`。
- 预览用于检查选择，不是制造图、比例图或切管计算依据。
- 上游选项变化后，下游失效选项不自动删除；保留并明确标红失效原因。
- 客户可以继续修改，最终加入 Quote List 和提交 RFQ 时执行完整校验。
- 错误信息必须链接回对应配置步骤。

### 9.8 配置暂存

- 游客正在编辑但尚未加入 Quote List 的配置只存在于当前页面会话。
- 离开网站页面时提示“退出后所选配置将丢失”，允许继续编辑、确认离开或注册保存。
- 不承诺浏览器崩溃、强制关闭、换设备后的草稿恢复。
- 第一版不实现游客跨会话自动保存配置草稿。

## 10. Quote List、身份和 RFQ

### 10.1 匿名 Quote List

- 游客可以浏览、配置、加入和编辑 Quote List，无需登录。
- Quote List 存在服务端 D1，通过签名的非个人 Cookie 识别，有效期为最后活动后 30 天。
- Cookie 不保存商品、价格、配置或个人信息。
- 相同标准商品或完全相同的配置行合并数量，关键配置不同则保留独立行。

### 10.2 登录边界

以下操作必须验证邮箱：

- 保存未完成配置；
- 提交 RFQ；
- 进入 Personal Center。

客户使用 6 位邮箱 OTP 或安全登录链接；设置密码是可选项。OTP 验证成功后创建或更新 Customer Profile，并将当前匿名 Quote List 与已有清单合并而非覆盖。

### 10.3 RFQ 提交

- 允许个人客户和企业客户提交。
- 收集收货国家、邮编、完整地址、联系人和 Purchasing Context。
- 企业路径额外收集公司法定信息。
- 提交前刷新价格、可供应状态、兼容性和 Merchandise Subtotal。
- 客户可选择本次提交 Quote List 中的部分行；未选择的行继续保留。
- 成功提交后生成唯一 RFQ 编号，并在确认页及 `My Quotes` 中显示；RFQ 提交成功时不发送确认邮件。
- RFQ 是不可变需求快照，后续修改通过 Quote Revision，不覆盖原记录。

### 10.4 最低金额和贸易术语

门槛只按折后 Merchandise Subtotal 计算，不包含运费、保险、关税、进口税、美国销售税、Cutting & Labeling Fee 和其他费用。

| 客户类型 |    商品金额 | 提交和贸易术语                           |
| -------- | ----------: | ---------------------------------------- |
| 个人客户 |   低于 $100 | 不允许提交 RFQ                           |
| 个人客户 | $100-$4,500 | DDP 含进口责任到门；美国销售税另行处理   |
| 个人客户 | 高于 $4,500 | 必须改用企业 Purchasing Context          |
| 企业客户 | $100-$3,000 | DDP 含进口责任到门；美国销售税另行处理   |
| 企业客户 | 高于 $3,000 | DAP 到门，客户负责进口清关、关税和进口税 |

DDP 小金额订单由物流商处理相关进口安排，网站不让客户选择 Importer of Record，也不拆解物流商内部的 IOR、报关和担保结构。

## 11. 报价、PI 与付款

### 11.1 报价审核

- 管理员审核产品规格、兼容性、数量、最终单价、折扣、包装估算、运费、税务、贸易术语和交期。
- 管理员可以手动录入数量折扣，所有价格修改保留审计记录。
- 内部 Cost Basis 不得出现在前台、客户 API、邮件、PI 或导出文件。
- 客户消息与内部备注分离。
- 对产品、数量、规格、地址或商业条款的实质修改生成新 Quote Revision。

### 11.2 PI

- PI 与 Payment Instructions 一起发送给客户。
- PI 包含产品、数量、价格、贸易术语、交期、付款节点、退款条件和定制产品限制。
- 定制产品明确标注批准生产后不可无理由取消的范围。
- PI 默认有效期为 14 个日历日，可在签发前设置其他明确期限。
- 客户必须查看对应版本并明确接受；网站记录身份、PI 版本、文件哈希、法定姓名、确认项和时间。
- 客户无法在网站接受时，管理员可以依据客户邮件手动标记该明确版本为已接受并保留审计证据。
- 过期或被替代 PI 保留历史但不可继续接受。

### 11.3 美国销售税

- Quote List 和 RFQ 不假定免税，显示 `Sales tax calculated separately if applicable`。
- PI 的 Sales Tax Treatment 为 `Collected`、`Exempt` 或 `Not Collected`。
- 首版由管理员人工确认税额和处理类型，不接自动税务 API。
- `Exempt` 必须有私密保存的有效免税证明，客户勾选或填写税号本身不够。
- DDP 的进口税费和美国 Sales Tax 必须分开，不得混为“含税”。

### 11.4 付款

- 主渠道：对公收款，运营上使用万里汇/WorldFirst 或卖方银行账户。
- 首单辅助渠道：PayPal，适用于样品、低金额标准品和第一次合作，通过邮件发送付款链接。
- 客户可以按 Payment Instructions 使用银行卡或当地转账等渠道完成外部付款。
- 网站不接银行、WorldFirst 或 PayPal 到账接口。
- 客户不能上传汇款截图并据此推动状态。
- 管理员在外部账户确认实际到账后，在后台粘贴/录入付款信息并点击确认。
- 默认付款截止日为 PI 接受后的 10 个美国工作日。
- 只有净到账金额达到 PI Total Due 才视为 Cleared Funds；PayPal 手续费由卖方承担，不在客户接受后补收。

### 11.5 订单创建

正式订单仅在以下条件同时满足时自动且幂等地创建：

1. 当前 PI 有效且已被客户接受；
2. 必需的规格和商业确认已完成；
3. 管理员已确认足额 Cleared Funds。

钱未到账不得生产或发货。客户后续增加商品、数量或总成时，新建 Follow-on Quote、PI、付款和订单，不修改原订单。

PI 被接受后，若客户未改变数量、地址、拆单或运输方式，因卖方包装或运费估算偏差产生的增加由卖方承担，不向客户补收。若客户改变这些条件，则签发新版 Quote 和替代 PI。

## 12. Personal Center

### 12.1 菜单

- Saved Configurations；
- My Quotes；
- Orders；
- Addresses；
- Profile / Company；
- Account Security。

### 12.2 展示规则

- `My Quotes` 展示 RFQ、Quote、PI、付款等待和相关消息。
- `Orders` 只展示付款确认后创建的正式订单。
- 订单详情展示产品行、数量、运输和售后状态，不展示每根物理总成的内部生产数据列表。
- 单根总成记录通过产品实物上的二维码访问。
- 不向客户展示 Factory Link Opened、Production Started、Customs Review、内部质量步骤或付款审核细节。

## 13. 管理后台

### 13.1 一级功能菜单

1. Dashboard；
2. Catalog；
3. RFQs / Quotes；
4. PI & Payments；
5. Orders；
6. Production & Assembly Labels；
7. Shipments；
8. After-sales；
9. Customers & Organizations；
10. Messages / Support；
11. Settings；
12. Admin Accounts & Audit。

### 13.2 核心能力

- 在“数据导入”生成草稿，并在“产品目录”统一完成审核、对比、校验和 Catalog Release 发布；
- 批量修改 Supply Availability；
- 维护测量端点、M01-M07、Clocking、保护层和估价规则；
- 管理产品系列页、SKU、图片和搜索别名；
- 审核 RFQ，生成 Quote Revision、PI 和 Payment Instructions；
- 人工确认收款并推动订单创建；
- 生成生产作业单、Assembly Number、二维码和标签 PDF；
- 管理发货、跟踪、退货、退款和私密文件；
- 创建子账号并逐项勾选权限；
- 记录关键操作的追加式审计事件。

首发后台只有一个独立 Owner 和一个高权限 Admin Subaccount，不设置复杂固定岗位角色。后续增加员工时再通过勾选权限扩展。

## 14. 生产与工厂端

### 14.1 生产任务生成

- Confirmed Order 创建时，系统为其中所有定制总成生成一个订单级 Assembly Production Package。
- 同一订单可以包含多个总成规格和不同数量。
- 每根物理总成都生成唯一 Assembly Number、Assembly Record 和高熵公开验证 Token。
- 数量为 5 时生成 5 个 Assembly Number 和 5 张独立标签。

### 14.2 工厂资料

- 生产作业单为中英双语，技术代码和值只出现一次。
- 装箱单只需打印并随货，不设置“必须粘贴到外箱”的系统步骤；每根总成的耐久二维码标签仍必须贴在对应成品上。
- 作业单生成不强制要求批次号、实际箱数、毛重或箱体尺寸。
- 后台支持按整个订单或选定总成行批量导出二维码标签。
- 标签 PDF 按实际卷筒标签纸一页一张，不使用 A4 网格。
- 支持直接重印原标签，不记录重印次数，也不生成新编号。
- 中国工厂不需要独立二维码生成系统，网站提供可打印文件。

### 14.3 Factory Mobile

- 管理员将一个限时批次二维码/链接通过微信或邮件发送给工厂。
- 链接可以在微信浏览器中打开，不需要工厂后台账号。
- 工人先进入该订单全部任务列表，再扫描总成标签自动识别 Assembly Number 并打开对应任务。
- 页面使用简体中文、大按钮、数字输入和图片上传，尽量不要求自由文本。
- 工厂端不展示复杂业务规则、客户订单状态或管理菜单。

### 14.4 耐压测试与质量记录

- 每根总成进行 100% 外观、尺寸、压接、清洁、封帽、标签和耐压检查。
- 耐压测试目标为经批准总成最大工作压力的 2 倍。
- 保压时间由后台全局默认设置或订单级覆盖，并在生产记录签发时锁定。
- 工厂页面不显示倒计时，也不限制开始和结束照片按钮的顺序或可用性。
- 工人上传开始压力表照片、结束压力表照片和贴好标签的成品照片。
- 服务器接收照片的时间作为记录，不用于自动判断是否达到保压时间。
- 结果按钮为 `通过`、`测试设备/适配器异常`、`胶管总成失败`。
- 测试设备异常允许修正后用同一 Assembly Number 重测，保留历次记录。
- 总成失败后原编号永久失效；替代品必须使用新编号并重新完成检查和测试。

### 14.5 客户可见边界

- 工厂行为只更新内部证据，不直接改变客户订单状态。
- 工厂完成后由管理员判断是否标记 Ready to Ship。
- 客户不需要知道具体开工、压接、测试或清关进度。

## 15. 总成二维码验证

成品耐久标签使用英文，至少包含品牌、Assembly Number、胶管系列和尺寸、Finished Overall Assembly Length、参考最大工作压力、生产日期、原产国和二维码。

公开扫码页只显示：

- 品牌和 Assembly Number；
- 胶管系列、尺寸和成品总长；
- 允许公开的参考最大工作压力；
- 生产日期；
- 记录存在状态；
- 清洁、耐压测试和检验完成状态。

公开页不得显示客户身份、订单号、价格、PI、付款、工厂照片、压径、内部测量、供应商、后台备注或详细物流记录。客户在使用后发现某根总成不能继续使用时直接联系客户支持；首版不提供客户自行修改二维码状态或后台远程标记“不可用”的流程。

## 16. 物流与订单进度

### 16.1 交期

- 标准件默认 Processing Lead Time 为 10 个中国工作日。
- 定制总成只能显示起始估计，实际交期根据规格和数量由销售在 PI 前确认。
- 使用后台维护的 China Fulfillment Calendar 计算中国节假日、停工和调休。

### 16.2 发货

- 默认 Ship Together；客户可在 PI 前请求 Split Shipment。
- 一个订单允许有多个 Shipment，每个 Shipment 有独立内容、日期和跟踪信息。
- 管理员可先标记 Shipped，后补 tracking number 或 URL。
- 不要求接入承运商 API，支持管理员手动记录 Delivered。
- 实际箱数、毛重、尺寸和 Packing List 均为可选运营数据，不阻塞 Ready to Ship 或 Shipped。

### 16.3 客户进度

客户只看到：

`Order Confirmed → Ready to Ship → Shipped → Delivered`

不设置 Customs Review 状态，不主动通知进入或离开海关审核。客户有疑问时通过客服咨询。

## 17. 售后、退货和退款

### 17.1 取消与修改

- 客户不能直接提交定制总成的规格修改请求。
- 客户发现错误时联系支持；是否取消原配置由后台管理员根据工厂实际状态判断。
- 若原配置已生产，可以拒绝取消；若未生产，管理员可以取消原配置。
- 修正后的总成必须重新创建 Quote、PI、付款和订单。
- 未发货的标准商品可提交取消请求，审核期间只冻结对应数量。

### 17.2 退货

- 标准商品在对应 Shipment 实际送达后 14 个日历日内可申请无理由退货审核。
- 定制总成和已裁切胶管不支持无理由退货，但仍可报告卖方错误、缺陷或不符合约定。
- 客户提交 `Request Return or Report a Problem` 后创建 After-sales Case，不自动生成退货授权。
- 管理员批准 RA 后才显示退货地址：`542 Haggard St, Suite 505, Plano, TX 75074`。
- 该地址仅是退货服务地址，不是卖方注册地址、公开仓库或自提点。
- RA 签发后 30 个日历日内应收到退货。

### 17.3 检验与退款

- 收到并检查商品后才能批准实物退货退款。
- 管理员在收到后 5 个美国工作日内给出批准、部分批准或拒绝决定。
- 客户原因退货扣除获批退货商品金额的 10%，客户承担退回运费；已实际履行的 DDP Shipping & Import Charges 不退。
- 卖方错误或不合格产品不收补货费，合理物流和相关费用由卖方承担。
- 网站只记录退款决定和外部退款发起，不直接执行资金移动。
- 批准后卖方在 10 个美国工作日内发起退款，并记录渠道、金额、日期和外部参考号。
- 原则上原路退款；替代账户必须验证同一 Purchasing Context 并由 Owner 批准。

## 18. 语言、日期和时区

| 界面/文档                                         | 语言                   | 时间显示                  |
| ------------------------------------------------- | ---------------------- | ------------------------- |
| 客户前台、Personal Center、邮件、PI、公开二维码页 | 英文                   | America/New_York，标注 ET |
| 管理后台                                          | 简体中文，保留技术代码 | Asia/Shanghai，北京时间   |
| Factory Mobile                                    | 简洁简体中文           | Asia/Shanghai，北京时间   |
| Production Instruction                            | 中英双语               | `YYYY-MM-DD`              |
| 成品标签                                          | 英文和标准代码         | 明确日期格式              |

客户文档日期使用英文月份，例如 `Aug 19, 2026`。后台和工厂使用 `YYYY-MM-DD`。审计和数据库统一保存 UTC 时间。

后台中的 `SKU`、`JIC`、`NPT`、`RFQ`、`PI` 在鼠标悬停或键盘聚焦时显示中文通俗解释，但不替换原术语。

## 19. 通知与消息

- Quote/PI 签发、PI 接受、付款确认、Ready to Ship、Shipped、Delivered 和售后决定使用事务邮件；RFQ 提交成功不发送确认邮件。
- 出站邮件通过 Resend，入站邮件可通过 Cloudflare Email Routing 进入统一 Quote Conversation。
- 邮件发送使用 Queue 异步、幂等处理；邮件失败不得回滚已经成功的 RFQ 或业务状态。
- 客户通过邮件回复和网站发送的 Quote 消息归入同一会话。
- 营销邮件与事务邮件严格分离；首版不默认订阅营销。
- 工厂内部进度、Customs Review、后台提醒和普通重印不通知客户。

## 20. 状态与不可变规则

### 20.1 客户 Quote 状态

`RFQ Submitted → Quote Ready → PI Accepted → Payment Pending → Payment Confirmed → Order Created`

### 20.2 客户 Order 状态

`Order Confirmed → Ready to Ship → Shipped → Delivered`

### 20.3 全局约束

- 所有重要状态只能由受保护的 Domain Command 推进。
- 重复点击、网络重试或 Queue 重投不得创建重复 RFQ、订单、标签、通知或退款。
- RFQ、Quote Revision、PI、Payment Confirmation、Order、Assembly Record 和关键审计记录采用不可变快照或追加式修订。
- 目录、价格、图片或兼容性更新不得改写历史交易。
- 网站状态不代表银行到账、工厂事实或承运商事实，除非相应管理员明确记录。

## 21. 非功能需求

### 21.1 安全与权限

- 管理后台入口使用 Cloudflare Access 和 MFA；D1 中继续执行应用级权限校验。
- Owner 和 Admin Subaccount 必须使用独立身份，不共享账号。
- 客户 OTP、密码哈希、会话、CSRF、速率限制和账户枚举防护必须经过测试。
- R2 中客户文件、PI、付款资料和工厂照片默认私有，只通过授权 Worker 或短期签名 URL 访问。
- 公开二维码使用不可枚举的高熵 Token，不直接暴露内部主键。
- 审计日志不得保存密码、OTP、Token、完整付款凭据或不必要的敏感信息。

### 21.2 可用性

- 桌面和移动端都必须可完成产品浏览、配置器、Quote List、RFQ 和 PI 接受流程。
- 配置器桌面使用稳定主操作区和固定预览区；移动端一次聚焦一个步骤。
- 工厂端以微信浏览器尺寸验证，不允许按钮、聊天入口或固定操作条互相遮挡。
- 长文本、型号和英文单词不能溢出容器。

### 21.3 性能与可靠性

- 页面和 API 在 Cloudflare Worker 运行限制内设计。
- 大型 Excel 导入、PDF、邮件和附件处理应异步或分步执行，避免阻塞请求。
- D1 迁移可重复执行；Preview 与 Production 环境隔离。
- 关键业务命令和 Queue 消费者必须幂等，并记录可诊断失败原因。

### 21.4 可追溯性

- 保存产品、兼容关系、测量图、估价和政策版本。
- 保存管理员身份、UTC 时间、请求 ID、受影响对象和允许记录的前后差异。
- 保存 PI 接受、到账确认、生产测试、发货和退款的外部证据引用。

## 22. 技术架构基线

- 前后端：React Router v8 + TypeScript；
- 运行时：Cloudflare Workers；
- 架构：模块化单体，首版不拆微服务；
- 关系数据库：Cloudflare D1；
- 对象存储：Cloudflare R2，默认私有；
- 异步任务：Cloudflare Queues；
- 数据库迁移：Drizzle 管理；
- 后台入口认证：Cloudflare Access + MFA；
- 客户认证：邮箱 OTP / 安全链接，可选密码；
- 出站邮件：Resend；
- 部署环境：Local、Preview、Production 隔离。

免费 Cloudflare 套餐可以用于当前规模的部署和测试，但 Workers Free 的单请求 CPU 限制可能影响 Excel 导入、SSR 和文档生成。正式营业时应至少预留 Workers Paid 的基础成本；这不是购买 Cloudflare Pro 网站套餐的要求。

## 23. 首版不做

- 网站购物车结账和在线支付；
- 银行、WorldFirst、PayPal 自动对账；
- 客户上传汇款截图推动付款状态；
- 实时库存、WMS、ERP、MES 或机器数据自动采集；
- 自动税务、海关、运价或承运商 API；
- 3D 总成配置器或每种组合的生成式产品照片；
- 自动推断不存在于兼容表中的组合；
- 客户查看工厂内部进度、Customs Review 或每根总成后台记录列表；
- 工厂账号、工时、绩效、复杂文字报告或倒计时监管；
- 强制填写实际箱数、毛重和箱体尺寸；
- A4 网格总成标签；
- 多联系人企业权限管理、固定销售/运营岗位角色；
- 客户自行修改已生产总成状态；
- 自动清理配置器中因上游变化而失效的选择；
- 游客未加入 Quote List 的配置跨设备恢复；
- 为尚无客户需求的功能预先建设复杂工作流。

## 24. 发布阶段与验收

### 24.1 P0：首发必需

1. Cloudflare 可运行骨架、环境隔离、D1 Migration、Access 边界和部署链路；
2. 七张表导入、校验、后台审核、批量可供应状态和 Catalog Release 发布；
3. 产品目录、系列页、搜索、变体和 Add to Quote；
4. 匿名 Quote List 和 Length-Based Hose；
5. 双端总成配置器、兼容校验、长度、Clocking、保护、预览和估价；
6. 邮箱验证、客户资料、Personal Center 和 RFQ；
7. Quote Revision、PI、付款指引、接受证据、人工付款确认和订单创建；
8. 生产包、标签、Factory Mobile、耐压记录和公开二维码验证；
9. Shipment、客户简化进度、售后、退货检查和退款记录；
10. 全链路权限、快照、幂等、审计、邮件和响应式测试。

### 24.2 验收主链路

必须至少通过以下端到端场景：

`发布产品 → 游客配置总成 → 加入 Quote List → 验证邮箱 → 提交 RFQ → 后台生成 Quote/PI → 客户接受 → 后台确认到账 → 创建订单 → 生成生产包和标签 → 工厂扫码并提交记录 → 后台标记可发货 → 发货/送达 → 售后处理`

## 25. 上线前待补资料与外部决策

以下事项不是继续本地开发的阻塞项，但在对应生产功能启用前必须补齐：

| 事项                                                        | 最晚完成节点           |
| ----------------------------------------------------------- | ---------------------- |
| 最终品牌、Logo、主域名和商标冲突检查                        | 公开上线前             |
| 卖方中国英文注册地址                                        | PI 签发前              |
| 正式 WorldFirst/银行收款指引和 PayPal 配置                  | PI 签发前              |
| Cloudflare Production Account、D1、R2、Queue、Access 和密钥 | 生产部署前             |
| Resend 域名验证和发件地址                                   | 事务邮件启用前         |
| 美国销售税专业意见，包括 Plano 退货地址的 nexus 影响        | 正式收款前             |
| DDP 物流商及可接受产品、金额、目的地范围                    | 签发 DDP PI 前         |
| 工厂卷筒标签纸尺寸、方向、边距和二维码尺寸                  | 批量打印标签前         |
| M01-M07 Endpoint Class 映射及歧义处理                       | 对应组合进入引导配置前 |
| 每个 PI 的生产可行性与组合确认                              | PI 签发前              |
| 更新后的最终产品工作簿、28 类接头代表图和发布状态           | Catalog Release 发布前 |
| 客服聊天供应商和前台嵌入配置                                | 客服入口上线前         |
| 隐私政策、销售条款、退货政策和免责声明法律复核              | 正式公开营业前         |

## 26. 主要风险

1. **技术数据风险**：市场参考压径和兼容数据不是工厂验证；必须坚持 RFQ Eligible 与 Production Approved 分离。
2. **产品责任风险**：液压总成为承压件，错误压力、接口、长度或 Clocking 可能导致设备损坏或人身风险。
3. **税务风险**：DDP 不等于包含美国 Sales Tax；不同州义务不能通过前台统一“免税”解决。
4. **物流风险**：中国直发不适合紧急维修订单，前台不得暗示本地即时履约。
5. **运费风险**：PI 接受后卖方承担自身估算偏差，需要在签发前做好包装与物流确认。
6. **运营风险**：两名后台人员意味着流程必须简洁，但关键付款、PI、生产和退款动作仍需审计和幂等保护。
7. **图片风险**：AI 图片可能改变密封面或接头结构，所有代表图都要与真实参考复核。
8. **平台限制风险**：Cloudflare 免费 Worker 的 CPU 时间可能不足以稳定执行大型导入和文档生成。

## 27. 相关文档

- 英文顶层 PRD：[`hydraulic-hose-rfq-platform.md`](./hydraulic-hose-rfq-platform.md)
- 详细业务范围：[`web-application-scope.md`](../product/web-application-scope.md)
- 领域术语：[`CONTEXT.md`](../../CONTEXT.md)
- 产品目录 Spec：[`001-product-catalog-and-release.md`](../specs/001-product-catalog-and-release.md)
- 总成配置器 Spec：[`002-assembly-configurator-and-quote-list.md`](../specs/002-assembly-configurator-and-quote-list.md)
- 身份与 RFQ Spec：[`003-customer-identity-personal-center-and-rfq.md`](../specs/003-customer-identity-personal-center-and-rfq.md)
- Quote 与 PI Spec：[`004a-quote-review-and-pi.md`](../specs/004a-quote-review-and-pi.md)
- 付款与订单 Spec：[`004b-manual-payment-and-confirmed-order.md`](../specs/004b-manual-payment-and-confirmed-order.md)
- 生产与工厂端 Spec：[`005-production-assembly-qr-and-factory-mobile.md`](../specs/005-production-assembly-qr-and-factory-mobile.md)
- 物流 Spec：[`006-shipment-and-customer-order-progress.md`](../specs/006-shipment-and-customer-order-progress.md)
- 售后 Spec：[`007-after-sales-returns-and-refunds.md`](../specs/007-after-sales-returns-and-refunds.md)
- 冲突与假设登记：[`conflicts-and-assumptions-register.md`](../reviews/conflicts-and-assumptions-register.md)
- ADR 索引：[`README.md`](../adr/README.md)
