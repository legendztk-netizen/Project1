import type {
  CommercialProductType,
  SeriesCommercialRule,
} from "./catalog-commercial-maintenance";
import { CatalogItemRejected } from "./catalog-item-publication";
export function selectionActions(
  selected: { kind: "series" | "sku"; code: string }[],
) {
  return {
    edit: selected.length === 1,
    delete:
      selected.length === 1 ||
      (selected.length > 1 && selected.every((item) => item.kind === "sku")),
  };
}
export function paginateProductGroups<T>(
  groups: T[],
  page: number,
  pageSize: 20 | 50,
) {
  const pages = Math.max(1, Math.ceil(groups.length / pageSize));
  const currentPage = Math.min(pages, Math.max(1, Math.trunc(page) || 1));
  return {
    items: groups.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    page: currentPage,
    pages,
    total: groups.length,
  };
}
export function validateProductPackaging(
  type: CommercialProductType,
  rule:
    | (Pick<SeriesCommercialRule, "salesUnit" | "quantityInputMode"> &
        Partial<
          Pick<
            SeriesCommercialRule,
            "minimumLengthPerPieceFt" | "lengthIncrementFt"
          >
        >)
    | null,
  length: number | null,
) {
  if (length !== null && (!Number.isFinite(length) || length <= 0))
    throw new CatalogItemRejected(
      "Package length must be positive / 包装长度必须大于零",
    );
  if (type !== "hose") {
    if (length !== null)
      throw new CatalogItemRejected(
        "Package length is not applicable / 此产品不适用包装长度",
      );
    return;
  }
  if (!rule) return;
  if (
    rule.salesUnit.toLowerCase() === "ft" &&
    rule.quantityInputMode.toLowerCase().includes("length")
  ) {
    if (!rule.minimumLengthPerPieceFt || !rule.lengthIncrementFt)
      throw new CatalogItemRejected(
        "Length ordering rules are incomplete / 长度销售规则不完整",
      );
  } else if (!length)
    throw new CatalogItemRejected(
      "Packaged Hose requires package length / 定长包装胶管需要包装长度",
    );
}
