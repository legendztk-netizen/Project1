import { redirect } from "react-router";
import type { Route } from "./+types/admin-logout";
import { cloudflareContext } from "#workers/context";
import {
  logoutAdmin,
  readAdminForm,
} from "../infrastructure/admin-password-auth";
export async function action({ context, request }: Route.ActionArgs) {
  await readAdminForm(request);
  const { env } = context.get(cloudflareContext);
  return redirect("/admin/login", {
    headers: { "Set-Cookie": await logoutAdmin(env.DB, request) },
  });
}
export function loader() {
  return redirect("/admin/login");
}
