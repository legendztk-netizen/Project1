import { CircleAlert, KeyRound, Save, ShieldCheck } from "lucide-react";
import { Form, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/admin-permissions";
import {
  ADMIN_PERMISSIONS,
  isAdminPermission,
} from "../domain/admin-permissions";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { createD1AdminPermissions } from "../infrastructure/d1-admin-permissions";
import { AdminNavigation } from "../ui/admin-navigation";

export function meta() {
  return [{ title: "账号权限 | 管理后台" }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const { adminIdentity, env } = requireAdminRequestContext(context);
  const accounts = await createD1AdminPermissions(env.DB).list();
  const isOwner = adminIdentity.accountType === "owner";
  return {
    isOwner,
    // A subaccount sees only its own permissions.
    accounts: isOwner
      ? accounts
      : accounts.filter((account) => account.id === adminIdentity.id),
    commandIds: Object.fromEntries(
      accounts.map((account) => [account.id, crypto.randomUUID()]),
    ),
    saved: new URL(request.url).searchParams.get("saved"),
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { adminIdentity, env } = requireAdminRequestContext(context);
  if (adminIdentity.accountType !== "owner")
    throw new Response("只有 Owner 可以管理账号权限", { status: 403 });
  const form = await request.formData();
  const permissions = form.getAll("permission").filter(isAdminPermission);
  try {
    await createD1AdminPermissions(env.DB).setSubaccountPermissions({
      ownerId: adminIdentity.id,
      adminId: String(form.get("adminId") ?? ""),
      permissions,
      commandId: String(form.get("commandId") ?? "") || crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      auditIp: request.headers.get("cf-connecting-ip") ?? "local",
    });
  } catch (error) {
    if (error instanceof Response && error.status === 404)
      return { formError: await error.text() };
    throw error;
  }
  return redirect("/admin/settings/permissions?saved=1");
}

function SaveButton() {
  const navigation = useNavigation();
  return (
    <button
      className="button button-primary"
      disabled={navigation.state === "submitting"}
      type="submit"
    >
      <Save aria-hidden="true" size={16} /> 保存权限
    </button>
  );
}

export default function AdminPermissions({
  actionData,
  loaderData,
}: Route.ComponentProps) {
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="permissions" />
      <main className="admin-main commercial-settings-page">
        <header className="admin-topbar">
          <div>
            <span className="eyebrow">管理后台</span>
            <h1>账号权限</h1>
            <p>
              Owner
              为每个子账号单独勾选权限；新权限不会自动授予子账号。每次修改都记录审计。
            </p>
          </div>
        </header>
        {loaderData.saved ? (
          <p className="catalog-update-success" role="status">
            <ShieldCheck size={17} /> 权限已保存并记录审计。
          </p>
        ) : null}
        {actionData?.formError ? (
          <p className="form-error" role="alert">
            <CircleAlert size={17} /> {actionData.formError}
          </p>
        ) : null}
        {!loaderData.accounts.some(
          (account) => account.accountType === "subaccount",
        ) ? (
          <p role="status">
            还没有子账号。子账号创建后会出现在这里，由 Owner 逐项授予权限。
          </p>
        ) : null}
        <section className="commercial-settings-grid">
          {loaderData.accounts.map((account) => {
            const editable =
              loaderData.isOwner &&
              account.accountType === "subaccount" &&
              account.status === "active";
            return (
              <article
                className="admin-panel commercial-settings-panel"
                key={account.id}
              >
                <div className="commercial-settings-heading">
                  <div>
                    <span className="eyebrow">
                      {account.accountType === "owner" ? "Owner" : "子账号"}
                      {account.status === "disabled" ? " · 已停用" : ""}
                    </span>
                    <h2>{account.email}</h2>
                  </div>
                  <KeyRound aria-hidden="true" size={18} />
                </div>
                {account.accountType === "owner" ? (
                  <p>Owner 拥有全部权限，包括管理子账号和批准替代退款账户。</p>
                ) : (
                  <Form method="post" className="commercial-settings-form">
                    <input type="hidden" name="adminId" value={account.id} />
                    <input
                      type="hidden"
                      name="commandId"
                      value={loaderData.commandIds[account.id]}
                    />
                    <fieldset disabled={!editable}>
                      <legend>售后权限</legend>
                      {ADMIN_PERMISSIONS.map((permission) => (
                        <label
                          className="admin-permission-option"
                          key={permission.key}
                        >
                          <input
                            type="checkbox"
                            name="permission"
                            value={permission.key}
                            defaultChecked={account.permissions.includes(
                              permission.key,
                            )}
                          />
                          <span>
                            <strong>{permission.label}</strong>
                            <small>{permission.description}</small>
                          </span>
                        </label>
                      ))}
                    </fieldset>
                    {editable ? <SaveButton /> : null}
                  </Form>
                )}
              </article>
            );
          })}
        </section>
      </main>
    </div>
  );
}
