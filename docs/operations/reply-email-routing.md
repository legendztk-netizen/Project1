# 回复邮件路由

决策见 [ADR 0055](../adr/0055-route-reply-email-through-one-dispatcher-worker.md)；
2026-10-16 起 Cloudflare 只运行 production（[ADR 0058](../adr/0058-run-only-production-on-the-former-preview-data.md)）。

`customhoseco.com` 的 Email Routing 只有一条 catch-all，指向账号级分发 Worker
`hydraulic-hose-email-dispatcher`（`workers/email-dispatcher/`）。分发 Worker 按收件人域名转交：

| 收件域名                 | 服务绑定                   | 目标 Worker                              |
| ------------------------ | -------------------------- | ---------------------------------------- |
| `reply.customhoseco.com` | `PRODUCTION_INBOUND_EMAIL` | `hydraulic-hose-rfq-platform-production` |

目标是应用 Worker 的命名入口 `InboundEmail`（`workers/app.ts`），与 `email()` 处理器走同一接收路径。
其他收件人（包括 `customhoseco.com` 本身的地址和已停用的 `reply-preview.customhoseco.com`）在分发层直接退信，不写数据库。
目标 Worker 没有该入口或调用失败时退信并提示稍后重发。

域名必须与根目录 `wrangler.jsonc` 中 production 的 `EMAIL_REPLY_DOMAIN` 一致，
`test/email-dispatcher.test.ts` 会校验。

## 部署顺序

1. 先部署带 `InboundEmail` 入口的应用 Worker（`pnpm deploy:production`）。
2. `pnpm deploy:email-dispatcher`。停用 preview 时必须先部署不再绑定 preview 的分发 Worker，
   再删除 `hydraulic-hose-rfq-platform-preview`，否则该 Worker 仍被服务绑定引用。
3. 把 catch-all 改为 Worker `hydraulic-hose-email-dispatcher`：
   `PUT /zones/{zone_id}/email/routing/rules/catch_all`，
   `actions: [{ "type": "worker", "value": ["hydraulic-hose-email-dispatcher"] }]`。
4. 在 Email Routing 中启用子域名 `reply.customhoseco.com`（`POST /zones/{zone_id}/email/routing/dns`，
   `{"name": "reply.customhoseco.com"}`），它会添加该子域名的 MX 与 SPF 记录。

Production Worker 尚未部署带入口的版本前，发往 `reply.customhoseco.com` 的邮件会退信并提示稍后重发，
不会被静默接收。

## 验证

- `wrangler tail hydraulic-hose-email-dispatcher` 与 production Worker 同时观察。
- 从外部邮箱发到 `test@reply.customhoseco.com`：分发 Worker 无异常，
  production 记录一条 `invalid_reply_address` 隔离回执（无效令牌按原规则隔离，不退信）。
- 发到 `test@customhoseco.com`：发件人收到退信，production 无新回执。

## 回退

把 catch-all 改为直接指向 `hydraulic-hose-rfq-platform-production`（它的 `email()` 处理器仍保留），
此时其他收件人不再由分发层退信，而由应用按无效回复地址隔离。
