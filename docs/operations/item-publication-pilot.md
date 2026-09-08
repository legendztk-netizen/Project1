# Ticket 01 / #82：条目发布隔离试运行

## 启用与边界

先在 local / preview D1 应用迁移 0053，并保留一个已发布 Active Release。以已有管理员身份访问 `/admin/catalog/items`，选择“在本隔离环境启用条目发布”。生产环境拒绝此操作；正式转换 Active、保留 Draft 差异及切换入口由 Ticket 05 完成。不要对真实生产 D1 手动设置 mode。

启用时冻结该数据库的 Active 基线。Worker 拒绝旧 `/admin/catalog/*` 写入口（条目入口除外）及整本发布诊断；D1 触发器另行禁止旧 Active 指针和发布状态变更。未启用的数据库继续原流程。试运行需回退时恢复隔离数据库备份；不支持直接切回旧指针。

此入口提供胶管 SKU 完整参数、原币金额、币种、包装长度、图片覆盖及目标状态。子体继承系列属性、图片和销售规则。读取已存在 SKU 或其草稿后可编辑；新建时编号不可重复。系列编辑及销售规则维护正式入口为 Ticket 02 的“系列 → 更多 → 编辑”弹窗；本票提供系列命令契约。

币种由管理员设置；客户目录和个人中心不提供选择器，不自动换汇。本票支持 USD/CNY/EUR/CAD/GBP/JPY 的原币存储、目录读取和修订快照。现有 USD 自动询价流程暂不接收非 USD SKU，避免混用现有 USD 服务费。Ticket 02 实现按原币分组汇总及混币总成人工核价流程。

## Ticket 02 / 03 共用契约

`createD1CatalogItemRepository(DB)` 提供 `findPayload(kind, code, draft?)`、`apply(command)`、`createRequest(command, original, dependencies)`、`approveRequest(id, actorId, ipAddress)` 和 `history(kind, code)`。

- 调用方必须先执行 Worker 管理员认证及 `requireAdminRequestContext`，actorId 取认证结果，不取表单。后续审核路由沿用同一边界。
- 系列快照只拥有 series、commercialRule、mediaVersionId；SKU 快照只拥有 variant、price、mediaVersionId。price 保留包装字段及原币金额，禁止纳入工厂 Cost Basis。
- 命令需要稳定 commandId、操作者、来源、目标状态、提交基线及完整自有数据。相同 commandId 的相同内容重试返回首次结果，不能复用它提交另一修改。
- pending 请求保存原始内容、独立提案、来源和依赖；批准直接复用验证与发布事务。父系列请求必须已批准，失败保留 pending。手动命令不创建请求。目标是已有实体时，批准旧新建请求也按完整快照覆盖该实体。
- 发布顺序使用 D1 自增 sequence，与客户端时间和上传顺序无关。generation 只用来避免验证/提交之间读到混合版本；并发冲突内部重新验证，仍应用原提案，不做字段合并或旧修改警告。
- 单次 D1 batch / trigger 原子完成身份、不可变修订、指针、总成失效、请求状态和审计。草稿不切换上线指针；停用不删除历史。
- 当前读取通过 `catalog_runtime_*` 视图组合条目修订与冻结基线；旧物理表保持不变，历史 Release API 继续按旧物理表解析。
- 客户条目 `catalogBasis` 记录 generation、SKU/系列修订及实际图片版本；未转换条目使用 `legacy:<release>:…`。RFQ 保存实际 offer 与 basis。总成刷新附带当前各组件的价格/图片/修订快照，并保留原配置快照。
- SKU 的 Dash、所属系列、剥胶及生命周期变化使受影响胶管系列失效。价格/币种/包装/图片/销售规则、压力、温度不触发重建。配置读取、添加与提交都有门禁。Ticket 04 生成器应基于失效 sequence 更新 generated_sequence，不能清除生成期间新增的失效。

## 验证入口

`test/catalog-item-publication-d1.integration.test.ts` 验证真实 D1 的覆盖顺序、幂等、草稿、币种、并发、继承、回滚和报价版本门禁。

`test/smoke/catalog-item-publication.test.ts` 验证真实 Worker 管理表单 → D1 → 客户目录 → 登录客户 RFQ → 改价后历史不变，并验证旧发布入口封闭。运行前执行 `pnpm build:local`。
