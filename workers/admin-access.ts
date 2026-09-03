import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";

import {
  findActiveAdminIdentityByEmail,
  type ActiveAdminIdentityRecord,
} from "../app/modules/admin/infrastructure/d1-admin-identity-repository";

export interface AdminAccessBindings {
  ADMIN_AUTH_MODE: "cloudflare-access" | "local-stub";
  ADMIN_ORIGIN: string;
  APP_ENV: "local" | "preview" | "production";
  CLOUDFLARE_ACCESS_AUD: string;
  CLOUDFLARE_ACCESS_TEAM_DOMAIN: string;
  DB: D1Database;
}

export interface AdminIdentity {
  accountType: "owner" | "subaccount";
  canManageSubaccounts: boolean;
  email: string;
  id: string;
  source: "cloudflare-access" | "local-development";
}

interface CloudflareAccessClaims extends JWTPayload {
  email?: string;
}

interface AccessJwtSettings {
  audience: string;
  teamDomain: string;
}

interface AdminAuthorizationDependencies {
  findIdentityByEmail?: typeof findActiveAdminIdentityByEmail;
  verifyJwt?: typeof verifyCloudflareAccessJwt;
}

const remoteKeySets = new Map<string, JWTVerifyGetKey>();

export class AdminAccessDenied extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message);
    this.name = "AdminAccessDenied";
  }
}

export function isAdminPath(pathname: string) {
  return (
    pathname === "/admin" ||
    pathname === "/admin.data" ||
    pathname.startsWith("/admin/")
  );
}

function normalizedTeamDomain(teamDomain: string) {
  return teamDomain.replace(/\/$/, "");
}

function remoteKeySet(teamDomain: string) {
  const issuer = normalizedTeamDomain(teamDomain);
  let keySet = remoteKeySets.get(issuer);
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    remoteKeySets.set(issuer, keySet);
  }
  return keySet;
}

export async function verifyCloudflareAccessJwt(
  assertion: string,
  settings: AccessJwtSettings,
  keySet: JWTVerifyGetKey = remoteKeySet(settings.teamDomain),
) {
  const issuer = normalizedTeamDomain(settings.teamDomain);
  const { payload } = await jwtVerify<CloudflareAccessClaims>(
    assertion,
    keySet,
    {
      audience: settings.audience,
      issuer,
    },
  );
  return payload;
}

async function deployedIdentity(
  claims: CloudflareAccessClaims,
  bindings: AdminAccessBindings,
  findIdentityByEmail: typeof findActiveAdminIdentityByEmail,
): Promise<AdminIdentity> {
  const email = claims.email?.trim().toLowerCase();
  if (!email || !claims.sub) {
    throw new AdminAccessDenied("Access identity is incomplete", 403);
  }

  const identity: ActiveAdminIdentityRecord | null = await findIdentityByEmail(
    bindings.DB,
    email,
  );
  if (!identity)
    throw new AdminAccessDenied(
      "Access identity is not an active Admin account",
      403,
    );

  return { ...identity, source: "cloudflare-access" };
}

export async function authorizeAdminRequest(
  request: Request,
  bindings: AdminAccessBindings,
  dependencies: AdminAuthorizationDependencies = {},
): Promise<AdminIdentity> {
  if (bindings.APP_ENV === "local") {
    if (bindings.ADMIN_AUTH_MODE !== "local-stub") {
      throw new AdminAccessDenied(
        "Local Admin authentication is misconfigured",
        403,
      );
    }
    return {
      accountType: "owner",
      canManageSubaccounts: true,
      email: "owner@local.invalid",
      id: "local-owner",
      source: "local-development",
    };
  }

  if (bindings.ADMIN_AUTH_MODE !== "cloudflare-access") {
    throw new AdminAccessDenied("Cloudflare Access is required", 403);
  }
  if (new URL(request.url).origin !== bindings.ADMIN_ORIGIN) {
    throw new AdminAccessDenied("Admin routes require the Admin origin", 403);
  }
  const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!assertion)
    throw new AdminAccessDenied("Cloudflare Access assertion is missing", 401);

  let claims: CloudflareAccessClaims;
  try {
    const verifyJwt = dependencies.verifyJwt ?? verifyCloudflareAccessJwt;
    claims = await verifyJwt(assertion, {
      audience: bindings.CLOUDFLARE_ACCESS_AUD,
      teamDomain: bindings.CLOUDFLARE_ACCESS_TEAM_DOMAIN,
    });
  } catch (error) {
    if (error instanceof AdminAccessDenied) throw error;
    throw new AdminAccessDenied("Cloudflare Access assertion is invalid", 403);
  }

  const findIdentityByEmail =
    dependencies.findIdentityByEmail ?? findActiveAdminIdentityByEmail;
  return deployedIdentity(claims, bindings, findIdentityByEmail);
}

export function adminAccessDeniedResponse(error: AdminAccessDenied) {
  return Response.json(
    { error: "admin_access_denied", status: error.status },
    {
      headers: { "Cache-Control": "no-store" },
      status: error.status,
    },
  );
}
