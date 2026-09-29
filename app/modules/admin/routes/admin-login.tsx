import { Form, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/admin-login";
import { cloudflareContext } from "#workers/context";
import {
  loginAdmin,
  readAdminSession,
  readAdminForm,
} from "../infrastructure/admin-password-auth";
import "../styles/admin-accounts.css";
export function meta() {
  return [{ title: "后台登录 | Hydraulic Supply" }];
}
export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  if (env.ADMIN_AUTH_MODE !== "password")
    throw new Response("此环境使用统一身份认证", { status: 403 });
  if (await readAdminSession(env.DB, request)) return redirect("/admin");
  return {
    passwordChanged:
      new URL(request.url).searchParams.get("passwordChanged") === "1",
  };
}
export async function action({ context, request }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  if (env.ADMIN_AUTH_MODE !== "password")
    throw new Response("此环境使用统一身份认证", { status: 403 });
  const form = await readAdminForm(request);
  try {
    const cookie = await loginAdmin(
      env.DB,
      request,
      String(form.get("username") ?? ""),
      String(form.get("password") ?? ""),
    );
    return redirect("/admin", { headers: { "Set-Cookie": cookie } });
  } catch (error) {
    if (error instanceof Response && [400, 429].includes(error.status))
      return { error: await error.text() };
    throw error;
  }
}
export default function AdminLogin({
  actionData,
  loaderData,
}: Route.ComponentProps) {
  const navigation = useNavigation();
  return (
    <main className="admin-login">
      <section>
        <span className="eyebrow">HYDRAULIC SUPPLY · 管理后台</span>
        <h1>登录后台</h1>
        <p>使用主账号或已授权的子账号登录。</p>
        {loaderData?.passwordChanged && (
          <p role="status">密码已修改，请使用新密码重新登录。</p>
        )}
        <Form method="post">
          <label>
            用户名
            <input
              name="username"
              autoComplete="username"
              required
              maxLength={32}
              autoFocus
            />
          </label>
          <label>
            登录密码
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </label>
          {actionData?.error && <p role="alert">{actionData.error}</p>}
          <button
            className="button button-primary"
            disabled={navigation.state !== "idle"}
          >
            {navigation.state === "idle" ? "登录" : "正在登录…"}
          </button>
        </Form>
        <small>忘记密码请联系主账号管理员重置。</small>
      </section>
    </main>
  );
}
