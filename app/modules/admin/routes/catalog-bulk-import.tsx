import { redirect } from "react-router";
import type { Route } from "./+types/catalog-bulk-import";
import {
  requireAdminRequestContext,
  requireCatalogWriteContext,
} from "../infrastructure/admin-request-context";

export function loader({ context }: Route.LoaderArgs) {
  requireAdminRequestContext(context);
  return redirect("/admin/catalog/requests#bulk-import");
}

export function action({ context }: Route.ActionArgs) {
  requireCatalogWriteContext(context);
  // Preserve uploads submitted from an already-open legacy import page.
  return redirect("/admin/catalog/requests", 307);
}
