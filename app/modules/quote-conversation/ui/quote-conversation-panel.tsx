import { Form, Link, useLocation, useNavigation } from "react-router";
import { Download, Send } from "lucide-react";
import type { ConversationMessage } from "../domain/quote-conversation";

export function QuoteConversationPanel({
  messages,
  commandId,
  olderHref,
  attachmentBase,
  admin = false,
  error,
}: {
  messages: ConversationMessage[];
  commandId: string;
  olderHref: string | null;
  attachmentBase: string;
  admin?: boolean;
  error?: string;
}) {
  const pending = useNavigation().state !== "idle";
  const location = useLocation();
  const formatter = new Intl.DateTimeFormat(admin ? "zh-CN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: admin ? "Asia/Shanghai" : "America/New_York",
  });
  return (
    <section
      className="quote-conversation-panel"
      aria-label={admin ? "客户会话" : "Quote conversation"}
    >
      {olderHref ? (
        <Link to={olderHref}>{admin ? "更早的消息" : "Older messages"}</Link>
      ) : null}
      {new URLSearchParams(location.search).has("before") ? (
        <Link to={location.pathname}>
          {admin ? "最新消息" : "Latest messages"}
        </Link>
      ) : null}
      {messages.length ? (
        <ol className="quote-conversation-messages">
          {messages.map((message) => (
            <li
              key={message.id}
              className={`quote-message quote-message-${message.authorRole}`}
            >
              <header>
                <strong>
                  {message.authorRole === "admin"
                    ? admin
                      ? "客服团队"
                      : "Our team"
                    : admin
                      ? "客户"
                      : "You"}
                </strong>
                <time dateTime={message.createdAt}>
                  {formatter.format(new Date(message.createdAt))}{" "}
                  {admin ? "北京时间" : "ET"}
                </time>
              </header>
              <p>{message.body}</p>
              {message.attachment ? (
                <a
                  className="quote-message-attachment"
                  href={`${attachmentBase}/${encodeURIComponent(message.id)}`}
                >
                  <Download size={16} aria-hidden="true" />
                  {message.attachment.filename} ·{" "}
                  {Math.ceil(message.attachment.byteSize / 1024)} KB
                </a>
              ) : null}
              <small>
                {message.source === "email" ? (admin ? "邮件回复 · " : "Email reply · ") : ""}
                {message.deliveryState === "available"
                  ? admin
                    ? "已发布至会话"
                    : "Published in conversation"
                  : message.deliveryState}
              </small>
            </li>
          ))}
        </ol>
      ) : (
        <p>{admin ? "暂无客户消息" : "No messages yet."}</p>
      )}
      {error ? <p role="alert">{error}</p> : null}
      <Form
        key={commandId}
        method="post"
        encType="multipart/form-data"
        className="quote-conversation-composer"
      >
        <input type="hidden" name="commandId" value={commandId} />
        <label>
          {admin ? "发送给客户的消息" : "Message"}
          <textarea name="body" rows={5} maxLength={10000} />
        </label>
        <label>
          {admin
            ? "客户可见附件（可选，PDF / PNG / JPEG，最大 10 MB）"
            : "Attachment (Optional · PDF / PNG / JPEG · 10 MB max)"}
          <input
            type="file"
            name="file"
            accept="application/pdf,image/png,image/jpeg"
          />
        </label>
        <button
          type="submit"
          className="button button-primary"
          disabled={pending}
        >
          <Send size={18} aria-hidden="true" />
          {pending
            ? admin
              ? "发送中"
              : "Sending"
            : admin
              ? "发送消息"
              : "Send message"}
        </button>
      </Form>
    </section>
  );
}
