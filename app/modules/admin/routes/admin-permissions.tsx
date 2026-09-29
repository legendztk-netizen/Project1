import { useEffect, useRef, useState } from "react";
import { redirect, useFetcher } from "react-router";
import type { Route } from "./+types/admin-permissions";
import { ADMIN_MODULES } from "../domain/admin-module-access";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { createAdminAccounts } from "../infrastructure/d1-admin-accounts";
import {
  readAdminForm,
  changeOwnerPassword,
} from "../infrastructure/admin-password-auth";
import { AdminNavigation } from "../ui/admin-navigation";
import "../styles/admin-accounts.css";
export function meta() {
  return [{ title: "账号权限 | 管理后台" }];
}
export async function loader({ context }: Route.LoaderArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const accounts = await createAdminAccounts(env.DB).list();
  return {
    isOwner: adminIdentity.accountType === "owner",
    accounts:
      adminIdentity.accountType === "owner"
        ? accounts
        : accounts.filter((a) => a.id === adminIdentity.id),
  };
}
export async function action({ context, request }: Route.ActionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  if (adminIdentity.accountType !== "owner")
    throw new Response("只有主账号可以管理子账号", { status: 403 });
  const form = await readAdminForm(request);
  try {
    if (form.get("intent") === "change_password") {
      const cookie = await changeOwnerPassword(
        env.DB,
        request,
        adminIdentity.id,
        String(form.get("currentPassword") ?? ""),
        String(form.get("password") ?? ""),
      );
      return redirect("/admin/login?passwordChanged=1", {
        headers: { "Set-Cookie": cookie },
      });
    }
    await createAdminAccounts(env.DB).mutate(adminIdentity.id, form);
    return { ok: true, error: null, intent: String(form.get("intent")) };
  } catch (error) {
    if (
      error instanceof Response &&
      [400, 404, 409, 429].includes(error.status)
    )
      return {
        ok: false,
        error: await error.text(),
        intent: String(form.get("intent")),
      };
    throw error;
  }
}
type Account = Awaited<ReturnType<typeof loader>>["accounts"][number];
const labels: Record<string, string> = {
  change_password: "修改登录密码",
  create: "新增子账号",
  permissions: "配置权限",
  reset: "重置密码",
  disable: "禁用账号",
  enable: "启用账号",
  delete: "删除账号",
};
function AccountDialog({
  intent,
  account,
  close,
  submit,
  busy,
  error,
}: {
  intent: string;
  account: Account | null;
  close: () => void;
  submit: (f: FormData) => void;
  busy: boolean;
  error: string | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="admin-account-dialog"
      aria-label={labels[intent]}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <header>
        <h2>{labels[intent]}</h2>
        <button type="button" aria-label="关闭" disabled={busy} onClick={close}>
          ×
        </button>
      </header>
      {account && (
        <p>
          {account.name || account.username} · {account.username || "旧账号"}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(new FormData(e.currentTarget));
        }}
      >
        <input type="hidden" name="intent" value={intent} />
        <input type="hidden" name="id" value={account?.id ?? ""} />
        <input type="hidden" name="version" value={account?.version ?? 0} />
        <fieldset disabled={busy}>
          {intent === "create" && (
            <>
              <label>
                用户名
                <input
                  name="username"
                  required
                  minLength={3}
                  maxLength={32}
                  pattern={"[a-zA-Z][a-zA-Z0-9_.\\-]{2,31}"}
                  autoComplete="off"
                  placeholder="例如 zhangsan"
                />
                <small>3–32 位，以字母开头，创建后固定。</small>
              </label>
              <label>
                姓名
                <input name="name" required maxLength={60} autoComplete="off" />
              </label>
            </>
          )}
          {intent === "change_password" && (
            <label>
              当前密码
              <input
                type="password"
                name="currentPassword"
                autoComplete="current-password"
                required
                maxLength={128}
              />
            </label>
          )}
          {["create", "reset", "change_password"].includes(intent) && (
            <label>
              {intent !== "create" ? "新密码" : "登录密码"}
              <input
                type="password"
                name="password"
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                required
              />
              <small>8–128 位，包含大写字母、小写字母和数字。</small>
            </label>
          )}
          {intent === "create" && (
            <p className="admin-account-hint">
              创建后点击“配置权限”授权。新账号默认不能访问业务模块。
            </p>
          )}
          {intent === "permissions" && (
            <>
              <p className="admin-account-hint">
                只读可以查看和下载；可操作编辑可以提交修改。账号管理和主账号专属审批仅限主账号。
              </p>
              {ADMIN_MODULES.map((m) => (
                <label className="admin-module-row" key={m.key}>
                  <span>
                    <strong>{m.label}</strong>
                    <small>{m.description}</small>
                  </span>
                  <select
                    name={`module.${m.key}`}
                    defaultValue={account?.permissions[m.key] ?? "none"}
                  >
                    <option value="none">禁止访问</option>
                    <option value="read">只读</option>
                    <option value="write">可操作编辑</option>
                  </select>
                </label>
              ))}
            </>
          )}
          {intent === "change_password" && (
            <p>
              修改成功后，主账号的所有登录会话都会退出，请使用新密码重新登录。
            </p>
          )}
          {intent === "reset" && <p>重置后，该账号需要使用新密码重新登录。</p>}
          {intent === "disable" && (
            <p>
              禁用后立即退出已有登录，账号无法继续访问后台。以后可以重新启用。
            </p>
          )}
          {intent === "enable" && (
            <p>恢复该账号原有权限，使用原密码重新登录。</p>
          )}
          {intent === "delete" && (
            <p>
              删除后移出账号列表并禁止登录，密码和授权被清除。历史业务操作记录保留，该用户名不再复用。
            </p>
          )}
        </fieldset>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button type="button" disabled={busy} onClick={close}>
            取消
          </button>
          <button
            className={
              intent === "delete"
                ? "button button-danger"
                : "button button-primary"
            }
            disabled={busy}
            type="submit"
          >
            {busy
              ? "正在保存…"
              : intent === "create"
                ? "创建子账号"
                : `确认${labels[intent]}`}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
export default function AdminPermissions({ loaderData }: Route.ComponentProps) {
  const mutation = useFetcher<typeof action>();
  const [dialog, setDialog] = useState<{
    intent: string;
    account: Account | null;
  } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = mutation.state !== "idle";
  useEffect(() => {
    if (submitted && mutation.state === "idle" && mutation.data) {
      setSubmitted(false);
      if (mutation.data.ok) {
        setDialog(null);
        setError(null);
      } else setError(mutation.data.error);
    }
  }, [submitted, mutation.state, mutation.data]);
  const open = (intent: string, account: Account | null = null) => {
    setError(null);
    setDialog({ intent, account });
  };
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="permissions" />
      <main className="admin-main admin-accounts">
        <header className="admin-topbar">
          <div>
            <span className="eyebrow">后台管理 / ACCOUNTS</span>
            <h1>账号权限</h1>
            <p>用独立账号登录，按模块分配查看和操作权限。</p>
          </div>
          {loaderData.isOwner && (
            <button
              className="button button-primary"
              onClick={() => open("create")}
            >
              ＋ 新增子账号
            </button>
          )}
        </header>
        {mutation.data?.ok && !dialog && (
          <p role="status" className="catalog-update-success">
            {labels[mutation.data.intent]}成功。
          </p>
        )}
        <div className="admin-account-table">
          <table>
            <thead>
              <tr>
                <th>用户名</th>
                <th>姓名</th>
                <th>状态</th>
                <th>权限</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {loaderData.accounts.map((a) => (
                <tr key={a.id}>
                  <td>
                    <strong>{a.username || "未设置用户名"}</strong>
                    {a.accountType === "owner" && <small>主账号 · Owner</small>}
                  </td>
                  <td>{a.name || "—"}</td>
                  <td>
                    <span
                      className={
                        a.status === "active"
                          ? "account-active"
                          : "account-disabled"
                      }
                    >
                      {a.status === "active" ? "已启用" : "已禁用"}
                    </span>
                  </td>
                  <td>
                    {a.accountType === "owner"
                      ? "全部权限"
                      : Object.keys(a.permissions).length
                        ? ADMIN_MODULES.filter((m) => a.permissions[m.key]).map(
                            (m) => (
                              <span
                                className="admin-permission-chip"
                                key={m.key}
                              >
                                {m.label} ·{" "}
                                {a.permissions[m.key] === "write"
                                  ? "可操作编辑"
                                  : "只读"}
                              </span>
                            ),
                          )
                        : "尚未授权"}
                  </td>
                  <td>
                    {a.accountType === "subaccount" && loaderData.isOwner ? (
                      <div className="admin-account-actions">
                        <button onClick={() => open("permissions", a)}>
                          配置权限
                        </button>
                        <button onClick={() => open("reset", a)}>
                          重置密码
                        </button>
                        <button
                          onClick={() =>
                            open(
                              a.status === "active" ? "disable" : "enable",
                              a,
                            )
                          }
                        >
                          {a.status === "active" ? "禁用" : "启用"}
                        </button>
                        <button
                          className="account-delete"
                          onClick={() => open("delete", a)}
                        >
                          删除
                        </button>
                      </div>
                    ) : a.accountType === "owner" && loaderData.isOwner ? (
                      <button
                        className="button button-secondary"
                        onClick={() => open("change_password", a)}
                      >
                        修改登录密码
                      </button>
                    ) : (
                      <span className="admin-account-hint">
                        {a.accountType === "owner"
                          ? "主账号受保护"
                          : "请联系主账号修改"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {loaderData.isOwner &&
          !loaderData.accounts.some((a) => a.accountType === "subaccount") && (
            <section className="admin-account-empty">
              <h2>还没有子账号</h2>
              <p>输入用户名、登录密码和姓名即可创建，再按工作需要分配权限。</p>
              <button
                className="button button-primary"
                onClick={() => open("create")}
              >
                创建第一个子账号
              </button>
            </section>
          )}
        {dialog && (
          <AccountDialog
            key={`${dialog.intent}:${dialog.account?.id ?? "new"}`}
            {...dialog}
            close={() => setDialog(null)}
            busy={busy}
            error={error}
            submit={(form) => {
              setSubmitted(true);
              void mutation.submit(form, { method: "post" });
            }}
          />
        )}
      </main>
    </div>
  );
}
