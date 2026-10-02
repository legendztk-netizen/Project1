# D1 读取成本

D1 按**扫描行数**计费（`meta.rows_read`），不是按返回行数。Workers Free 套餐每天只有 500 万行读取、10 万行写入，UTC 00:00 重置；超出后所有查询直接报错，包括客户前台。

## 2026-10-02 事件与优化

两条读取各自把十几个 `catalog_runtime_*` 视图物化后，再对每个 SKU 逐行联表。SQLite 对每个 SKU 把这些物化结果整个扫一遍，读取行数随 SKU 数平方增长：

| 读取                           | 645 个 SKU 时每次读取行数（优化前） | 优化后（切换前 / 切换后） |
| ------------------------------ | ----------------------------------- | ------------------------- |
| 公共目录 `/catalog*`（含详情） | 约 173 万                           | 约 7 千 / 约 3 万         |
| 后台“管理所有产品”列表         | 约 84–87 万                         | 约 6.5 千 / 约 2.9 万     |

优化前每天只能打开 3–4 次页面就会耗尽 Free 额度。

做法：每个视图只读一次（`WHERE import_id = 当前基线`），在内存里按键合并（`readPublicCatalogRows`、`readManagedSkuRows`）。所有连接键在同一基线内唯一，所以结果与旧联表逐行一致，包括顺序。旧 SQL 原样保留在 `test/fixtures/legacy-*-sql.ts` 作为对照基准。

## 守护测试

`test/catalog-read-cost-d1.integration.test.ts` 在真实 D1 上：

- 切换前后两种模式、含被编辑条目和各类组件，逐行对比新读取器与旧 SQL；
- 用夹具生成 300 个额外 SKU，要求读取行数与 SKU 数成线性（每个 SKU 不超过固定行数），并断言旧联表读取量明显更大，证明测试能发现回退。

## 日常检查

```sh
wrangler d1 insights hydraulic-hose-rfq-preview --env preview --time-period 12h --sort-by reads --limit 10
```

新增读取目录数据的查询前，用 `meta.rows_read` 量一次；不要对视图做“逐行联表”，也不要在循环里对视图做按键查询。
