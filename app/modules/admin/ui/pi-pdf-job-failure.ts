import type { PiPdfFailureCode } from "../../proforma-invoice/application/pi-pdf-jobs";

// Why a PI PDF job failed for good; retrying such a job cannot succeed.
export function piPdfPermanentFailureText(code: PiPdfFailureCode) {
  return code === "inputs_changed"
    ? "此 PI 无法生成：签发后报价、卖方信息或付款说明已变更，或已有其他 PI。请核对后重新签发。"
    : "此 PI 无法生成：PI 已失效（例如有效期已过）。请重新签发。";
}
