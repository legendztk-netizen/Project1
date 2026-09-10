# Spec 11 Ticket Review：产品条目级发布、产品管理与总成管理重构

2026-09-10：五张票本地实现和验收完成；用户确认远程部署不在本轮范围内。[本地验收记录](../operations/spec-11-local-acceptance.md)。以下票发布信息为 2026-09-08 的历史记录，不代表当前本地交付状态；GitHub 票未在本次操作中修改。

- 已于 2026-09-08 按用户确认发布 [Spec 11 #81](https://github.com/legendztk-netizen/Project1/issues/81) 与 5 张子票。
- [本地 Spec](../specs/011-item-level-product-publication-and-assembly-management.md) 为已确认完整要求；本表记录实际 GitHub 链接与实施顺序。
- 每张票都有完整业务交付、验收标准、验证要求、父级引用和原生 GitHub 阻塞关系。
- 仅 Ticket 01 标记 `ready-for-agent`；Ticket 02–05 标记 `blocked`。完成前置票后按实际 frontier 更新标签，不能绕过依赖。
- 本次为需求与 Tickets 发布，不代表功能实现或生产切换已完成。

| Ticket | GitHub                                                         | 名称                          | 交付                                                                                    | Blocked by    |
| ------ | -------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------- | ------------- |
| 01     | [#82](https://github.com/legendztk-netizen/Project1/issues/82) | 建立条目级修订与独立变更请求  | 一个胶管 SKU 的直接发布、客户读取、即时总成失效、审计和历史快照；统一新契约与旧路径隔离 | 无            |
| 02     | [#83](https://github.com/legendztk-netizen/Project1/issues/83) | 重构产品管理与手动直接发布    | 五类产品列表/系列子体/编辑新增/条件删除，原币种价格、适用包装、系列销售规则和客户询价   | #82           |
| 03     | [#84](https://github.com/legendztk-netizen/Project1/issues/84) | 将 Excel 导入转换成条目级审核 | 独立请求、状态筛选、自审、父子依赖、不可拆分审核、部分失败和兼容来源保留                | #82           |
| 04     | [#85](https://github.com/legendztk-netizen/Project1/issues/85) | 建立总成管理和受影响系列更新  | 有序组合管理、手动关系与持续排除、关系源处置、逐系列更新及客户配置恢复                  | #83、#84      |
| 05     | [#86](https://github.com/legendztk-netizen/Project1/issues/86) | 切换新发布流程并保留历史数据  | Active/Draft/关系迁移、写入切换、原币种与历史数据核对、幂等恢复及整体回归               | #83、#84、#85 |

依赖：`01 → 02与03并行 → 04 → 05`。两条并行路径共用 Ticket 01 的契约；生产开放在最后切换票完成。

## 用户确认的修改

1. 保持既有 Dash 尺寸匹配及系列/套筒/剥胶约束，不将压力、温度、扣除量加入总成待更新触发或额外校验流程；生命周期、手动关系和排除状态继续控制可用性。
2. 支持 SKU 原币种价格；按币种分组汇总，混币总成走人工核价，不自动换汇。无法确定完整 USD 小计的门槛/路由进入人工商业确认。
3. 包装长度按产品类型和销售方式校验；系列销售规则在“产品数据维护 → 销售、包装和价格”维护，并直接发布系列修订。
4. 保留独立条目完整自有快照的后发布覆盖、即时失效门禁、新旧写入隔离、不可变历史，以及保留不完整数据和关系差异的 Draft 迁移要求。

## 领域与决策记录

- 同步根领域词汇表中的 Product Revision、Product Change Request、Catalog Release、Series Commercial Rule、Assembly Management 和原币种 Reference Price 定义。
- [ADR 0049](../adr/0049-publish-product-revisions-independently.md)：条目级独立发布及历史保留。
- [ADR 0050](../adr/0050-retain-original-reference-price-currencies.md)：原币种价格及混币人工核价。
