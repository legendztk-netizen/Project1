import type { ApplicationBindings } from "./environment";
import {
  createPiAcceptanceService,
  type PiRequestEvidence,
} from "../app/modules/proforma-invoice/application/pi-acceptance-service";

export function piAcceptance(env: ApplicationBindings) {
  return createPiAcceptanceService(env.DB, env.PRIVATE_FILES);
}

export function piAcceptanceRequestEvidence(
  request: Request,
): PiRequestEvidence {
  return {
    requestId: request.headers.get("cf-ray") || crypto.randomUUID(),
    ipAddress: request.headers.get("CF-Connecting-IP") || null,
    userAgent: request.headers.get("User-Agent") || null,
  };
}

export type PiAcceptanceStatus = Omit<
  Awaited<ReturnType<ReturnType<typeof piAcceptance>["customerStatus"]>>,
  "viewId"
> & { viewId: string | null };
