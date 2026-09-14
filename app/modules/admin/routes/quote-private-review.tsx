import { Form, Link, data, redirect, useNavigation } from "react-router";
import { ArrowLeft, Download, Save, Upload } from "lucide-react";
import type { Route } from "./+types/quote-private-review";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { createPrivateReview } from "../../quote-review/infrastructure/d1-private-review";
import {
  requireReviewMutation,
  readPrivateReviewForm,
} from "../../quote-review/domain/private-review";
import { formatBeijingDateTime } from "../../quote-review/domain/admin-quote-review";
import { AdminNavigation } from "../ui/admin-navigation";

export async function loader({ context, params }: Route.LoaderArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const result = await createPrivateReview(
    env.DB,
    env.PRIVATE_FILES,
    adminIdentity,
  ).list(params.requestId);
  return data(
    {
      ...result,
      noteCommand: crypto.randomUUID(),
      uploadCommand: crypto.randomUUID(),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export function headers() {
  return {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
  };
}

export async function action({ context, params, request }: Route.ActionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  requireReviewMutation(request);
  const form = await readPrivateReviewForm(request);
  const service = createPrivateReview(env.DB, env.PRIVATE_FILES, adminIdentity);
  if (form.get("intent") === "note") {
    await service.appendNote(
      params.requestId,
      String(form.get("body") ?? ""),
      String(form.get("commandId") ?? ""),
    );
  } else if (form.get("intent") === "upload") {
    const file = form.get("file");
    if (!file || typeof file === "string")
      throw new Response("File required", { status: 400 });
    await service.upload(
      params.requestId,
      String(form.get("kind")),
      file,
      String(form.get("commandId") ?? ""),
    );
  } else if (form.get("intent") === "download") {
    const token = await service.grant(
      params.requestId,
      String(form.get("evidenceId")),
    );
    return redirect(
      `/admin/quotes/${encodeURIComponent(params.requestId)}/private/download?token=${encodeURIComponent(token)}`,
    );
  } else throw new Response("Invalid operation", { status: 400 });
  return redirect(
    `/admin/quotes/${encodeURIComponent(params.requestId)}/private`,
  );
}

export default function PrivateReview({
  loaderData,
  params,
}: Route.ComponentProps) {
  const pending = useNavigation().state !== "idle";
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="quotes" />
      <main className="admin-main private-review-page">
        <Link
          className="admin-back-link"
          to={`/admin/quotes/${params.requestId}`}
        >
          <ArrowLeft size={17} />
          返回询价详情
        </Link>
        <h1>内部审核资料</h1>
        <section className="admin-quote-section">
          <h2>内部备注</h2>
          {loaderData.notes.map((note) => (
            <article key={note.id}>
              <p style={{ whiteSpace: "pre-wrap" }}>{note.body}</p>
              <small>
                {note.actor_id} · {formatBeijingDateTime(note.created_at)}
              </small>
            </article>
          ))}
          <Form
            key={loaderData.noteCommand}
            method="post"
            className="commercial-settings-form"
          >
            <input type="hidden" name="intent" value="note" />
            <input
              type="hidden"
              name="commandId"
              value={loaderData.noteCommand}
            />
            <label>
              新增备注
              <textarea name="body" required maxLength={10000} rows={4} />
            </label>
            <button
              className="button button-primary"
              disabled={pending}
              type="submit"
            >
              <Save size={18} />
              添加备注
            </button>
          </Form>
        </section>
        <section className="admin-quote-section">
          <h2>私有证明文件</h2>
          {loaderData.files.map((file) => (
            <article key={file.id}>
              <strong>{file.filename}</strong> ·{" "}
              {file.kind === "tax_exemption" ? "免税证明" : "审核附件"}
              <Form method="post" reloadDocument>
                <input type="hidden" name="intent" value="download" />
                <input type="hidden" name="evidenceId" value={file.id} />
                <button className="button button-secondary" type="submit">
                  <Download size={18} />
                  下载
                </button>
              </Form>
            </article>
          ))}
          <Form
            method="post"
            encType="multipart/form-data"
            className="commercial-settings-form"
          >
            <input type="hidden" name="intent" value="upload" />
            <input
              type="hidden"
              name="commandId"
              value={loaderData.uploadCommand}
            />
            <label>
              文件用途
              <select name="kind">
                <option value="supporting">审核附件</option>
                <option value="tax_exemption">免税证明</option>
              </select>
            </label>
            <label>
              附件（PDF / PNG / JPEG，最大 10 MB）
              <input
                name="file"
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                required
              />
            </label>
            <button
              className="button button-primary"
              disabled={pending}
              type="submit"
            >
              <Upload size={18} />
              上传私有附件
            </button>
          </Form>
        </section>
      </main>
    </div>
  );
}
