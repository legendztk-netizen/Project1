import { CircleAlert, Landmark, Save, ShieldCheck } from "lucide-react";
import { Form, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/commercial-settings";
import {
  SELLER_LEGAL_NAME,
  paymentChannel,
  paymentInstructionsReadyForPi,
  sellerIdentityReadyForPi,
  validatedEnglishChinaRegisteredAddress,
  validatedPaymentInstructions,
  type PaymentChannel,
} from "../../seller-settings/domain/seller-commercial-settings";
import { createD1SellerCommercialSettingsRepository } from "../../seller-settings/infrastructure/d1-seller-commercial-settings-repository";
import { requireCommercialSettingsRequestContext } from "../infrastructure/admin-request-context";
import { AdminNavigation } from "../ui/admin-navigation";

export function meta() {
  return [{ title: "商业设置 | 管理后台" }];
}

function formText(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const { adminIdentity, env } =
    requireCommercialSettingsRequestContext(context);
  const snapshot = await createD1SellerCommercialSettingsRepository(
    env.DB,
  ).findSnapshot();
  return {
    adminIdentity,
    commandIds: {
      bankTransfer: crypto.randomUUID(),
      paypal: crypto.randomUUID(),
      seller: crypto.randomUUID(),
    },
    environment: env.APP_ENV,
    saved: new URL(request.url).searchParams.get("saved"),
    snapshot,
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { adminIdentity, env } =
    requireCommercialSettingsRequestContext(context);
  if (request.method !== "POST")
    throw new Response("Method not allowed", { status: 405 });
  const form = await request.formData();
  const intent = formText(form, "intent");
  const commandId = formText(form, "commandId") || crypto.randomUUID();
  const repository = createD1SellerCommercialSettingsRepository(env.DB);
  try {
    if (intent === "save_seller_identity") {
      await repository.saveSellerIdentity({
        actorId: adminIdentity.id,
        address: validatedEnglishChinaRegisteredAddress(
          formText(form, "registeredAddressEn"),
        ),
        commandId,
        id: crypto.randomUUID(),
        now: new Date().toISOString(),
      });
      return redirect("/admin/settings/commercial?saved=seller");
    }
    if (intent === "save_payment_instructions") {
      const channel = paymentChannel(formText(form, "channel"));
      await repository.savePaymentInstructions({
        actorId: adminIdentity.id,
        channel,
        commandId,
        id: crypto.randomUUID(),
        instructions: validatedPaymentInstructions(
          formText(form, "instructions"),
        ),
        now: new Date().toISOString(),
      });
      return redirect(`/admin/settings/commercial?saved=${channel}`);
    }
    throw new Error("Unknown commercial settings command");
  } catch (error) {
    return {
      formError:
        error instanceof Error
          ? error.message
          : "Commercial settings were not saved",
    };
  }
}

const channelLabels: Record<PaymentChannel, string> = {
  bank_transfer: "Bank Transfer",
  paypal: "PayPal",
};

function SubmitButton({ children }: { children: React.ReactNode }) {
  const navigation = useNavigation();
  return (
    <button
      className="button button-primary"
      disabled={navigation.state === "submitting"}
      type="submit"
    >
      <Save aria-hidden="true" size={16} /> {children}
    </button>
  );
}

export default function CommercialSettings({
  actionData,
  loaderData,
}: Route.ComponentProps) {
  const { snapshot } = loaderData;
  const sellerReady = sellerIdentityReadyForPi(snapshot.identity);
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="system" />
      <main className="admin-main commercial-settings-page">
        <header className="admin-topbar">
          <div>
            <span className="eyebrow">管理后台</span>
            <h1>商业设置</h1>
            <p>维护报价与 PI 使用的卖方身份和收款说明。</p>
          </div>
          <span className="environment-badge">
            {loaderData.adminIdentity.accountType} · {loaderData.environment}
          </span>
        </header>

        {loaderData.saved ? (
          <p className="catalog-update-success" role="status">
            <ShieldCheck size={17} /> 已创建新版本，旧版本保留只读。
          </p>
        ) : null}
        {actionData?.formError ? (
          <p className="form-error" role="alert">
            <CircleAlert size={17} /> {actionData.formError}
          </p>
        ) : null}

        <section className="commercial-settings-grid">
          <article className="admin-panel commercial-settings-panel">
            <div className="commercial-settings-heading">
              <div>
                <span className="eyebrow">Seller Identity</span>
                <h2>卖方身份</h2>
              </div>
              <span
                className={`settings-readiness ${sellerReady ? "ready" : "missing"}`}
              >
                {sellerReady ? "可用于 PI" : "缺少正式注册地址"}
              </span>
            </div>
            <Form method="post" className="commercial-settings-form">
              <input name="intent" type="hidden" value="save_seller_identity" />
              <input
                name="commandId"
                type="hidden"
                value={loaderData.commandIds.seller}
              />
              <label>
                <span>English legal name</span>
                <input readOnly value={SELLER_LEGAL_NAME} />
              </label>
              <label>
                <span>China registered address (English)</span>
                <textarea
                  defaultValue={snapshot.identity?.registeredAddressEn ?? ""}
                  name="registeredAddressEn"
                  placeholder={
                    "CHINA REGISTERED ADDRESS PLACEHOLDER\nCity, Province, Postal Code\nChina"
                  }
                  required
                  rows={5}
                />
              </label>
              <p className="field-note">
                必须填写中国工商注册地址的英文版本。下方 Plano
                退货地址不能代替此项。
              </p>
              <SubmitButton>保存卖方身份新版本</SubmitButton>
            </Form>
          </article>

          <article className="admin-panel commercial-settings-panel return-location-panel">
            <div>
              <span className="eyebrow">Separate operational location</span>
              <h2>Plano 退货地址</h2>
            </div>
            {snapshot.returnLocations.map((location) => (
              <div className="return-location" key={location.id}>
                <Landmark aria-hidden="true" size={22} />
                <div>
                  <strong>{location.label}</strong>
                  <p>{location.address}</p>
                  <p>{location.phone}</p>
                  <small>{location.purpose}</small>
                </div>
              </div>
            ))}
          </article>
        </section>

        <section className="admin-panel commercial-settings-panel payment-settings">
          <div>
            <span className="eyebrow">Admin only until PI issuance</span>
            <h2>收款说明</h2>
            <p>
              管理员粘贴完整多行说明。每次保存都会创建新版本，旧版本不能修改。
            </p>
          </div>
          <div className="payment-channel-grid">
            {(Object.keys(channelLabels) as PaymentChannel[]).map((channel) => {
              const versions = snapshot.payments.filter(
                (version) => version.channel === channel,
              );
              const current =
                versions.find((version) => version.status === "current") ??
                null;
              return (
                <section className="payment-channel" key={channel}>
                  <div className="commercial-settings-heading">
                    <h3>{channelLabels[channel]}</h3>
                    <span
                      className={`settings-readiness ${paymentInstructionsReadyForPi(current) ? "ready" : "missing"}`}
                    >
                      {current ? `当前 v${current.version}` : "尚未配置"}
                    </span>
                  </div>
                  <Form method="post" className="commercial-settings-form">
                    <input
                      name="intent"
                      type="hidden"
                      value="save_payment_instructions"
                    />
                    <input name="channel" type="hidden" value={channel} />
                    <input
                      name="commandId"
                      type="hidden"
                      value={
                        channel === "bank_transfer"
                          ? loaderData.commandIds.bankTransfer
                          : loaderData.commandIds.paypal
                      }
                    />
                    <label>
                      <span>{channelLabels[channel]} Payment Instructions</span>
                      <textarea
                        name="instructions"
                        placeholder={`${channelLabels[channel].toUpperCase()} PAYMENT INSTRUCTIONS PLACEHOLDER`}
                        required
                        rows={7}
                      />
                    </label>
                    <SubmitButton>创建新版本</SubmitButton>
                  </Form>
                  {versions.length ? (
                    <details className="payment-history">
                      <summary>查看版本历史（{versions.length}）</summary>
                      {versions.map((version) => (
                        <article key={version.id}>
                          <strong>
                            v{version.version} ·{" "}
                            {version.status === "current" ? "当前" : "已替代"}
                          </strong>
                          <small>
                            {version.createdAt} · {version.createdBy}
                          </small>
                          <pre>{version.instructions}</pre>
                        </article>
                      ))}
                    </details>
                  ) : null}
                </section>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
