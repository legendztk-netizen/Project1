import { createContext } from "react-router";

import type { ApplicationBindings, ValidatedRuntimeEnvironment } from "./environment";

export interface CloudflareContext {
  env: ApplicationBindings;
  runtime: ValidatedRuntimeEnvironment;
  ctx: ExecutionContext;
}

export const cloudflareContext = createContext<CloudflareContext>();
