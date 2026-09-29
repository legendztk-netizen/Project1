export const factoryStatuses = [
  {
    value: "not_started",
    label: "已确认未开始生产（软管尚未切割）",
    precut: true,
  },
  { value: "in_production", label: "已开始生产 / 软管已切割", precut: false },
  { value: "completed", label: "已完成生产", precut: false },
  { value: "unknown", label: "尚未核实", precut: null },
] as const;
