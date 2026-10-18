import {
  orderFullyCancelledSql,
  orderStageSql,
  shipmentCountSql,
  type CustomerOrderStage,
} from "../../proforma-invoice/application/confirmed-order-service";
import type { AdminQuoteReviewState } from "../../quote-review/domain/admin-quote-review";
import { adminQuoteReviewSelect } from "../../quote-review/infrastructure/d1-admin-quote-review-repository";
import type { CustomerSignInMethod } from "../domain/customer-access";
import type { CustomerDirectoryFilters } from "../domain/customer-directory";

export const customerDirectoryPageSize = 50;

/** Business sections shown only to admins who may also open that module. */
export interface CustomerDirectoryGrants {
  orders: boolean;
  quotes: boolean;
}

// The RFQs each profile in the `page` CTE sees in its Personal Center. This is
// ownedQuoteRequestWhere written as two indexed branches, so a page of
// profiles is counted without scanning every RFQ once per profile.
const ownedRequestsSql = `
  SELECT page.profile_id, request.id AS request_id
  FROM page
  JOIN customer_quote_requests request
    ON request.profile_id=page.profile_id
   AND request.purchasing_context_kind='individual'
  JOIN customer_purchasing_contexts context
    ON context.id=request.purchasing_context_id AND context.kind='individual'
   AND context.individual_profile_id=page.profile_id
  UNION
  SELECT page.profile_id, request.id
  FROM page
  JOIN customer_profile_purchasing_context_access access
    ON access.profile_id=page.profile_id
  JOIN customer_purchasing_contexts context
    ON context.id=access.context_id AND context.kind='organization'
  JOIN customer_organization_memberships membership
    ON membership.organization_id=context.organization_id
   AND membership.profile_id=page.profile_id
   AND membership.role='primary_contact' AND membership.status='active'
  JOIN customer_quote_requests request
    ON request.purchasing_context_id=context.id
   AND request.purchasing_context_kind='organization'`;

const searchSql = `(instr(p.email_normalized,?)>0
  OR instr(lower(coalesce(p.full_name,'')),?)>0
  OR instr(coalesce(p.phone_number,''),?)>0
  OR EXISTS(SELECT 1 FROM customer_organization_memberships m
    JOIN customer_organizations o ON o.id=m.organization_id
    WHERE m.profile_id=p.id AND m.status='active'
      AND (instr(lower(o.legal_name),?)>0
        OR instr(lower(coalesce(o.trade_name,'')),?)>0)))`;

const organizationSql = `EXISTS(SELECT 1 FROM customer_organization_memberships m
  WHERE m.profile_id=p.id AND m.status='active')`;

const firstOrganizationIdSql = `(SELECT m.organization_id
  FROM customer_organization_memberships m
  WHERE m.profile_id=p.id AND m.status='active'
  ORDER BY m.created_at,m.id LIMIT 1)`;

// A company customer's country is its company's; otherwise the default
// delivery address's, else the most recently added address's.
const countrySql = `coalesce(
  (SELECT o.country_code FROM customer_organizations o
    WHERE o.id=${firstOrganizationIdSql}),
  (SELECT a.country_code FROM customer_account_preferences preference
    JOIN customer_delivery_addresses a
      ON a.id=preference.selected_delivery_address_id
    WHERE preference.profile_id=p.id),
  (SELECT a.country_code FROM customer_delivery_addresses a
    WHERE a.profile_id=p.id ORDER BY a.created_at DESC,a.id DESC LIMIT 1))`;

function listFilterSql(
  filters: CustomerDirectoryFilters,
  grants: CustomerDirectoryGrants,
) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  const query = filters.query.toLowerCase();
  if (query) {
    conditions.push(searchSql);
    values.push(query, query, query, query, query);
  }
  if (filters.from) {
    conditions.push("date(p.created_at,'+8 hours')>=?");
    values.push(filters.from);
  }
  if (filters.to) {
    conditions.push("date(p.created_at,'+8 hours')<=?");
    values.push(filters.to);
  }
  if (filters.type !== "all")
    conditions.push(
      filters.type === "organization"
        ? organizationSql
        : `NOT ${organizationSql}`,
    );
  if (filters.country) {
    conditions.push(`${countrySql}=?`);
    values.push(filters.country);
  }
  // Filtering by Orders would reveal them, so it needs the Orders grant.
  const byOrders = grants.orders && filters.orders !== "all";
  if (byOrders)
    conditions.push(
      `p.id ${filters.orders === "with" ? "IN" : "NOT IN"} (SELECT profile_id FROM ordered)`,
    );
  return {
    with: byOrders
      ? `WITH page(profile_id) AS (SELECT id FROM customer_profiles),
          owned AS (${ownedRequestsSql}),
          ordered AS (SELECT owned.profile_id FROM owned
            JOIN confirmed_orders o ON o.request_id=owned.request_id)`
      : "",
    where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    values,
  };
}

interface DirectoryRow {
  id: string;
  email_display: string;
  full_name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  organization_name: string | null;
  organization_count: number;
  country_code: string | null;
}

interface ProfileRow {
  id: string;
  email_display: string;
  email_verified_at: string;
  full_name: string | null;
  phone_number: string | null;
  created_at: string;
  has_password: number;
  registration_ip: string | null;
  registration_country: string | null;
  registration_region: string | null;
  registration_city: string | null;
  last_sign_in_at: string | null;
  last_sign_in_method: CustomerSignInMethod | null;
  last_sign_in_ip: string | null;
  last_sign_in_country: string | null;
  last_sign_in_region: string | null;
  last_sign_in_city: string | null;
}

interface OrganizationRow {
  id: string;
  legal_name: string;
  trade_name: string | null;
  country_code: string;
  registration_or_tax_id: string | null;
  role: string;
  status: "active" | "inactive";
}

interface AddressRow {
  id: string;
  label: string;
  recipient_name: string;
  recipient_email: string;
  recipient_phone: string;
  country_code: string;
  state_province: string;
  city: string;
  postal_code: string;
  address_line_1: string;
  address_line_2: string | null;
  selected: number;
}

interface QuoteRow {
  id: string;
  reference_number: string;
  submitted_at: string;
  review_state: AdminQuoteReviewState;
  purchasing_context_kind: "individual" | "organization";
}

interface OrderRow {
  id: string;
  order_number: string;
  reference_number: string;
  total_cents: number;
  confirmed_at: string;
  held: number;
  stage: CustomerOrderStage;
  fully_cancelled: number;
  cancellation_pending: number;
  shipment_count: number;
  shipped_count: number;
}

function location(
  country: string | null,
  region: string | null,
  city: string | null,
) {
  return { country, region, city };
}

export function createD1AdminCustomerDirectory(db: D1Database) {
  return {
    async list(
      filters: CustomerDirectoryFilters,
      grants: CustomerDirectoryGrants,
    ) {
      const filter = listFilterSql(filters, grants);
      const total =
        (
          await db
            .prepare(
              `${filter.with} SELECT count(*) AS total
               FROM customer_profiles p ${filter.where}`,
            )
            .bind(...filter.values)
            .first<{ total: number }>()
        )?.total ?? 0;
      const pageCount = Math.max(
        1,
        Math.ceil(total / customerDirectoryPageSize),
      );
      const page = Math.min(Math.max(1, filters.page), pageCount);
      const direction = filters.sort === "registered_asc" ? "ASC" : "DESC";
      const rows = (
        await db
          .prepare(
            `${filter.with}
             SELECT p.id,p.email_display,p.full_name,p.created_at,
               access.last_sign_in_at,
               organization.legal_name AS organization_name,
               (SELECT count(*) FROM customer_organization_memberships m
                 WHERE m.profile_id=p.id AND m.status='active') AS organization_count,
               ${countrySql} AS country_code
             FROM customer_profiles p
             LEFT JOIN customer_access_records access ON access.profile_id=p.id
             LEFT JOIN customer_organizations organization
               ON organization.id=${firstOrganizationIdSql}
             ${filter.where}
             ORDER BY p.created_at ${direction},p.id ${direction}
             LIMIT ? OFFSET ?`,
          )
          .bind(
            ...filter.values,
            customerDirectoryPageSize,
            (page - 1) * customerDirectoryPageSize,
          )
          .all<DirectoryRow>()
      ).results;
      const countries = (
        await db
          .prepare(
            `SELECT DISTINCT code FROM (
               SELECT ${countrySql} AS code FROM customer_profiles p)
             WHERE code IS NOT NULL ORDER BY code`,
          )
          .all<{ code: string }>()
      ).results.map((row) => row.code);
      const columns = [
        grants.quotes ? "count(*) AS quote_count" : null,
        grants.orders
          ? `coalesce(sum(CASE WHEN o.id IS NOT NULL AND NOT ${orderFullyCancelledSql}
               THEN o.total_cents END),0) AS confirmed_cents`
          : null,
      ].filter(Boolean);
      const stats = new Map<
        string,
        { quote_count?: number; confirmed_cents?: number }
      >();
      if (rows.length && columns.length) {
        const result = await db
          .prepare(
            `WITH page(profile_id) AS (SELECT value FROM json_each(?1)),
               owned AS (${ownedRequestsSql})
             SELECT owned.profile_id,${columns.join(",")}
             FROM owned ${grants.orders ? "LEFT JOIN confirmed_orders o ON o.request_id=owned.request_id" : ""}
             GROUP BY owned.profile_id`,
          )
          .bind(JSON.stringify(rows.map((row) => row.id)))
          .all<{
            profile_id: string;
            quote_count?: number;
            confirmed_cents?: number;
          }>();
        for (const row of result.results) stats.set(row.profile_id, row);
      }
      return {
        page,
        pageCount,
        total,
        countries,
        records: rows.map((row) => ({
          id: row.id,
          email: row.email_display,
          fullName: row.full_name,
          organizationName: row.organization_name,
          organizationCount: row.organization_count,
          countryCode: row.country_code,
          registeredAt: row.created_at,
          lastSignInAt: row.last_sign_in_at,
          quoteCount: grants.quotes
            ? (stats.get(row.id)?.quote_count ?? 0)
            : null,
          confirmedCents: grants.orders
            ? (stats.get(row.id)?.confirmed_cents ?? 0)
            : null,
        })),
      };
    },

    async read(profileId: string, grants: CustomerDirectoryGrants) {
      const owned = `WITH page(profile_id) AS (VALUES(?1)),
        owned AS (${ownedRequestsSql})`;
      const [profiles, organizations, addresses] = await db.batch([
        db
          .prepare(
            `SELECT p.id,p.email_display,p.email_verified_at,p.full_name,
               p.phone_number,p.created_at,
               EXISTS(SELECT 1 FROM customer_password_credentials c
                 WHERE c.profile_id=p.id) AS has_password,
               access.registration_ip,access.registration_country,
               access.registration_region,access.registration_city,
               access.last_sign_in_at,access.last_sign_in_method,
               access.last_sign_in_ip,access.last_sign_in_country,
               access.last_sign_in_region,access.last_sign_in_city
             FROM customer_profiles p
             LEFT JOIN customer_access_records access ON access.profile_id=p.id
             WHERE p.id=?1`,
          )
          .bind(profileId),
        db
          .prepare(
            `SELECT o.id,o.legal_name,o.trade_name,o.country_code,
               o.registration_or_tax_id,m.role,m.status
             FROM customer_organization_memberships m
             JOIN customer_organizations o ON o.id=m.organization_id
             WHERE m.profile_id=?1
             ORDER BY m.status='active' DESC,m.created_at,m.id`,
          )
          .bind(profileId),
        db
          .prepare(
            `SELECT a.id,a.label,a.recipient_name,a.recipient_email,
               a.recipient_phone,a.country_code,a.state_province,a.city,
               a.postal_code,a.address_line_1,a.address_line_2,
               coalesce(a.id=preference.selected_delivery_address_id,0) AS selected
             FROM customer_delivery_addresses a
             LEFT JOIN customer_account_preferences preference
               ON preference.profile_id=a.profile_id
             WHERE a.profile_id=?1
             ORDER BY a.created_at DESC,a.id DESC`,
          )
          .bind(profileId),
      ]);
      const profile = profiles.results[0] as ProfileRow | undefined;
      if (!profile) return null;
      const quotes = grants.quotes
        ? (
            await db
              .prepare(
                `${owned}
                 SELECT review.id,review.reference_number,review.submitted_at,
                   review.review_state,request.purchasing_context_kind
                 FROM (${adminQuoteReviewSelect}) review
                 JOIN customer_quote_requests request ON request.id=review.id
                 WHERE review.id IN (SELECT request_id FROM owned)
                 ORDER BY review.submitted_at DESC,review.id DESC LIMIT 200`,
              )
              .bind(profileId)
              .all<QuoteRow>()
          ).results
        : null;
      const orders = grants.orders
        ? (
            await db
              .prepare(
                `${owned}
                 SELECT o.id,o.order_number,request.reference_number,
                   o.total_cents,o.confirmed_at,coalesce(guard.held,0) AS held,
                   ${orderStageSql} AS stage,
                   ${orderFullyCancelledSql} AS fully_cancelled,
                   EXISTS(SELECT 1 FROM order_cancellation_requests cancellation
                     WHERE cancellation.order_id=o.id
                       AND cancellation.status='pending_review') AS cancellation_pending,
                   ${shipmentCountSql()} AS shipment_count,
                   ${shipmentCountSql("shipment.status IN ('shipped','delivered')")} AS shipped_count
                 FROM owned
                 JOIN confirmed_orders o ON o.request_id=owned.request_id
                 JOIN customer_quote_requests request ON request.id=o.request_id
                 LEFT JOIN order_release_guards guard ON guard.order_id=o.id
                 ORDER BY o.confirmed_at DESC,o.id DESC LIMIT 200`,
              )
              .bind(profileId)
              .all<OrderRow>()
          ).results.map((row) => ({
            id: row.id,
            orderNumber: row.order_number,
            referenceNumber: row.reference_number,
            totalCents: row.total_cents,
            confirmedAt: row.confirmed_at,
            held: row.held === 1,
            stage: row.stage,
            fullyCancelled: row.fully_cancelled === 1,
            cancellationPending: row.cancellation_pending === 1,
            shipmentCount: row.shipment_count,
            shippedCount: row.shipped_count,
          }))
        : null;
      return {
        id: profile.id,
        email: profile.email_display,
        emailVerifiedAt: profile.email_verified_at,
        fullName: profile.full_name,
        phoneNumber: profile.phone_number,
        registeredAt: profile.created_at,
        hasPassword: profile.has_password === 1,
        registration: {
          ip: profile.registration_ip,
          location: location(
            profile.registration_country,
            profile.registration_region,
            profile.registration_city,
          ),
        },
        lastSignIn: {
          at: profile.last_sign_in_at,
          method: profile.last_sign_in_method,
          ip: profile.last_sign_in_ip,
          location: location(
            profile.last_sign_in_country,
            profile.last_sign_in_region,
            profile.last_sign_in_city,
          ),
        },
        organizations: (organizations.results as OrganizationRow[]).map(
          (row) => ({
            id: row.id,
            legalName: row.legal_name,
            tradeName: row.trade_name,
            countryCode: row.country_code,
            registrationOrTaxId: row.registration_or_tax_id,
            primaryContact: row.role === "primary_contact",
            active: row.status === "active",
          }),
        ),
        addresses: (addresses.results as AddressRow[]).map((row) => ({
          id: row.id,
          label: row.label,
          recipientName: row.recipient_name,
          recipientEmail: row.recipient_email,
          recipientPhone: row.recipient_phone,
          countryCode: row.country_code,
          stateProvince: row.state_province,
          city: row.city,
          postalCode: row.postal_code,
          addressLine1: row.address_line_1,
          addressLine2: row.address_line_2,
          selected: row.selected === 1,
        })),
        quotes:
          quotes?.map((row) => ({
            id: row.id,
            referenceNumber: row.reference_number,
            submittedAt: row.submitted_at,
            reviewState: row.review_state,
            organization: row.purchasing_context_kind === "organization",
          })) ?? null,
        // Delivered and fully cancelled Orders are history; the rest are current.
        currentOrders:
          orders?.filter(
            (order) => order.stage !== "delivered" && !order.fullyCancelled,
          ) ?? null,
        historicalOrders:
          orders?.filter(
            (order) => order.stage === "delivered" || order.fullyCancelled,
          ) ?? null,
      };
    },
  };
}
