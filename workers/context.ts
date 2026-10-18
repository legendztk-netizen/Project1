import { createContext } from "react-router";

import type {
  ApplicationBindings,
  ValidatedRuntimeEnvironment,
} from "./environment";
import type { AdminIdentity } from "./admin-access";

export interface CloudflareContext {
  adminIdentity?: AdminIdentity;
  // Cloudflare request metadata. React Router rebuilds the Request for data
  // submissions, which drops `request.cf`, so routes read it from here.
  cf?: IncomingRequestCfProperties;
  env: ApplicationBindings;
  runtime: ValidatedRuntimeEnvironment;
  ctx: ExecutionContext;
}

export const cloudflareContext = createContext<CloudflareContext>();
