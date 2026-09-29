import { AdminIdentityContext } from "./modules/admin/ui/admin-identity-context";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
} from "react-router";

import type { Route } from "./+types/root";
import { createCustomerIdentityService } from "./modules/customer-identity/application/customer-identity-service";
import { createD1MessageCenter } from "./modules/message-center/infrastructure/d1-message-center";
import "./styles/app.css";
import { cloudflareContext } from "#workers/context";

export interface RootLoaderData {
  admin?: import("#workers/admin-access").AdminIdentity;
  customer: {
    email: string;
    id: string;
    unreadMessages?: number;
  } | null;
}

export async function loader({
  context,
  request,
}: Route.LoaderArgs): Promise<RootLoaderData> {
  const { env, adminIdentity } = context.get(cloudflareContext);
  const profile = await createCustomerIdentityService(env).readSession(request);
  // Advisory badge only: a read failure must never block the storefront.
  const unreadMessages = profile
    ? await createD1MessageCenter(env.DB)
        .customerUnread(profile.id)
        .catch(() => 0)
    : 0;

  return {
    admin: adminIdentity,
    customer: profile
      ? { email: profile.email, id: profile.id, unreadMessages }
      : null,
  };
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App({ loaderData }: Route.ComponentProps) {
  return (
    <AdminIdentityContext value={loaderData.admin}>
      <Outlet />
    </AdminIdentityContext>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const message = notFound ? "Page not found" : "Something went wrong";

  return (
    <main className="error-page">
      <span className="eyebrow">{notFound ? "404" : "Error"}</span>
      <h1>{message}</h1>
      <p>The requested surface is not available.</p>
      <a className="button button-primary" href="/">
        Return to catalog
      </a>
    </main>
  );
}
