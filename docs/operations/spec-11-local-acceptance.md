# Spec 11 本地验收记录

状态：本地验收完成（2026-09-10）。

验收范围：2026-09-10 用户明确要求仅完成本地版本。2026-09-14 用户授权按本地范围验收关闭 #81–#86；远程预览和生产切换留待独立上线验收，不属于本次关闭范围。

2026-09-14 关闭复核：逐项检查原验收及失败复测日志；在 91c7107 基线工作区重跑 catalog-cutover-d1.integration 和 quote-currency-totals，2 个文件、9 项测试通过；本地迁移就绪复核通过。未重新执行生产切换，也未声明远程验证完成。

## 交付与证据

| 票       | 本地交付                                                              | 主要行为验证                                                                                 |
| -------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 01 / #82 | 独立实体修订、手动发布、当前指针、历史快照与审计                      | catalog-item-publication-d1.integration、smoke/catalog-item-publication                      |
| 02 / #83 | 五类产品、系列/子体管理、条件删除、原币种价格与销售包装               | product-management-d1.integration、product-management-page、quote-currency-totals            |
| 03 / #84 | Excel 独立审核、依赖、自审、参数价格图片原子批准                      | item-import-review-d1.integration、smoke/catalog-item-import                                 |
| 04 / #85 | 有序总成、持续停用排除、受影响系列更新、客户失效门禁、分页全选        | managed-assemblies-d1.integration、smoke/managed-assemblies                                  |
| 05 / #86 | Active/Draft 来源保留、冻结切换、历史只读、旧写入关闭、请求审计与恢复 | catalog-cutover-d1.integration、catalog-cutover-rehearsal.integration、smoke/catalog-cutover |

命令均在仓库根目录执行，日志保存在 `.scratch/spec11-final/`。

| 检查                        | 结果与日志                                                                                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 完整 `pnpm test`            | 93 个文件：526 项直接通过、2 项失败、1 项按环境跳过；`full-tests.log`。失败为五类导入测试默认5秒超时和旧目录测试Worker连接中断。                                                  |
| 失败复测                    | 多类型导入测试时限改为30秒；`--maxWorkers=1` 隔离复测两个失败文件及权限用例全部通过；`retest.log`。                                                                               |
| 最终切换/历史与真实备份演练 | 6/6 通过，包含真实关联诊断来源、历史只读分区、请求审计、失败回滚、幂等重跑与645条SKU逐行保持；`rehearsal.log`。                                                                   |
| Worker 端到端               | 7/7 通过（6项首轮通过，历史禁写断言按外层409保护修正后1项复测通过）。覆盖手动发布、Excel审核与依赖、总成失效/更新、历史RFQ、切换后旧接口禁写；`smoke.log` 与 `smoke-retest.log`。 |
| 静态检查                    | TypeScript、Lint、格式检查通过；`typecheck-final.log`、`lint.log`、`format.log`。                                                                                                 |
| 迁移与构建                  | schemaVersion62、迁移就绪检查、本地构建和部署dry-run通过；`migrate-verify.log`、`build.log`、`dry-run.log`。                                                                      |

完整回归的两个失败均已定向复测通过；正常套件覆盖528项通过，另外执行原按环境跳过的真实备份演练。未将本地演练宣称为远程验收。

Standards 轴的请求审计缺口、Spec 轴的历史入口与诊断旧写入入口均已修复并交叉复审，无剩余可操作发现。

## 本地状态与可复核文件

- schemaVersion 62，切换 `local-spec11-cutover-20260909` 已提交，维护冻结已解除。
- 本轮补丁不重复执行已完成切换，不覆盖本地新增业务。
- `.scratch/spec11-final/pre-final-state.json`：收尾开始时的发布/切换状态。
- `.scratch/spec11-final/data-preservation.json`：逐表数量与内容校验。
- `.scratch/spec11-final/pre-final.sqlite`：本轮补丁前一致性备份。
- 原切换前备份 `.scratch/ticket-86/pre-cutover.sqlite` 用于隔离重演，不能直接覆盖当前业务数据库。
- 浏览器已验证历史版本分页、旧版本来源、产品系列/尺寸读取；本地 HTTP 验证后台与配置页可访问。

## 恢复与部署边界

采用 [目录切换运行说明](catalog-item-cutover.md) 中的前向修复策略。远程部署仍需真实 D1、域名、Access 与密钥配置，并重新执行部署环境验收；本地通过不能代替远程验收。
