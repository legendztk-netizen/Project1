import {
  Building2,
  Check,
  CheckCircle2,
  CircleUserRound,
  ClipboardList,
  FileText,
  ListChecks,
  MapPin,
  Pencil,
  Trash2,
} from "lucide-react";
import { data, Form, Link, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/customer-account";
import { cloudflareContext } from "#workers/context";
import {
  createCustomerAccountService,
  CustomerAccountAccessError,
  CustomerAccountValidationError,
} from "../application/customer-account-service";
import {
  createCustomerProfileService,
  CustomerProfileValidationError,
} from "../application/customer-profile-service";
import type {
  DeliveryAddress,
  DeliveryAddressDraft,
  PurchasingContext,
} from "../domain/customer-account";
import { COUNTRY_CODES } from "../domain/customer-account";
import { requireTrustedAuthPost } from "../application/trusted-auth-request";
import {
  isAccountDetailView,
  type AccountDetailView,
} from "../ui/account-detail-navigation";
import { AccountWorkspace } from "../ui/account-workspace";
import { createSavedConfigurationService } from "../application/saved-configuration-service";
import {
  savedConfigurationLabel,
  type SavedConfiguration,
} from "../domain/saved-configuration";

function selectedView(request: Request): AccountDetailView {
  const requested = new URL(request.url).searchParams.get("view");
  return isAccountDetailView(requested) ? requested : "overview";
}

function text(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

const accountActions = [
  "update_contact",
  "create_address",
  "update_address",
  "select_address",
  "delete_address",
  "create_organization",
  "select_context",
  "delete_saved_configuration",
] as const;

const countryDisplayNames = new Intl.DisplayNames(["en"], { type: "region" });
const customerDateTime = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  timeZone: "America/New_York",
  timeZoneName: "short",
  year: "numeric",
});

type AccountAction = (typeof accountActions)[number];

function accountAction(form: FormData): AccountAction | null {
  const requested = text(form, "intent");
  return accountActions.find((intent) => intent === requested) ?? null;
}

function deliveryAddressDraft(form: FormData): DeliveryAddressDraft {
  return {
    addressLine1: text(form, "addressLine1"),
    addressLine2: text(form, "addressLine2"),
    city: text(form, "city"),
    countryCode: text(form, "countryCode"),
    label: text(form, "label"),
    postalCode: text(form, "postalCode"),
    recipientEmail: text(form, "recipientEmail"),
    recipientName: text(form, "recipientName"),
    recipientPhone: text(form, "recipientPhone"),
    stateProvince: text(form, "stateProvince"),
  };
}

function countryOptionLabel(countryCode: string) {
  return `${countryDisplayNames.of(countryCode) ?? countryCode} (${countryCode})`;
}

function signInRedirect(view: AccountDetailView) {
  const returnTo = encodeURIComponent(`/account?view=${view}`);
  return redirect(`/sign-in?returnTo=${returnTo}`);
}

export function meta() {
  return [{ title: "Account & Lists | Hydraulic Supply" }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const view = selectedView(request);
  const account = await createCustomerAccountService(env).read(request);
  if (!account) {
    const url = new URL(request.url);
    const returnTo = encodeURIComponent(`${url.pathname}${url.search}`);
    throw redirect(`/sign-in?returnTo=${returnTo}`);
  }
  const editAddressId = new URL(request.url).searchParams.get("editAddress");
  const editingAddress = editAddressId
    ? account.addresses.find((address) => address.id === editAddressId)
    : null;
  if (editAddressId && !editingAddress) {
    throw new Response("Address not found", { status: 404 });
  }
  const savedConfigurations =
    (await createSavedConfigurationService(env).list(request)) ?? [];
  return {
    ...account,
    editingAddress,
    saved: new URL(request.url).searchParams.get("saved") === "1",
    savedConfigurations,
    view,
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { env, runtime } = context.get(cloudflareContext);
  requireTrustedAuthPost({
    environment: runtime.environment,
    request,
    storefrontOrigin: env.PUBLIC_STOREFRONT_ORIGIN,
  });
  const form = await request.formData();
  const intent = accountAction(form);
  const view = selectedView(request);
  const account = createCustomerAccountService(env);

  if (!intent) {
    return data(
      { error: "Unsupported account action.", intent: "unsupported" },
      { status: 400 },
    );
  }

  try {
    let result: boolean | object | null;
    switch (intent) {
      case "update_contact":
        result = await createCustomerProfileService(env).updateContact({
          fullName: text(form, "fullName"),
          phoneNumber: text(form, "phoneNumber"),
          request,
        });
        break;
      case "create_address":
        result = await account.createAddress({
          ...deliveryAddressDraft(form),
          request,
        });
        break;
      case "update_address":
        result = await account.updateAddress({
          ...deliveryAddressDraft(form),
          addressId: text(form, "addressId"),
          request,
        });
        break;
      case "select_address":
        result = await account.selectAddress({
          addressId: text(form, "addressId"),
          request,
        });
        break;
      case "delete_address":
        result = await account.deleteAddress({
          addressId: text(form, "addressId"),
          request,
        });
        break;
      case "create_organization":
        result = await account.createOrganization({
          countryCode: text(form, "organizationCountryCode"),
          legalName: text(form, "legalName"),
          registrationOrTaxId: text(form, "registrationOrTaxId"),
          request,
          tradeName: text(form, "tradeName"),
        });
        break;
      case "select_context":
        result = await account.selectPurchasingContext({
          contextId: text(form, "contextId"),
          request,
        });
        break;
      case "delete_saved_configuration":
        result = await createSavedConfigurationService(env).delete({
          id: text(form, "savedConfigurationId"),
          request,
        });
        if (result === false) throw new CustomerAccountAccessError();
        break;
    }

    if (!result) throw signInRedirect(view);
    const destination =
      intent === "delete_saved_configuration"
        ? "/account?view=saved-configurations"
        : intent === "create_address" ||
            intent === "update_address" ||
            intent === "select_address" ||
            intent === "delete_address"
          ? "/account?view=addresses&saved=1"
          : "/account?view=profile&saved=1";
    return redirect(destination);
  } catch (error) {
    if (error instanceof CustomerAccountAccessError) {
      return data(
        { error: "The requested account record was not found.", intent },
        { status: 404 },
      );
    }
    if (
      error instanceof CustomerAccountValidationError ||
      error instanceof CustomerProfileValidationError
    ) {
      return data({ error: error.message, intent }, { status: 422 });
    }
    throw error;
  }
}

function SavedConfigurationsDetail({
  configurations,
}: {
  configurations: SavedConfiguration[];
}) {
  return (
    <section className="account-record-detail saved-configurations-detail">
      <span className="eyebrow">Reusable drafts</span>
      <h1>Saved Configurations</h1>
      <p className="account-detail-intro">
        Resume a private copy and recheck it against the current catalog before
        adding it to your Quote List.
      </p>
      {configurations.length === 0 ? (
        <div className="account-inline-empty">
          <p>No saved hose configurations yet.</p>
          <Link className="button button-secondary" to="/build-a-hose">
            Build a hose
          </Link>
        </div>
      ) : (
        <div className="saved-configuration-list">
          {configurations.map((configuration) => (
            <article key={configuration.id}>
              <div>
                <span className="eyebrow">
                  {configuration.source === "registration"
                    ? "Saved during registration"
                    : "Saved configuration"}
                </span>
                <h2>{savedConfigurationLabel(configuration.snapshot)}</h2>
                <p>
                  Stage: {configuration.snapshot.stage.replace("-", " ")} ·
                  Updated{" "}
                  {customerDateTime.format(new Date(configuration.updatedAt))}
                </p>
              </div>
              <div className="saved-configuration-actions">
                <Link
                  className="button button-primary"
                  to={`/build-a-hose?savedConfiguration=${encodeURIComponent(configuration.id)}`}
                >
                  Resume
                </Link>
                <Form method="post">
                  <input
                    name="savedConfigurationId"
                    type="hidden"
                    value={configuration.id}
                  />
                  <button
                    className="button button-secondary"
                    name="intent"
                    type="submit"
                    value="delete_saved_configuration"
                  >
                    <Trash2 aria-hidden="true" size={17} />
                    Delete
                  </button>
                </Form>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function EmptyDetail(input: {
  description: string;
  title: string;
  to?: string;
}) {
  return (
    <section className="account-empty-detail">
      <h1>{input.title}</h1>
      <p>{input.description}</p>
      {input.to ? (
        <Link className="button button-secondary" to={input.to}>
          Browse products
        </Link>
      ) : null}
    </section>
  );
}

function AddressFields({
  address,
  profileEmail,
}: {
  address?: DeliveryAddress | null;
  profileEmail: string;
}) {
  return (
    <div className="account-form-grid">
      <label>
        Address label
        <input
          defaultValue={address?.label ?? "Delivery address"}
          maxLength={60}
          name="label"
          required
        />
      </label>
      <label>
        Recipient name
        <input
          autoComplete="name"
          defaultValue={address?.recipientName ?? ""}
          maxLength={120}
          name="recipientName"
          required
        />
      </label>
      <label>
        Recipient email
        <input
          autoComplete="email"
          defaultValue={address?.recipientEmail ?? profileEmail}
          maxLength={254}
          name="recipientEmail"
          required
          type="email"
        />
      </label>
      <label>
        Recipient phone
        <input
          autoComplete="tel"
          defaultValue={address?.recipientPhone ?? ""}
          maxLength={40}
          name="recipientPhone"
          required
          type="tel"
        />
      </label>
      <label>
        Country / region
        <select
          defaultValue={address?.countryCode ?? "US"}
          name="countryCode"
          required
        >
          {COUNTRY_CODES.map((countryCode) => (
            <option key={countryCode} value={countryCode}>
              {countryOptionLabel(countryCode)}
            </option>
          ))}
        </select>
      </label>
      <label>
        State / province
        <input
          autoComplete="address-level1"
          defaultValue={address?.stateProvince ?? ""}
          maxLength={100}
          name="stateProvince"
          required
        />
      </label>
      <label>
        City
        <input
          autoComplete="address-level2"
          defaultValue={address?.city ?? ""}
          maxLength={100}
          name="city"
          required
        />
      </label>
      <label>
        Postal code
        <input
          autoComplete="postal-code"
          defaultValue={address?.postalCode ?? ""}
          maxLength={24}
          name="postalCode"
          required
        />
      </label>
      <label className="account-form-wide">
        Street address
        <input
          autoComplete="address-line1"
          defaultValue={address?.addressLine1 ?? ""}
          maxLength={160}
          name="addressLine1"
          required
        />
      </label>
      <label className="account-form-wide">
        Apartment, suite or unit <span>Optional</span>
        <input
          autoComplete="address-line2"
          defaultValue={address?.addressLine2 ?? ""}
          maxLength={160}
          name="addressLine2"
        />
      </label>
    </div>
  );
}

function AddressesDetail({
  actionData,
  addresses,
  busy,
  editingAddress,
  profileEmail,
  saved,
}: {
  actionData?: { error?: string };
  addresses: DeliveryAddress[];
  busy: boolean;
  editingAddress?: DeliveryAddress | null;
  profileEmail: string;
  saved: boolean;
}) {
  return (
    <section className="account-record-detail">
      <span className="eyebrow">Delivery details</span>
      <h1>Addresses</h1>
      <p className="account-detail-intro">
        Keep reusable delivery addresses here. The address selected for a quote
        is copied into that request and remains independent from this address
        book.
      </p>
      {saved ? (
        <div className="customer-auth-success" role="status">
          Address book updated.
        </div>
      ) : null}
      {actionData?.error ? (
        <div className="customer-auth-error" role="alert">
          {actionData.error}
        </div>
      ) : null}
      {addresses.length === 0 ? (
        <p className="account-inline-empty">
          No reusable delivery addresses yet.
        </p>
      ) : (
        <div className="account-record-list">
          {addresses.map((address) => (
            <article key={address.id}>
              <div>
                <div className="account-record-title">
                  <h2>{address.label}</h2>
                  {address.isSelected ? (
                    <span>
                      <Check aria-hidden="true" size={14} /> Selected
                    </span>
                  ) : null}
                </div>
                <p>{address.recipientName}</p>
                <p>{address.addressLine1}</p>
                {address.addressLine2 ? <p>{address.addressLine2}</p> : null}
                <p>
                  {address.city}, {address.stateProvince} {address.postalCode}
                </p>
                <p>{address.countryCode}</p>
                <p>
                  {address.recipientPhone} · {address.recipientEmail}
                </p>
              </div>
              <div className="account-record-actions">
                {!address.isSelected ? (
                  <Form method="post">
                    <input name="intent" type="hidden" value="select_address" />
                    <input name="addressId" type="hidden" value={address.id} />
                    <button
                      className="button button-secondary"
                      disabled={busy}
                      type="submit"
                    >
                      <Check aria-hidden="true" size={16} /> Use this address
                    </button>
                  </Form>
                ) : null}
                <Link
                  className="button button-secondary"
                  to={`/account?view=addresses&editAddress=${encodeURIComponent(address.id)}`}
                >
                  <Pencil aria-hidden="true" size={16} /> Edit
                </Link>
                <Form method="post">
                  <input name="intent" type="hidden" value="delete_address" />
                  <input name="addressId" type="hidden" value={address.id} />
                  <button
                    className="button button-danger"
                    disabled={busy}
                    type="submit"
                  >
                    <Trash2 aria-hidden="true" size={16} /> Delete
                  </button>
                </Form>
              </div>
            </article>
          ))}
        </div>
      )}
      <section className="account-record-form-section">
        <h2>
          {editingAddress ? "Edit delivery address" : "Add delivery address"}
        </h2>
        <Form className="account-record-form" method="post">
          <input
            name="intent"
            type="hidden"
            value={editingAddress ? "update_address" : "create_address"}
          />
          {editingAddress ? (
            <input name="addressId" type="hidden" value={editingAddress.id} />
          ) : null}
          <AddressFields address={editingAddress} profileEmail={profileEmail} />
          <div className="account-form-actions">
            {editingAddress ? (
              <Link
                className="button button-secondary"
                to="/account?view=addresses"
              >
                Cancel
              </Link>
            ) : null}
            <button
              className="button button-primary"
              disabled={busy}
              type="submit"
            >
              {editingAddress ? "Save address" : "Add address"}
            </button>
          </div>
        </Form>
      </section>
    </section>
  );
}

function ContextCard({
  busy,
  context,
}: {
  busy: boolean;
  context: PurchasingContext;
}) {
  const title =
    context.kind === "individual"
      ? "Individual purchase"
      : context.tradeName || context.legalName;
  return (
    <article>
      <div>
        <div className="account-record-title">
          <h3>{title}</h3>
          {context.isSelected ? (
            <span>
              <Check aria-hidden="true" size={14} /> Current context
            </span>
          ) : null}
        </div>
        {context.kind === "organization" ? (
          <>
            <p>Legal name: {context.legalName}</p>
            <p>Country / region: {context.countryCode}</p>
            {context.registrationOrTaxId ? (
              <p>Registration / tax ID: {context.registrationOrTaxId}</p>
            ) : null}
          </>
        ) : (
          <p>Requests are made in your own name.</p>
        )}
        <p>
          Primary contact: {context.primaryContactName} ·{" "}
          {context.primaryContactEmail}
        </p>
      </div>
      {!context.isSelected ? (
        <Form method="post">
          <input name="intent" type="hidden" value="select_context" />
          <input name="contextId" type="hidden" value={context.id} />
          <button
            className="button button-secondary"
            disabled={busy}
            type="submit"
          >
            Use this context
          </button>
        </Form>
      ) : null}
    </article>
  );
}

function ProfileDetail({
  actionData,
  busy,
  profile,
  purchasingContexts,
  saved,
}: {
  actionData?: { error?: string };
  busy: boolean;
  profile: {
    email: string;
    fullName: string;
    phoneNumber: string;
  };
  purchasingContexts: PurchasingContext[];
  saved: boolean;
}) {
  return (
    <section className="account-profile-detail">
      <span className="eyebrow">Customer and purchasing identity</span>
      <h1>Profile / Company</h1>
      <p className="account-detail-intro">
        Your customer profile identifies the person acting on the account.
        Purchasing contexts identify whether a quote is for you or an
        organization.
      </p>
      {saved ? (
        <div className="customer-auth-success" role="status">
          Profile / Company updated.
        </div>
      ) : null}
      {actionData?.error ? (
        <div className="customer-auth-error" role="alert">
          {actionData.error}
        </div>
      ) : null}
      <section className="account-record-form-section">
        <h2>Customer profile</h2>
        <Form className="customer-auth-form account-profile-form" method="post">
          <input name="intent" type="hidden" value="update_contact" />
          <label htmlFor="profile-email">Verified email</label>
          <input
            disabled
            id="profile-email"
            type="email"
            value={profile.email}
          />
          <label htmlFor="profile-name">Full name</label>
          <input
            defaultValue={profile.fullName}
            id="profile-name"
            maxLength={120}
            name="fullName"
          />
          <label htmlFor="profile-phone">Phone number</label>
          <input
            autoComplete="tel"
            defaultValue={profile.phoneNumber}
            id="profile-phone"
            maxLength={40}
            name="phoneNumber"
            type="tel"
          />
          <button
            className="button button-primary"
            disabled={busy}
            type="submit"
          >
            Save contact profile
          </button>
        </Form>
      </section>
      <section className="account-context-section">
        <h2>Purchasing context</h2>
        <p>Select who the next quote request is for.</p>
        <div className="account-context-list">
          {purchasingContexts.map((context) => (
            <ContextCard busy={busy} context={context} key={context.id} />
          ))}
        </div>
      </section>
      <section className="account-record-form-section">
        <h2>Add an organization</h2>
        <p>
          You will be recorded as the Primary Company Contact. Additional
          contact roles are not managed in this first version.
        </p>
        <Form className="account-record-form" method="post">
          <input name="intent" type="hidden" value="create_organization" />
          <div className="account-form-grid">
            <label className="account-form-wide">
              Legal company name
              <input maxLength={180} name="legalName" required />
            </label>
            <label>
              Trade name <span>Optional</span>
              <input maxLength={180} name="tradeName" />
            </label>
            <label>
              Country / region
              <select defaultValue="US" name="organizationCountryCode" required>
                {COUNTRY_CODES.map((countryCode) => (
                  <option key={countryCode} value={countryCode}>
                    {countryOptionLabel(countryCode)}
                  </option>
                ))}
              </select>
            </label>
            <label className="account-form-wide">
              Registration / tax ID <span>Optional</span>
              <input maxLength={80} name="registrationOrTaxId" />
            </label>
          </div>
          <div className="account-form-actions">
            <button
              className="button button-primary"
              disabled={busy}
              type="submit"
            >
              <Building2 aria-hidden="true" size={17} /> Add organization
            </button>
          </div>
        </Form>
      </section>
    </section>
  );
}

export default function CustomerAccount({
  actionData,
  loaderData,
}: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const { profile, view } = loaderData;
  let detail;

  if (view === "overview") {
    detail = (
      <section className="account-overview">
        <span className="eyebrow">Account &amp; Lists</span>
        <h1>Welcome back{profile.fullName ? `, ${profile.fullName}` : ""}</h1>
        <div className="account-summary-grid">
          <article>
            <ListChecks aria-hidden="true" size={22} />
            <h2>Quote List</h2>
            <p>
              Review products and hose assemblies before requesting a quote.
            </p>
            <Link to="/quote-list">View Quote List</Link>
          </article>
          <article>
            <FileText aria-hidden="true" size={22} />
            <h2>My Quotes</h2>
            <p>No submitted quote requests yet.</p>
            <Link to="/account?view=my-quotes">View My Quotes</Link>
          </article>
          <article>
            <ClipboardList aria-hidden="true" size={22} />
            <h2>Orders</h2>
            <p>No paid and confirmed orders yet.</p>
            <Link to="/account?view=orders">View Orders</Link>
          </article>
          <article>
            <MapPin aria-hidden="true" size={22} />
            <h2>Addresses</h2>
            <p>
              {loaderData.addresses.length} saved delivery address
              {loaderData.addresses.length === 1 ? "" : "es"}.
            </p>
            <Link to="/account?view=addresses">Manage addresses</Link>
          </article>
          <article>
            <CircleUserRound aria-hidden="true" size={22} />
            <h2>Contact profile</h2>
            <p>{profile.fullName || "Name not added"}</p>
            <p>{profile.phoneNumber || "Phone number not added"}</p>
            <Link to="/account?view=profile">Manage profile</Link>
          </article>
          <article>
            <CheckCircle2 aria-hidden="true" size={22} />
            <h2>Verified email</h2>
            <p>{profile.email}</p>
            <Link to="/account/security">Account security</Link>
          </article>
        </div>
      </section>
    );
  } else if (view === "saved-configurations") {
    detail = (
      <SavedConfigurationsDetail
        configurations={loaderData.savedConfigurations}
      />
    );
  } else if (view === "my-quotes") {
    detail = (
      <EmptyDetail
        description="No submitted quote requests yet."
        title="My Quotes"
        to="/"
      />
    );
  } else if (view === "orders") {
    detail = (
      <EmptyDetail
        description="No paid and confirmed orders yet. Quote requests and unpaid PIs do not appear here."
        title="Orders"
      />
    );
  } else if (view === "addresses") {
    detail = (
      <AddressesDetail
        actionData={actionData}
        addresses={loaderData.addresses}
        busy={busy}
        editingAddress={loaderData.editingAddress}
        profileEmail={profile.email}
        saved={loaderData.saved}
      />
    );
  } else {
    detail = (
      <ProfileDetail
        actionData={actionData}
        busy={busy}
        profile={profile}
        purchasingContexts={loaderData.purchasingContexts}
        saved={loaderData.saved}
      />
    );
  }

  return (
    <AccountWorkspace activeView={view}>
      <div className="account-detail-content">{detail}</div>
    </AccountWorkspace>
  );
}
