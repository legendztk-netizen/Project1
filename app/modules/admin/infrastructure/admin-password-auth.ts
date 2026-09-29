import {
  hashCustomerPassword,
  verifyCustomerPassword,
  validatedCustomerPassword,
  type PasswordCredentialHash,
} from "../../customer-identity/domain/customer-password";
import type { AdminIdentity } from "../../../../workers/admin-access";
import type { ModuleAccess } from "../domain/admin-module-access";
const COOKIE = "hs_admin_session";
const encoder = new TextEncoder();
export async function tokenDigest(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function adminCookie(token: string, request: Request, clear = false) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 28800}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
function tokenFrom(request: Request) {
  return (
    request.headers
      .get("cookie")
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1) ?? ""
  );
}
export async function adminPasswordHash(password: string) {
  try {
    return JSON.stringify(
      await hashCustomerPassword(await validatedCustomerPassword(password)),
    );
  } catch {
    throw new Response(
      "密码需为 8–128 位，包含大写字母、小写字母和数字，且不能使用常见弱密码。",
      { status: 400 },
    );
  }
}
export async function readAdminSession(
  db: D1Database,
  request: Request,
): Promise<AdminIdentity | null> {
  const token = tokenFrom(request);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const row = await db
    .prepare(
      `SELECT i.id,i.email,i.username,i.display_name,i.account_type FROM admin_password_sessions s JOIN admin_identities i ON i.id=s.admin_id AND i.credential_version=s.credential_version WHERE s.token_hash=? AND s.expires_at>? AND i.status='active' AND i.deleted_at IS NULL`,
    )
    .bind(await tokenDigest(token), new Date().toISOString())
    .first<{
      id: string;
      email: string;
      username: string;
      display_name: string;
      account_type: "owner" | "subaccount";
    }>();
  if (!row) return null;
  const grants = (
    await db
      .prepare(
        "SELECT module,level FROM admin_module_permissions WHERE admin_id=?",
      )
      .bind(row.id)
      .all<{ module: keyof ModuleAccess; level: "read" | "write" }>()
  ).results;
  const moduleAccess = Object.fromEntries(
    grants.map((g) => [g.module, g.level]),
  ) as ModuleAccess;
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    accountType: row.account_type,
    canManageSubaccounts: row.account_type === "owner",
    source: "password",
    moduleAccess,
    catalogPermission:
      row.account_type === "owner" || moduleAccess.catalog === "write"
        ? "edit"
        : "view",
    permissions: moduleAccess.after_sales
      ? [
          "after_sales.review",
          ...(moduleAccess.after_sales === "write"
            ? ["after_sales.refund" as const]
            : []),
        ]
      : [],
  };
}
async function verifyAdminCredentials(
  db: D1Database,
  request: Request,
  username: string,
  password: string,
) {
  username = username.trim().toLowerCase();
  if (username.length > 64 || password.length > 128)
    throw new Response("用户名或密码错误", { status: 400 });
  const now = new Date(),
    expiry = new Date(now.getTime() + 15 * 60_000).toISOString();
  const keys = [
    `user:${await tokenDigest(username)}`,
    `ip:${await tokenDigest(request.headers.get("cf-connecting-ip") ?? "local")}`,
  ];
  // Reserve an attempt atomically before expensive hashing; concurrent requests cannot bypass limits.
  const limits = await db.batch(
    keys.map((key) =>
      db
        .prepare(
          `INSERT INTO admin_login_limits(key,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING attempts,expires_at`,
        )
        .bind(key, expiry, now.toISOString(), now.toISOString()),
    ),
  );
  if (
    limits.some(
      (r, i) =>
        Number((r.results[0] as { attempts: number }).attempts) > (i ? 30 : 10),
    )
  )
    throw new Response("尝试次数过多，请 15 分钟后重试", { status: 429 });
  const row = await db
    .prepare(
      `SELECT id,password_hash,credential_version FROM admin_identities WHERE username=? COLLATE NOCASE AND status='active' AND deleted_at IS NULL`,
    )
    .bind(username)
    .first<{
      id: string;
      password_hash: string | null;
      credential_version: number;
    }>();
  const dummy: PasswordCredentialHash = {
    algorithm: "PBKDF2-HMAC-SHA-256",
    derivedKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    salt: "AAAAAAAAAAAAAAAAAAAAAA",
    hashBytes: 32,
    normalization: "NFC",
    workFactor: 600000,
  };
  const valid = await verifyCustomerPassword(
    password,
    row?.password_hash ? JSON.parse(row.password_hash) : dummy,
  );
  if (!valid || !row?.password_hash)
    throw new Response("用户名或密码错误", { status: 400 });
  // Successful verification releases only its own reserved attempts. Do not
  // clear shared-IP failures belonging to other accounts or a newer window.
  await db.batch(
    keys.map((key, index) =>
      db
        .prepare(
          "UPDATE admin_login_limits SET attempts=max(0,attempts-1) WHERE key=? AND expires_at=?",
        )
        .bind(
          key,
          (limits[index].results[0] as { expires_at: string }).expires_at,
        ),
    ),
  );
  return { row, now };
}
export async function loginAdmin(
  db: D1Database,
  request: Request,
  username: string,
  password: string,
) {
  const { row, now } = await verifyAdminCredentials(
    db,
    request,
    username,
    password,
  );
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  await db.batch([
    db
      .prepare(
        `INSERT INTO admin_password_sessions(token_hash,admin_id,credential_version,expires_at) SELECT ?,id,credential_version,? FROM admin_identities WHERE id=? AND credential_version=? AND status='active' AND deleted_at IS NULL`,
      )
      .bind(
        await tokenDigest(token),
        new Date(now.getTime() + 8 * 3600_000).toISOString(),
        row.id,
        row.credential_version,
      ),
    db
      .prepare("DELETE FROM admin_login_limits WHERE expires_at<=?")
      .bind(now.toISOString()),
    db
      .prepare("DELETE FROM admin_password_sessions WHERE expires_at<=?")
      .bind(now.toISOString()),
  ]);
  return adminCookie(token, request);
}
export async function logoutAdmin(db: D1Database, request: Request) {
  await db
    .prepare("DELETE FROM admin_password_sessions WHERE token_hash=?")
    .bind(await tokenDigest(tokenFrom(request)))
    .run();
  return adminCookie("", request, true);
}
export async function readAdminForm(request: Request) {
  if (request.method !== "POST")
    throw new Response("Method not allowed", { status: 405 });
  if (request.headers.get("origin") !== new URL(request.url).origin)
    throw new Response("请求来源无效", { status: 403 });
  const reader = request.body?.getReader();
  if (!reader) throw new Response("缺少表单", { status: 400 });
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 16384) {
      await reader.cancel();
      throw new Response("表单过大", { status: 413 });
    }
    chunks.push(new Uint8Array(value));
  }
  return new Response(new Blob(chunks), {
    headers: { "Content-Type": request.headers.get("Content-Type") ?? "" },
  }).formData();
}

export async function changeOwnerPassword(
  db: D1Database,
  request: Request,
  ownerId: string,
  currentPassword: string,
  newPassword: string,
) {
  const owner = await db
    .prepare(
      "SELECT username FROM admin_identities WHERE id=? AND account_type='owner' AND status='active' AND deleted_at IS NULL",
    )
    .bind(ownerId)
    .first<{ username: string }>();
  if (!owner?.username)
    throw new Response("主账号不存在或未设置密码登录", { status: 403 });
  const { row, now } = await verifyAdminCredentials(
    db,
    request,
    owner.username,
    currentPassword,
  );
  if (row.id !== ownerId)
    throw new Response("主账号身份不一致", { status: 403 });
  if (currentPassword === newPassword)
    throw new Response("新密码不能与当前密码相同", { status: 400 });
  const hash = await adminPasswordHash(newPassword);
  try {
    await db.batch([
      db
        .prepare(
          "UPDATE admin_identities SET password_hash=?,credential_version=credential_version+1,updated_at=? WHERE id=? AND credential_version=? AND account_type='owner' AND status='active'",
        )
        .bind(hash, now.toISOString(), ownerId, row.credential_version),
      db.prepare(
        "INSERT INTO admin_permission_write_assertions(failed) SELECT 1 WHERE changes()!=1",
      ),
      db
        .prepare("DELETE FROM admin_password_sessions WHERE admin_id=?")
        .bind(ownerId),
      db
        .prepare(
          "INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at) VALUES(?,'admin.password_changed','admin_identity',?,?,'{}',?)",
        )
        .bind(crypto.randomUUID(), ownerId, ownerId, now.toISOString()),
    ]);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Concurrent permission change")
    )
      throw new Response("密码已被修改，请重新登录", { status: 409 });
    throw error;
  }
  return adminCookie("", request, true);
}
