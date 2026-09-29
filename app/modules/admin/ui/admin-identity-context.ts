import { createContext } from "react";
import type { AdminIdentity } from "#workers/admin-access";
export const AdminIdentityContext = createContext<AdminIdentity | undefined>(
  undefined,
);
