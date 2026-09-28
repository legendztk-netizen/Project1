import { useState } from "react";
import { Form, Link, useNavigation } from "react-router";
import {
  ClipboardList,
  Download,
  FileText,
  LockKeyhole,
  Paperclip,
  RotateCcw,
  Send,
} from "lucide-react";

import type { ConversationMessage } from "../../quote-conversation/domain/quote-conversation";
import type { MessageThreadSummary } from "../application/message-center-service";
import "./message-center.css";

type Language = "en" | "zh";

const stageLabel: Record<Language, Record<string, string>> = {
  en: {
    processing: "Processing",
    ready: "Ready to ship",
    shipped: "Shipped",
    delivered: "Delivered",
  },
  zh: {
    processing: "待备妥",
    ready: "已备妥 · 待发货",
    shipped: "已发货",
    delivered: "已送达",
  },
};

function timeFormatter(language: Language) {
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: language === "zh" ? "Asia/Shanghai" : "America/New_York",
  });
}

function formatTime(value: string, language: Language) {
  return `${timeFormatter(language).format(new Date(value))} ${language === "zh" ? "北京时间" : "ET"}`;
}

function money(cents: number, currency: string) {
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

export interface ThreadContext {
  requestId: string;
  referenceNumber: string;
  submittedAt: string;
  currency: string | null;
  merchandiseSubtotal: number | null;
  customerEmail: string | null;
  order: {
    id: string;
    orderNumber: string;
    totalCents: number;
    currency: string;
    confirmedAt: string;
    stage: string | null;
    lineCount: number;
    shipmentCount: number;
    deliveredCount: number;
  } | null;
  cases: Array<{
    id: string;
    caseNumber: string;
    reason: string;
    status: "open" | "closed";
    createdAt: string;
  }>;
}

export interface InternalNote {
  id: string;
  body: string;
  adminEmail: string | null;
  createdAt: string;
  topic: { caseId: string; caseNumber: string } | null;
}

export function threadTitle(
  thread: Pick<MessageThreadSummary, "order" | "referenceNumber">,
  language: Language,
) {
  if (thread.order)
    return language === "zh"
      ? `订单 ${thread.order.orderNumber}`
      : `Order ${thread.order.orderNumber}`;
  return language === "zh"
    ? `询价 ${thread.referenceNumber}`
    : `Quote ${thread.referenceNumber}`;
}

export function MessageInbox({
  threads,
  language,
  threadHref,
  empty,
}: {
  threads: MessageThreadSummary[];
  language: Language;
  threadHref: (requestId: string) => string;
  empty: string;
}) {
  if (!threads.length) return <p className="message-inbox-empty">{empty}</p>;
  return (
    <ul className="message-inbox">
      {threads.map((thread) => (
        <li key={thread.requestId}>
          <Link
            className={`message-inbox-row${thread.unread ? " unread" : ""}`}
            to={threadHref(thread.requestId)}
          >
            <span className="message-inbox-heading">
              <strong>{threadTitle(thread, language)}</strong>
              {thread.order?.stage && (
                <span className="message-chip">
                  {stageLabel[language][thread.order.stage]}
                </span>
              )}
              {thread.openCases > 0 && (
                <span className="message-chip message-chip-case">
                  {language === "zh"
                    ? `${thread.openCases} 个售后处理中`
                    : `${thread.openCases} open ${thread.openCases === 1 ? "case" : "cases"}`}
                </span>
              )}
              {thread.unread > 0 && (
                <span
                  className="message-unread-badge"
                  aria-label={
                    language === "zh"
                      ? `${thread.unread} 条未读`
                      : `${thread.unread} unread`
                  }
                >
                  {thread.unread > 99 ? "99+" : thread.unread}
                </span>
              )}
            </span>
            {language === "zh" && thread.customerEmail && (
              <span className="message-inbox-meta">
                {thread.customerEmail}
                {thread.order ? ` · 询价 ${thread.referenceNumber}` : ""}
              </span>
            )}
            <span className="message-inbox-preview">
              {thread.lastMessage ? (
                <>
                  <b>
                    {thread.lastMessage.authorRole === "admin"
                      ? language === "zh"
                        ? "客服："
                        : "Our team: "
                      : language === "zh"
                        ? "客户："
                        : "You: "}
                  </b>
                  {thread.lastMessage.body ||
                    (thread.lastMessage.hasAttachment
                      ? language === "zh"
                        ? "［附件］"
                        : "[Attachment]"
                      : "")}
                </>
              ) : language === "zh" ? (
                "仅有内部备注"
              ) : null}
            </span>
            {thread.lastMessage && (
              <time dateTime={thread.lastMessage.createdAt}>
                {formatTime(thread.lastMessage.createdAt, language)}
              </time>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ThreadContextCard({
  context,
  language,
  caseReasonLabel,
}: {
  context: ThreadContext;
  language: Language;
  caseReasonLabel: Record<string, string>;
}) {
  const zh = language === "zh";
  const order = context.order;
  const orderHref = order
    ? zh
      ? `/admin/orders/${encodeURIComponent(order.id)}`
      : `/account/orders/${encodeURIComponent(order.id)}`
    : null;
  const quoteHref = zh
    ? `/admin/quotes/${encodeURIComponent(context.requestId)}`
    : `/account/quotes/${encodeURIComponent(context.requestId)}`;
  return (
    <aside
      className="message-context-card"
      aria-label={zh ? "订单概况" : "Order summary"}
    >
      {order ? (
        <>
          <span className="eyebrow">{zh ? "订单" : "Order"}</span>
          <h2>{order.orderNumber}</h2>
          <dl>
            <div>
              <dt>{zh ? "状态" : "Status"}</dt>
              <dd>{order.stage ? stageLabel[language][order.stage] : "—"}</dd>
            </div>
            <div>
              <dt>{zh ? "金额" : "Total"}</dt>
              <dd>{money(order.totalCents, order.currency)}</dd>
            </div>
            <div>
              <dt>{zh ? "确认时间" : "Confirmed"}</dt>
              <dd>{formatTime(order.confirmedAt, language)}</dd>
            </div>
            <div>
              <dt>{zh ? "商品行" : "Items"}</dt>
              <dd>{order.lineCount}</dd>
            </div>
            <div>
              <dt>{zh ? "批次送达" : "Shipments delivered"}</dt>
              <dd>
                {order.deliveredCount} / {order.shipmentCount}
              </dd>
            </div>
            {zh && context.customerEmail && (
              <div>
                <dt>客户</dt>
                <dd>{context.customerEmail}</dd>
              </div>
            )}
          </dl>
          {context.cases.length > 0 && (
            <>
              <h3>{zh ? "售后案件" : "After-sales Cases"}</h3>
              <ul className="message-context-cases">
                {context.cases.map((item) => (
                  <li key={item.id}>
                    <strong>{item.caseNumber}</strong>
                    <span>{caseReasonLabel[item.reason] ?? item.reason}</span>
                    <span
                      className={`message-chip${item.status === "open" ? " message-chip-case" : ""}`}
                    >
                      {item.status === "open"
                        ? zh
                          ? "处理中"
                          : "Open"
                        : zh
                          ? "已关闭"
                          : "Closed"}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="message-context-links">
            <Link className="button button-secondary" to={orderHref!}>
              <ClipboardList size={17} aria-hidden="true" />
              {zh ? "查看订单" : "View order"}
            </Link>
            {context.cases.length > 0 && (
              <Link
                className="button button-secondary"
                to={`${orderHref}?tab=${zh ? "after-sales" : "returns"}`}
              >
                <RotateCcw size={17} aria-hidden="true" />
                {zh ? "取消与售后" : "Returns and refunds"}
              </Link>
            )}
            <Link to={quoteHref}>
              <FileText size={16} aria-hidden="true" />
              {zh
                ? `原始询价 ${context.referenceNumber}`
                : `Quote ${context.referenceNumber}`}
            </Link>
          </div>
        </>
      ) : (
        <>
          <span className="eyebrow">{zh ? "询价" : "Quote"}</span>
          <h2>{context.referenceNumber}</h2>
          <dl>
            <div>
              <dt>{zh ? "提交时间" : "Submitted"}</dt>
              <dd>{formatTime(context.submittedAt, language)}</dd>
            </div>
            {context.merchandiseSubtotal !== null && (
              <div>
                <dt>{zh ? "商品小计" : "Merchandise subtotal"}</dt>
                <dd>
                  {context.currency ?? "USD"}{" "}
                  {context.merchandiseSubtotal.toFixed(2)}
                </dd>
              </div>
            )}
            {zh && context.customerEmail && (
              <div>
                <dt>客户</dt>
                <dd>{context.customerEmail}</dd>
              </div>
            )}
          </dl>
          <div className="message-context-links">
            <Link className="button button-secondary" to={quoteHref}>
              <FileText size={17} aria-hidden="true" />
              {zh ? "查看询价" : "View quote"}
            </Link>
          </div>
        </>
      )}
    </aside>
  );
}

type TimelineItem =
  | { kind: "message"; createdAt: string; message: ConversationMessage }
  | { kind: "note"; createdAt: string; note: InternalNote };

export function ConversationThread({
  messages,
  notes = [],
  cases,
  commandId,
  noteCommandId,
  attachmentBase,
  olderHref,
  latestHref,
  language,
  initialCaseId,
  error,
}: {
  messages: ConversationMessage[];
  notes?: InternalNote[];
  cases: ThreadContext["cases"];
  commandId: string;
  noteCommandId?: string;
  attachmentBase: string;
  olderHref: string | null;
  latestHref: string | null;
  language: Language;
  initialCaseId?: string | null;
  error?: string;
}) {
  const zh = language === "zh";
  const pending = useNavigation().state !== "idle";
  const [mode, setMode] = useState<"message" | "note">("message");
  const timeline: TimelineItem[] = [
    ...messages.map((message) => ({
      kind: "message" as const,
      createdAt: message.createdAt,
      message,
    })),
    ...notes.map((note) => ({
      kind: "note" as const,
      createdAt: note.createdAt,
      note,
    })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  // Reply under the Case the other side last wrote about, unless a Case
  // was chosen explicitly (for example from the Order page).
  const latestTopic = [...messages].reverse().find((message) => message.topic)
    ?.topic?.caseId;
  const preferred = initialCaseId ?? latestTopic;
  const defaultCase =
    preferred && cases.some((item) => item.id === preferred) ? preferred : "";
  return (
    <section
      className="message-thread"
      aria-label={zh ? "对话记录" : "Conversation"}
    >
      {olderHref && (
        <Link to={olderHref}>{zh ? "更早的消息" : "Older messages"}</Link>
      )}
      {latestHref && (
        <Link to={latestHref}>{zh ? "最新消息" : "Latest messages"}</Link>
      )}
      {timeline.length ? (
        <ol className="quote-conversation-messages">
          {timeline.map((item) =>
            item.kind === "message" ? (
              <li
                key={item.message.id}
                className={`quote-message quote-message-${item.message.authorRole}`}
              >
                <header>
                  <strong>
                    {item.message.authorRole === "admin"
                      ? zh
                        ? "客服团队"
                        : "Our team"
                      : zh
                        ? "客户"
                        : "You"}
                    {item.message.topic && (
                      <span className="message-chip message-chip-case">
                        {zh ? "售后 " : "Case "}
                        {item.message.topic.caseNumber}
                      </span>
                    )}
                  </strong>
                  <time dateTime={item.message.createdAt}>
                    {formatTime(item.message.createdAt, language)}
                  </time>
                </header>
                {item.message.body && <p>{item.message.body}</p>}
                {item.message.attachment && (
                  <a
                    className="quote-message-attachment"
                    href={`${attachmentBase}/${encodeURIComponent(item.message.id)}`}
                  >
                    <Download size={16} aria-hidden="true" />
                    {item.message.attachment.filename} ·{" "}
                    {Math.ceil(item.message.attachment.byteSize / 1024)} KB
                  </a>
                )}
                {item.message.source === "email" && (
                  <small>{zh ? "来自邮件回复" : "Sent by email reply"}</small>
                )}
              </li>
            ) : (
              <li key={item.note.id} className="quote-message message-note">
                <header>
                  <strong>
                    <LockKeyhole size={14} aria-hidden="true" /> 内部备注
                    {item.note.adminEmail ? ` · ${item.note.adminEmail}` : ""}
                    {item.note.topic && (
                      <span className="message-chip message-chip-case">
                        售后 {item.note.topic.caseNumber}
                      </span>
                    )}
                  </strong>
                  <time dateTime={item.note.createdAt}>
                    {formatTime(item.note.createdAt, language)}
                  </time>
                </header>
                <p>{item.note.body}</p>
                <small>仅管理后台可见，客户看不到</small>
              </li>
            ),
          )}
        </ol>
      ) : (
        <p className="message-inbox-empty">
          {zh
            ? "暂无消息。"
            : "No messages yet. Ask us anything about this quote or order."}
        </p>
      )}
      {error && (
        <p className="shipping-change-error" role="alert">
          {error}
        </p>
      )}
      <Form
        id="latest"
        key={`${commandId}:${noteCommandId ?? ""}`}
        method="post"
        encType="multipart/form-data"
        className="quote-conversation-composer"
      >
        <input
          type="hidden"
          name="commandId"
          value={mode === "note" ? noteCommandId : commandId}
        />
        {noteCommandId && (
          <fieldset className="message-mode">
            <legend>类型</legend>
            <label>
              <input
                type="radio"
                name="intent"
                value="message"
                checked={mode === "message"}
                onChange={() => setMode("message")}
              />
              回复客户（发送邮件提醒）
            </label>
            <label>
              <input
                type="radio"
                name="intent"
                value="note"
                checked={mode === "note"}
                onChange={() => setMode("note")}
              />
              内部备注（客户不可见）
            </label>
          </fieldset>
        )}
        {cases.length > 0 && (
          <label>
            {zh ? "关于" : "About"}
            <select name="caseId" defaultValue={defaultCase}>
              <option value="">
                {zh ? "订单 / 询价（一般问题）" : "This order in general"}
              </option>
              {cases.map((item) => (
                <option key={item.id} value={item.id}>
                  {zh ? "售后案件 " : "Case "}
                  {item.caseNumber}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          {mode === "note" ? "备注内容" : zh ? "发送给客户的消息" : "Message"}
          <textarea
            name="body"
            rows={4}
            maxLength={mode === "note" ? 5000 : 10000}
            required={mode === "note"}
          />
        </label>
        {mode === "message" && (
          <label>
            <span>
              <Paperclip size={15} aria-hidden="true" />{" "}
              {zh
                ? "附件（可选，PDF / PNG / JPEG，最大 10 MB）"
                : "Attachment (optional · PDF / PNG / JPEG · 10 MB max)"}
            </span>
            <input
              type="file"
              name="file"
              accept="application/pdf,image/png,image/jpeg"
            />
          </label>
        )}
        <button
          type="submit"
          className="button button-primary"
          disabled={pending}
        >
          {mode === "note" ? (
            <LockKeyhole size={18} aria-hidden="true" />
          ) : (
            <Send size={18} aria-hidden="true" />
          )}
          {pending
            ? zh
              ? "提交中"
              : "Sending"
            : mode === "note"
              ? "保存内部备注"
              : zh
                ? "发送消息"
                : "Send message"}
        </button>
      </Form>
    </section>
  );
}
