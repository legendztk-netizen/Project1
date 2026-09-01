import { CheckCircle2, CircleUserRound } from "lucide-react";
import { data, Form, Link, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/customer-account";
import { cloudflareContext } from "#workers/context";
import {
  createCustomerProfileService,
  CustomerProfileValidationError,
} from "../application/customer-profile-service";
import { requireTrustedAuthPost } from "../application/trusted-auth-request";
import {
  AccountDetailNavigation,
  isAccountDetailView,
  type AccountDetailView,
} from "../ui/account-detail-navigation";
import { AccountWorkspace } from "../ui/account-workspace";

function selectedView(request: Request): AccountDetailView {
  const requested = new URL(request.url).searchParams.get("view");
  return isAccountDetailView(requested) ? requested : "overview";
}

function text(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export function meta() {
  return [{ title: "Account & Lists | Hydraulic Supply" }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const profile = await createCustomerProfileService(env).read(request);
  if (!profile) {
    const url = new URL(request.url);
    const returnTo = encodeURIComponent(`${url.pathname}${url.search}`);
    throw redirect(`/sign-in?returnTo=${returnTo}`);
  }
  return {
    profile,
    saved: new URL(request.url).searchParams.get("saved") === "1",
    view: selectedView(request),
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
  try {
    const profile = await createCustomerProfileService(env).updateContact({
      fullName: text(form, "fullName"),
      phoneNumber: text(form, "phoneNumber"),
      request,
    });
    if (!profile) {
      throw redirect("/sign-in?returnTo=%2Faccount%3Fview%3Dprofile");
    }
    return redirect("/account?view=profile&saved=1");
  } catch (error) {
    if (!(error instanceof CustomerProfileValidationError)) throw error;
    return data({ error: error.message }, { status: 422 });
  }
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
      <EmptyDetail
        description={
          profile.savedConfigurationCount === 0
            ? "No saved hose configurations yet."
            : `${profile.savedConfigurationCount} saved hose configuration${
                profile.savedConfigurationCount === 1 ? "" : "s"
              } in your account.`
        }
        title="Saved Configurations"
        to={profile.savedConfigurationCount === 0 ? "/build-a-hose" : undefined}
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
      <EmptyDetail
        description="No reusable delivery addresses yet."
        title="Addresses"
      />
    );
  } else {
    detail = (
      <section className="account-profile-detail">
        <span className="eyebrow">Customer profile</span>
        <h1>Profile / Company</h1>
        <p className="account-detail-intro">
          Keep your contact details current. Company and purchasing details are
          collected separately when needed for a quote.
        </p>
        {loaderData.saved ? (
          <div className="customer-auth-success" role="status">
            Contact profile saved.
          </div>
        ) : null}
        {actionData?.error ? (
          <div className="customer-auth-error" role="alert">
            {actionData.error}
          </div>
        ) : null}
        <Form className="customer-auth-form account-profile-form" method="post">
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
    );
  }

  return (
    <AccountWorkspace activeSection={null}>
      <div className="account-detail-shell">
        <AccountDetailNavigation activeView={view} />
        <div className="account-detail-content">{detail}</div>
      </div>
    </AccountWorkspace>
  );
}
