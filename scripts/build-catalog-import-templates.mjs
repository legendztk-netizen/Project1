import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
// Optional authoring dependency supplied by the workspace runtime, not the app.
if (!process.env.ARTIFACT_TOOL_NODE_MODULES)
  throw new Error(
    "Set ARTIFACT_TOOL_NODE_MODULES to the workspace runtime node_modules directory. Run with Node 24 --experimental-transform-types.",
  );
const requireArtifact = createRequire(
  pathToFileURL(
    `${process.env.ARTIFACT_TOOL_NODE_MODULES}/../catalog-authoring.cjs`,
  ),
);
const { Workbook, SpreadsheetFile } = await import(
  pathToFileURL(requireArtifact.resolve("@oai/artifact-tool"))
);
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && context.parentURL) {
      const source = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(source)) return next(source.href, context);
    }
    return next(specifier, context);
  },
});
const { importTemplates, importTemplateFields } =
  await import("../app/modules/catalog/domain/catalog-import-template.ts");
hook.deregister();
const root = process.cwd();
const manifest = importTemplates.map((t) => ({
  ...t,
  fields: importTemplateFields(t.prefix),
}));
const output =
  process.env.TEMPLATE_OUTPUT_DIR ||
  `${root}/outputs/product-import-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`;
await fs.mkdir(output, { recursive: true });
await fs.mkdir(`${root}/public/templates`, { recursive: true });
await fs.mkdir(`${root}/.scratch/import-templates`, { recursive: true });
const names = {
  "01": "01_胶管主数据",
  "02": "02_压接接头",
  "03": "03_套筒",
  "04": "04_兼容压接",
  "05": "05_过渡接头",
  "06": "06_快速接头",
};
function col(n) {
  let s = "";
  for (n++; n; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
function color(f) {
  return f.requirement === "必填"
    ? "#FCE4D6"
    : f.requirement === "选填"
      ? "#F2F5F8"
      : "#FFF2CC";
}
function note(f, relation) {
  if (f.key === "updateDelete")
    return "必选：Update 新增；PartialUpdate 更新已有记录的已填字段，空白保留；Delete 删除已有记录。产品按 SKU，04 按兼容编号识别；均需审核。";
  if (relation)
    return `${f.key === "compatibilityId" ? "三种操作均必填。" : f.required ? "Update 新增时必填。" : "选填。"}PartialUpdate 空白保留原值；Delete 仅需操作和兼容编号。不可通过更新更换三件套 SKU。`;
  if (f.key === "currency")
    return "支持 USD/CNY/EUR/CAD/GBP/JPY；新建留空默认 USD，更新留空继承币种。客户不可选择币种，不自动换汇。";
  if (f.key === "amount")
    return "上线必填，允许零，不得为负。单位随所属系列销售规则；不填写采购成本。";
  if (f.key === "packageLengthFt")
    return "仅胶管：定长预包装必填且大于零，按长度裁切可空。销售规则在后台维护。";
  if (f.key === "catalogPublicationStatus")
    return "Published 上线，Draft 草稿，Archived 停用；新建留空为 Published，更新留空保留原状态。";
  if (f.key === "technicalDataStatus")
    return "Update 新增时留空默认 Complete；PartialUpdate 留空保留原值。";
  if (f.requirement === "图片二选一")
    return "上线时 SKU 图片或所属系列图片至少有一项。填写后台已保存的图片版本 ID；PartialUpdate 留空继承已有图片。";
  if (f.requirement === "系列必填")
    return "新建系列时与手动新增必填项一致。已有系列留空保留。填写新值会修改共享系列参数，影响该系列其他 SKU。";
  return f.required
    ? f.key === "sku"
      ? "三种操作均必填。SKU 不可修改。"
      : "Update 新增时必填，与手动新增一致。PartialUpdate 空白保留原值；Delete 无需填写。"
    : "选填。PartialUpdate 空白保留原值（零值会更新）；如需清空字段请在后台编辑。Delete 无需填写。";
}
for (const t of manifest) {
  const w = Workbook.create();
  const guide = w.worksheets.add("00_填写说明");
  const data = w.worksheets.add(names[t.prefix]);
  const dict = w.worksheets.add("09_字段字典");
  const options = w.worksheets.add("10_下拉选项");
  for (const s of [guide, data, dict, options]) {
    s.showGridLines = false;
    s.tabColor = s === data ? "#24476A" : "#CBD5E1";
  }
  const instructions = [
    [`${t.prefix} ${t.label}导入模板`, "填写和审核说明"],
    [
      "填写位置",
      `仅在 ${names[t.prefix]} 第 2 行起填写。一行一个${t.prefix === "04" ? "兼容关系" : "SKU"}；不要填入演示数据。`,
    ],
    [
      "红色单元格：必填",
      t.prefix === "04"
        ? "按兼容压接关系校验。"
        : "必填项来自「管理所有产品」手动新增的同一字段定义。",
    ],
    [
      "黄色单元格：条件必填",
      "系列必填、上线价格、预包装长度和上线图片分别按字段字典说明填写。",
    ],
    [
      "灰白单元格：选填",
      "首行包含字段名称和必填标识。预留 200 行颜色及下拉，可复制空行格式继续填写。",
    ],
    [
      "新增与更新",
      "SKU/系列编号必须稳定。缺少列继承导入时数据；提供空白会清空可选字段。修改已有产品时删除不需修改的列。",
    ],
    [
      "已有系列",
      "已有系列不需重复录入参数。删除不需修改的系列参数和图片列，保留所属系列编号。新增系列需填写系列必填参数。",
    ],
    [
      "价格与包装",
      t.prefix === "04"
        ? "本表不包含价格。"
        : "零售价格、币种和适用包装与产品参数同表填写、一起审核；销售 SKU 自动采用产品 SKU。",
    ],
    [
      "系列销售规则",
      "在「销售、包装和价格」按产品类型、系列维护销售单位、MOQ、交期、原产国、数量输入方式及长度规则。上线前须维护。",
    ],
    [
      "采购成本",
      "采购成本、贸易条款和采购阶梯价格不纳入本模板零售价。原有成本数据保留，旧版 07 导入仍兼容。",
    ],
    [
      "发布流程",
      "上传仅生成待审核请求；在「产品审核与发布」批准后上线。系列和 SKU 有依赖时先批准系列。",
    ],
    [
      "总成更新",
      "涉及兼容键、系列或启停状态的更新批准后，在「总成管理」更新受影响系列；完成前相关组合不进入客户配置。",
    ],
    [
      "兼容关系表",
      "04 独立导入兼容关系，在总成管理流程审核/应用。产品模板不要求随附 04。",
    ],
    [
      "多币种",
      "后台录入币种；客户不能选币种。按原币种分组汇总，混币总成转人工核价，不自动换汇。",
    ],
    [
      "辅助页",
      "保留 00、09、10 页，它们不生成产品请求。下拉选项只使用允许值；SKU 和 Dash 作为文本，避免丢失前导零。",
    ],
  ];
  if (t.prefix === "04") {
    instructions[3] = [
      "条件必填",
      "本表红色列均为必填，灰白列选填。兼容关系按总成规则校验。",
    ];
    instructions[5] = [
      "完整关系行",
      "每行独立形成待处理总成来源；必填列不可删除或留空，不采用产品表的缺列继承规则。",
    ];
    instructions[6] = [
      "产品依赖",
      "胶管、压接接头和套筒 SKU 应引用已存在产品。产品资料变更通过对应产品模板导入。",
    ];
    instructions[8] = [
      "处理入口",
      "在「总成管理」的三件套关系来源中检查和应用导入记录。",
    ];
    instructions[9] = [
      "成本与价格",
      "本表不填写采购成本或零售价格；商品价格在各产品模板及后台维护。",
    ];
    instructions[10] = [
      "应用流程",
      "上传后独立保留总成来源。在「总成管理」处理；批准产品请求不会自动应用本表。",
    ];
    instructions[13] = [
      "审核前检查",
      "核对三件套 SKU、验证状态和压接参数；存在错误的来源需修正后再处理。",
    ];
  }
  instructions[3] = [
    "颜色适用范围",
    "红色参数列表示新增必填，黄色为条件必填。PartialUpdate 只填操作、标识和需修改字段；Delete 只填操作与标识。",
  ];
  instructions[5] = [
    "Update Delete",
    "Update：新增，已有编号报错。PartialUpdate：更新已存在记录，空白保留。Delete：删除已存在记录，历史记录保留。",
  ];
  instructions[6] = [
    t.prefix === "04" ? "兼容关系标识" : "SKU 与系列",
    t.prefix === "04"
      ? "04 使用兼容编号定位已有关系；更新不可更换三件套 SKU。产品使用 01/02/03/05/06 表操作。"
      : "产品按 SKU 识别。已有系列参数留空保留；新建系列需填写系列参数。填写共享系列参数会影响其他子体。",
  ];
  instructions[10] = [
    "审核流程",
    t.prefix === "04"
      ? "三种操作均生成待处理总成来源，在总成管理应用后更新受影响系列。删除关系不会删除三个部件。"
      : "三种操作均生成待审核请求，批准才生效。Delete 批准后从当前产品中删除 SKU，保留历史报价和审计记录。",
  ];
  guide.getRange(`A1:B${instructions.length}`).values = instructions;
  guide.getRange(`A1:B${instructions.length}`).format = {
    font: { name: "Arial", size: 11, color: "#203040" },
    rowHeight: 48,
    wrapText: true,
    verticalAlignment: "center",
  };
  guide.getRange("A1:B1").format = {
    font: { bold: true, size: 15 },
    rowHeight: 40,
  };
  guide.getRange("A1:A15").format.columnWidth = 29;
  guide.getRange("B1:B15").format.columnWidth = 110;
  guide.getRange("A3:B3").format.fill = "#FCE4D6";
  guide.getRange("A4:B4").format.fill = "#FFF2CC";
  const last = col(t.fields.length - 1);
  data.getRange(`A1:${last}1`).values = [
    t.fields.map(
      (f) => `${f.header.replace(/\*/g, "").trim()} [${f.requirement}]`,
    ),
  ];
  data.getRange(`A1:${last}201`).format = {
    font: { name: "Arial", size: 11, color: "#203040" },
    rowHeight: 23,
    verticalAlignment: "center",
  };
  data.getRange(`A1:${last}1`).format = {
    font: { bold: true },
    wrapText: true,
    rowHeight: 78,
    horizontalAlignment: "center",
  };
  data.freezePanes.freezeRows(1);
  let opt = 0;
  for (let i = 0; i < t.fields.length; i++) {
    const f = t.fields[i],
      c = col(i),
      r = data.getRange(`${c}1:${c}201`);
    r.format.columnWidth = 28;
    r.format.fill = color(f);
    data
      .getRange(`${c}2:${c}201`)
      .setNumberFormat(f.kind === "number" ? "0.########" : "@");
    if (f.controlledValues?.length) {
      const oc = col(opt++);
      options.getRange(`${oc}1`).values = [
        [f.header.replace(/\*/g, "").trim()],
      ];
      options.getRange(`${oc}2:${oc}${f.controlledValues.length + 1}`).values =
        f.controlledValues.map((x) => [x]);
      options.getRange(
        `${oc}1:${oc}${f.controlledValues.length + 1}`,
      ).format.columnWidth = 34;
      data.getRange(`${c}2:${c}201`).dataValidation = {
        rule: {
          type: "list",
          formula1: `'10_下拉选项'!$${oc}$2:$${oc}$${f.controlledValues.length + 1}`,
        },
      };
    }
  }
  dict.getRange(`A1:D${t.fields.length + 1}`).values = [
    ["字段", "键名", "填写要求", "说明"],
    ...t.fields.map((f) => [
      f.header.replace(/\*/g, "").trim(),
      f.key,
      f.requirement,
      note(f, t.prefix === "04"),
    ]),
  ];
  dict.getRange(`A1:D${t.fields.length + 1}`).format = {
    font: { name: "Arial", size: 11, color: "#203040" },
    wrapText: true,
    rowHeight: 54,
    verticalAlignment: "center",
  };
  dict.getRange("A1:A100").format.columnWidth = 42;
  dict.getRange("B1:B100").format.columnWidth = 30;
  dict.getRange("C1:C100").format.columnWidth = 16;
  dict.getRange("D1:D100").format.columnWidth = 78;
  dict.getRange("A1:D1").format = {
    fill: "#24476A",
    font: { bold: true, color: "#FFFFFF" },
    rowHeight: 28,
  };
  dict.freezePanes.freezeRows(1);
  for (let i = 0; i < t.fields.length; i++)
    dict.getRange(`C${i + 2}`).format.fill = color(t.fields[i]);
  if (opt) {
    options.getRange(`A1:${col(opt - 1)}80`).format.font = {
      name: "Arial",
      size: 11,
      color: "#203040",
    };
    options.getRange(`A1:${col(opt - 1)}1`).format = {
      fill: "#24476A",
      font: { bold: true, color: "#FFFFFF" },
      wrapText: true,
      rowHeight: 65,
    };
    options.freezePanes.freezeRows(1);
  }
  w.recalculate();
  console.log(
    (
      await w.inspect({
        kind: "table",
        range: `'${names[t.prefix]}'!A1:D2`,
        include: "values",
        tableMaxRows: 2,
        tableMaxCols: 4,
      })
    ).ndjson,
  );
  for (const s of [guide, data, dict, options]) {
    const range =
      s === guide
        ? "A1:B15"
        : s === data
          ? "A1:E7"
          : s === dict
            ? "A1:D8"
            : `A1:${col(Math.min(opt, 4) - 1)}10`;
    const png = await w.render({
      sheetName: s.name,
      range,
      scale: 1,
      format: "png",
    });
    await fs.writeFile(
      `${root}/.scratch/import-templates/${t.prefix}-${s.name}.png`,
      new Uint8Array(await png.arrayBuffer()),
    );
  }
  const file = await SpreadsheetFile.exportXlsx(w);
  await file.save(`${output}/${names[t.prefix]}_导入模板.xlsx`);
  await fs.copyFile(
    `${output}/${names[t.prefix]}_导入模板.xlsx`,
    `${root}/public/templates/catalog-import-${t.prefix}.xlsx`,
  );
}
