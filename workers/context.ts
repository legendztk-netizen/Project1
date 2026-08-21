import { createContext } from "react-router";

export interface CloudflareContext {
  env: CloudflareBindings;
  ctx: ExecutionContext;
}

export const cloudflareContext = createContext<CloudflareContext>();
