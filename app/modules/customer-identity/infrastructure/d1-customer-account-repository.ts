import type {
  DeliveryAddress,
  DeliveryAddressDraft,
  OrganizationDraft,
  PurchasingContext,
} from "../domain/customer-account";

interface DeliveryAddressRow {
  address_line_1: string;
  address_line_2: string | null;
  city: string;
  country_code: string;
  id: string;
  is_selected: number;
  label: string;
  postal_code: string;
  recipient_email: string;
  recipient_name: string;
  recipient_phone: string;
  state_province: string;
}

interface PurchasingContextRow {
  country_code: string | null;
  id: string;
  is_selected: number;
  kind: "individual" | "organization";
  legal_name: string | null;
  primary_contact_email: string;
  primary_contact_name: string | null;
  registration_or_tax_id: string | null;
  trade_name: string | null;
}

function deliveryAddress(row: DeliveryAddressRow): DeliveryAddress {
  return {
    addressLine1: row.address_line_1,
    addressLine2: row.address_line_2 ?? "",
    city: row.city,
    countryCode: row.country_code,
    id: row.id,
    isSelected: row.is_selected === 1,
    label: row.label,
    postalCode: row.postal_code,
    recipientEmail: row.recipient_email,
    recipientName: row.recipient_name,
    recipientPhone: row.recipient_phone,
    stateProvince: row.state_province,
  };
}

function purchasingContext(row: PurchasingContextRow): PurchasingContext {
  return {
    countryCode: row.country_code,
    id: row.id,
    isSelected: row.is_selected === 1,
    kind: row.kind,
    legalName: row.legal_name,
    primaryContactEmail: row.primary_contact_email,
    primaryContactName: row.primary_contact_name ?? row.primary_contact_email,
    registrationOrTaxId: row.registration_or_tax_id,
    tradeName: row.trade_name,
  };
}

export function createD1CustomerAccountRepository(database: D1Database) {
  return {
    async ensureIndividualContext(input: {
      contextId: string;
      now: string;
      profileId: string;
    }) {
      await database.batch([
        database
          .prepare(
            `INSERT INTO customer_purchasing_contexts
               (id, kind, individual_profile_id, organization_id,
                created_at, updated_at)
             SELECT ?, 'individual', id, NULL, ?, ?
             FROM customer_profiles WHERE id = ?
             ON CONFLICT(individual_profile_id) WHERE kind = 'individual'
             DO NOTHING`,
          )
          .bind(input.contextId, input.now, input.now, input.profileId),
        database
          .prepare(
            `INSERT INTO customer_profile_purchasing_context_access
               (profile_id, context_id, created_at)
             SELECT p.id, c.id, ?
             FROM customer_profiles p
             INNER JOIN customer_purchasing_contexts c
               ON c.individual_profile_id = p.id AND c.kind = 'individual'
             WHERE p.id = ?
             ON CONFLICT(profile_id, context_id) DO NOTHING`,
          )
          .bind(input.now, input.profileId),
        database
          .prepare(
            `INSERT INTO customer_account_preferences
               (profile_id, selected_delivery_address_id,
                selected_purchasing_context_id, updated_at)
             SELECT p.id, NULL, c.id, ?
             FROM customer_profiles p
             INNER JOIN customer_purchasing_contexts c
               ON c.individual_profile_id = p.id AND c.kind = 'individual'
             WHERE p.id = ?
             ON CONFLICT(profile_id) DO NOTHING`,
          )
          .bind(input.now, input.profileId),
      ]);
    },

    async listDeliveryAddresses(profileId: string) {
      const rows = await database
        .prepare(
          `SELECT a.id, a.label, a.recipient_name, a.recipient_email,
                  a.recipient_phone, a.country_code, a.state_province,
                  a.city, a.postal_code, a.address_line_1, a.address_line_2,
                  CASE WHEN pref.selected_delivery_address_id = a.id
                    THEN 1 ELSE 0 END AS is_selected
           FROM customer_delivery_addresses a
           LEFT JOIN customer_account_preferences pref
             ON pref.profile_id = a.profile_id
           WHERE a.profile_id = ?
           ORDER BY is_selected DESC, a.created_at, a.id`,
        )
        .bind(profileId)
        .all<DeliveryAddressRow>();
      return rows.results.map(deliveryAddress);
    },

    async listPurchasingContexts(profileId: string) {
      const rows = await database
        .prepare(
          `SELECT c.id, c.kind, NULL AS legal_name, NULL AS trade_name,
                  NULL AS country_code, NULL AS registration_or_tax_id,
                  p.email_display AS primary_contact_email,
                  p.full_name AS primary_contact_name,
                  CASE WHEN pref.selected_purchasing_context_id = c.id
                    THEN 1 ELSE 0 END AS is_selected
           FROM customer_purchasing_contexts c
           INNER JOIN customer_profiles p ON p.id = c.individual_profile_id
           LEFT JOIN customer_account_preferences pref
             ON pref.profile_id = p.id
           WHERE c.kind = 'individual' AND c.individual_profile_id = ?
           UNION ALL
           SELECT c.id, c.kind, o.legal_name, o.trade_name, o.country_code,
                  o.registration_or_tax_id,
                  contact.email_display AS primary_contact_email,
                  contact.full_name AS primary_contact_name,
                  CASE WHEN pref.selected_purchasing_context_id = c.id
                    THEN 1 ELSE 0 END AS is_selected
           FROM customer_purchasing_contexts c
           INNER JOIN customer_organizations o ON o.id = c.organization_id
           INNER JOIN customer_profile_purchasing_context_access access
             ON access.context_id = c.id AND access.profile_id = ?
           INNER JOIN customer_organization_memberships member_access
             ON member_access.organization_id = o.id
                AND member_access.profile_id = access.profile_id
                AND member_access.status = 'active'
           INNER JOIN customer_organization_memberships primary_member
             ON primary_member.organization_id = o.id
                AND primary_member.role = 'primary_contact'
                AND primary_member.status = 'active'
           INNER JOIN customer_profiles contact
             ON contact.id = primary_member.profile_id
           LEFT JOIN customer_account_preferences pref
             ON pref.profile_id = access.profile_id
           WHERE c.kind = 'organization'
           ORDER BY kind, legal_name`,
        )
        .bind(profileId, profileId)
        .all<PurchasingContextRow>();
      return rows.results.map(purchasingContext);
    },

    async createDeliveryAddress(
      input: DeliveryAddressDraft & {
        id: string;
        now: string;
        profileId: string;
      },
    ) {
      const results = await database.batch([
        database
          .prepare(
            `INSERT INTO customer_delivery_addresses
               (id, profile_id, label, recipient_name, recipient_email,
                recipient_phone, country_code, state_province, city,
                postal_code, address_line_1, address_line_2,
                created_at, updated_at)
             SELECT ?, id, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), ?, ?
             FROM customer_profiles WHERE id = ?`,
          )
          .bind(
            input.id,
            input.label,
            input.recipientName,
            input.recipientEmail,
            input.recipientPhone,
            input.countryCode,
            input.stateProvince,
            input.city,
            input.postalCode,
            input.addressLine1,
            input.addressLine2,
            input.now,
            input.now,
            input.profileId,
          ),
        database
          .prepare(
            `UPDATE customer_account_preferences
             SET selected_delivery_address_id = COALESCE(
                   selected_delivery_address_id, ?
                 ), updated_at = ?
             WHERE profile_id = ?`,
          )
          .bind(input.id, input.now, input.profileId),
      ]);
      return (results[0]?.meta.changes ?? 0) === 1;
    },

    async updateDeliveryAddress(
      input: DeliveryAddressDraft & {
        id: string;
        now: string;
        profileId: string;
      },
    ) {
      const result = await database
        .prepare(
          `UPDATE customer_delivery_addresses
           SET label = ?, recipient_name = ?, recipient_email = ?,
               recipient_phone = ?, country_code = ?, state_province = ?,
               city = ?, postal_code = ?, address_line_1 = ?,
               address_line_2 = NULLIF(?, ''), updated_at = ?
           WHERE id = ? AND profile_id = ?`,
        )
        .bind(
          input.label,
          input.recipientName,
          input.recipientEmail,
          input.recipientPhone,
          input.countryCode,
          input.stateProvince,
          input.city,
          input.postalCode,
          input.addressLine1,
          input.addressLine2,
          input.now,
          input.id,
          input.profileId,
        )
        .run();
      return (result.meta.changes ?? 0) === 1;
    },

    async selectDeliveryAddress(input: {
      addressId: string;
      now: string;
      profileId: string;
    }) {
      const result = await database
        .prepare(
          `UPDATE customer_account_preferences
           SET selected_delivery_address_id = ?, updated_at = ?
           WHERE profile_id = ? AND EXISTS (
             SELECT 1 FROM customer_delivery_addresses
             WHERE id = ? AND profile_id = ?
           )`,
        )
        .bind(
          input.addressId,
          input.now,
          input.profileId,
          input.addressId,
          input.profileId,
        )
        .run();
      return (result.meta.changes ?? 0) === 1;
    },

    async deleteDeliveryAddress(input: {
      addressId: string;
      profileId: string;
    }) {
      const results = await database.batch([
        database
          .prepare(
            `UPDATE customer_account_preferences
             SET selected_delivery_address_id = NULL
             WHERE profile_id = ? AND selected_delivery_address_id = ?`,
          )
          .bind(input.profileId, input.addressId),
        database
          .prepare(
            `DELETE FROM customer_delivery_addresses
             WHERE id = ? AND profile_id = ?`,
          )
          .bind(input.addressId, input.profileId),
      ]);
      return (results[1]?.meta.changes ?? 0) === 1;
    },

    async createOrganizationContext(
      input: OrganizationDraft & {
        contextId: string;
        membershipId: string;
        now: string;
        organizationId: string;
        profileId: string;
      },
    ) {
      const results = await database.batch([
        database
          .prepare(
            `INSERT INTO customer_organizations
               (id, legal_name, trade_name, country_code,
                registration_or_tax_id, created_at, updated_at)
             SELECT ?, ?, NULLIF(?, ''), ?, NULLIF(?, ''), ?, ?
             FROM customer_profiles WHERE id = ?`,
          )
          .bind(
            input.organizationId,
            input.legalName,
            input.tradeName,
            input.countryCode,
            input.registrationOrTaxId,
            input.now,
            input.now,
            input.profileId,
          ),
        database
          .prepare(
            `INSERT INTO customer_organization_memberships
               (id, organization_id, profile_id, role, status, created_at)
             SELECT ?, ?, id, 'primary_contact', 'active', ?
             FROM customer_profiles WHERE id = ? AND EXISTS (
               SELECT 1 FROM customer_organizations WHERE id = ?
             )`,
          )
          .bind(
            input.membershipId,
            input.organizationId,
            input.now,
            input.profileId,
            input.organizationId,
          ),
        database
          .prepare(
            `INSERT INTO customer_purchasing_contexts
               (id, kind, individual_profile_id, organization_id,
                created_at, updated_at)
             SELECT ?, 'organization', NULL, id, ?, ?
             FROM customer_organizations WHERE id = ? AND EXISTS (
               SELECT 1 FROM customer_organization_memberships
               WHERE organization_id = ? AND profile_id = ?
                 AND role = 'primary_contact' AND status = 'active'
             )`,
          )
          .bind(
            input.contextId,
            input.now,
            input.now,
            input.organizationId,
            input.organizationId,
            input.profileId,
          ),
        database
          .prepare(
            `INSERT INTO customer_profile_purchasing_context_access
               (profile_id, context_id, created_at)
             SELECT ?, c.id, ?
             FROM customer_purchasing_contexts c
             INNER JOIN customer_organization_memberships m
               ON m.organization_id = c.organization_id
             WHERE c.id = ? AND m.profile_id = ? AND m.status = 'active'`,
          )
          .bind(input.profileId, input.now, input.contextId, input.profileId),
        database
          .prepare(
            `UPDATE customer_account_preferences
             SET selected_purchasing_context_id = ?, updated_at = ?
             WHERE profile_id = ? AND EXISTS (
               SELECT 1 FROM customer_profile_purchasing_context_access
               WHERE profile_id = ? AND context_id = ?
             )`,
          )
          .bind(
            input.contextId,
            input.now,
            input.profileId,
            input.profileId,
            input.contextId,
          ),
      ]);
      return results.every((result) => (result.meta.changes ?? 0) === 1);
    },

    async selectPurchasingContext(input: {
      contextId: string;
      now: string;
      profileId: string;
    }) {
      const result = await database
        .prepare(
          `UPDATE customer_account_preferences
           SET selected_purchasing_context_id = ?, updated_at = ?
           WHERE profile_id = ? AND EXISTS (
             SELECT 1 FROM customer_profile_purchasing_context_access access
             INNER JOIN customer_purchasing_contexts c
               ON c.id = access.context_id
             WHERE access.profile_id = ? AND access.context_id = ? AND (
               (c.kind = 'individual' AND c.individual_profile_id = ?) OR
               (c.kind = 'organization' AND EXISTS (
                 SELECT 1 FROM customer_organization_memberships m
                 WHERE m.organization_id = c.organization_id
                   AND m.profile_id = ? AND m.status = 'active'
               ))
             )
           )`,
        )
        .bind(
          input.contextId,
          input.now,
          input.profileId,
          input.profileId,
          input.contextId,
          input.profileId,
          input.profileId,
        )
        .run();
      return (result.meta.changes ?? 0) === 1;
    },
  };
}
