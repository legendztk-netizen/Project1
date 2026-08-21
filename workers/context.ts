import { createContext } from "react-router";

import type {
  ApplicationBindings,
  ValidatedRuntimeEnvironment,
} from "./environment";
import type { AdminIdentity } from "./admin-access";

export interface CloudflareContext {
  adminIdentity?: AdminIdentity;
  env: ApplicationBindings;
  runtime: ValidatedRuntimeEnvironment;
  ctx: ExecutionContext;
}

export const cloudflareContext = createContext<CloudflareContext>();
