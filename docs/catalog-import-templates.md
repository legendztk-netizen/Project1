# 分类导入模板

在「产品审核与发布」下载 01—06 六份独立模板。每份包含自己的主表以及 `00_填写说明`、`09_字段字典`、`10_下拉选项`。旧多表文件和 07 价格包装导入继续兼容。

产品模板字段源于 `catalog-product-fields.ts`，与手动新增共用必填定义。浅红色表示必填，浅黄色表示系列必填、上线必填或预包装必填等条件；表头文字和字典说明同时标明条件。04 为兼容关系，不套用产品新增规则。

01/02/03/05/06 将 SKU 参数、零售价、币种、适用包装、图片纳入同一审核请求。采购成本不写入客户零售价。系列销售规则仍在「销售、包装和价格」维护。兼容字段变更走既有总成待更新流程；04 作为独立总成来源处理。

每张主表新增必选的 `Update Delete` 下拉列：

- `Update`：只新增 SKU，重复 SKU 报错；按手动新增规则填写参数。币种留空默认 USD，状态默认 Published，技术资料状态默认 Complete。已有系列参数留空继承。
- `PartialUpdate`：只修改已存在 SKU 的已填字段，空白/缺列保留原值，数值零会正常更新。需要清空字段时使用后台编辑。
- `Delete`：只需操作和 SKU，其他列忽略。批准后删除当前 SKU，保留不可变修订、历史报价和审计记录。

三种操作均先生成待审核请求，批准时重新检查存在性，避免新建请求覆盖审核期间新增的同名 SKU。旧版无操作列的模板仍兼容原有缺列继承、空值清空规则。

04 使用兼容编号定位关系。PartialUpdate 不可更换三件套 SKU；Delete 在总成管理应用后保存删除标记，更新系列后不再生成该关系，不删除部件产品。操作、字段字典和颜色含义已同步到六份模板。

## 重新生成

`scripts/build-catalog-import-templates.mjs` 读取实际领域字段定义，使用工作区提供的 `@oai/artifact-tool`，不向应用增加生成库依赖。设置 `ARTIFACT_TOOL_NODE_MODULES` 为该运行时的 `node_modules` 绝对路径，用配套 Node 24 运行：

```sh
node --experimental-transform-types scripts/build-catalog-import-templates.mjs
```

生成文件写到 `outputs/product-import-YYYYMMDD`（可用 `TEMPLATE_OUTPUT_DIR` 覆盖），同时更新 `public/templates/catalog-import-01.xlsx` 至 `06.xlsx`。预览在 `.scratch/import-templates`。后台下载接口验证身份后跳转到不包含业务数据的静态空模板。

修改字段后运行 `test/catalog-split-template.test.ts`，它比较交付文件与当前字段定义，并对各类模板进行导入回读。`test/item-import-review-d1.integration.test.ts` 验证批准后价格/包装生效和 Dash 变更触发总成待更新。
