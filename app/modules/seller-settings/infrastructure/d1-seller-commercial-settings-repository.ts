import {
  RETURN_LOCATION_PURPOSE,
  SELLER_LEGAL_NAME,
  type PaymentChannel,
  type PaymentInstructionVersion,
  type SellerIdentityVersion,
  type SellerReturnLocation,
} from "../domain/seller-commercial-settings";

interface SellerIdentityRow {
  created_at: string;
  created_by: string;
  id: string;
  legal_name: typeof SELLER_LEGAL_NAME;
  registered_address_en: string | null;
  registered_country_code: "CN";
  status: "current" | "superseded";
  superseded_at: string | null;
  version: number;
}

interface PaymentInstructionRow {
  channel: PaymentChannel;
  created_at: string;
  created_by: string;
  id: string;
  instructions: string;
  status: "current" | "superseded";
  superseded_at: string | null;
  version: number;
}

function sellerIdentity(row: SellerIdentityRow): SellerIdentityVersion {
  return {
    createdAt: row.created_at,
    createdBy: row.created_by,
    id: row.id,
    legalName: row.legal_name,
    registeredAddressEn: row.registered_address_en,
    registeredCountryCode: row.registered_country_code,
    status: row.status,
    supersededAt: row.superseded_at,
    version: row.version,
  };
}

function paymentInstruction(
  row: PaymentInstructionRow,
): PaymentInstructionVersion {
  return {
    channel: row.channel,
    createdAt: row.created_at,
    createdBy: row.created_by,
    id: row.id,
    instructions: row.instructions,
    status: row.status,
    supersededAt: row.superseded_at,
    version: row.version,
  };
}

export function createD1SellerCommercialSettingsRepository(
  database: D1Database,
) {
  async function currentSellerIdentity() {
    const row = await database
      .prepare(
        `SELECT id, version, legal_name, registered_address_en,
                registered_country_code, status, created_by, created_at, superseded_at
         FROM seller_identity_versions WHERE status = 'current' LIMIT 1`,
      )
      .first<SellerIdentityRow>();
    return row ? sellerIdentity(row) : null;
  }

  async function sellerIdentityByCommand(commandId: string) {
    return database
      .prepare(`SELECT id FROM seller_identity_versions WHERE command_id = ?`)
      .bind(commandId)
      .first<{ id: string }>();
  }

  async function paymentInstructionByCommand(commandId: string) {
    return database
      .prepare(
        `SELECT id FROM seller_payment_instruction_versions WHERE command_id = ?`,
      )
      .bind(commandId)
      .first<{ id: string }>();
  }

  async function paymentInstructionHistory() {
    const rows = await database
      .prepare(
        `SELECT id, channel, version, instructions, status,
                created_by, created_at, superseded_at
         FROM seller_payment_instruction_versions
         ORDER BY channel, version DESC`,
      )
      .all<PaymentInstructionRow>();
    return rows.results.map(paymentInstruction);
  }

  async function returnLocationCommand(commandId: string) {
    return database
      .prepare(
        `SELECT location_id
         FROM seller_return_location_commands WHERE command_id = ?`,
      )
      .bind(commandId)
      .first<{ location_id: string }>();
  }

  return {
    async findSnapshot() {
      const [identity, identityHistory, payments, returnLocations] =
        await Promise.all([
          currentSellerIdentity(),
          database
            .prepare(
              `SELECT id, version, legal_name, registered_address_en,
                      registered_country_code, status, created_by, created_at, superseded_at
               FROM seller_identity_versions ORDER BY version DESC`,
            )
            .all<SellerIdentityRow>(),
          paymentInstructionHistory(),
          database
            .prepare(
              `SELECT id, label, address, phone, purpose
               FROM seller_return_locations ORDER BY label`,
            )
            .all<SellerReturnLocation>(),
        ]);
      return {
        identity,
        identityHistory: identityHistory.results.map(sellerIdentity),
        payments,
        returnLocations: returnLocations.results,
      };
    },

    async saveSellerIdentity(input: {
      actorId: string;
      address: string;
      commandId: string;
      id: string;
      now: string;
    }) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const existing = await sellerIdentityByCommand(input.commandId);
        if (existing) return existing.id;
        const current = await currentSellerIdentity();
        if (!current) throw new Error("Current seller identity was not found");
        const nextVersion = current.version + 1;
        try {
          await database.batch([
            database
              .prepare(
                `UPDATE seller_identity_versions
                 SET status = 'superseded', superseded_at = ?
                 WHERE id = ? AND status = 'current'`,
              )
              .bind(input.now, current.id),
            database
              .prepare(
                `INSERT INTO seller_identity_versions (
                   id, version, legal_name, registered_address_en,
                   registered_country_code, status, command_id, created_by, created_at
                 ) VALUES (?, ?, ?, ?, 'CN', 'current', ?, ?, ?)`,
              )
              .bind(
                input.id,
                nextVersion,
                SELLER_LEGAL_NAME,
                input.address,
                input.commandId,
                input.actorId,
                input.now,
              ),
            database
              .prepare(
                `INSERT INTO admin_audit_events (
                   id, event_type, entity_type, entity_id, actor_id, payload_json, occurred_at
                 ) VALUES (?, 'seller_identity.version_created',
                           'seller_identity_version', ?, ?, ?, ?)`,
              )
              .bind(
                `seller-identity:${input.commandId}`,
                input.id,
                input.actorId,
                JSON.stringify({
                  countryCode: "CN",
                  legalName: SELLER_LEGAL_NAME,
                  supersededId: current.id,
                  supersededVersion: current.version,
                  version: nextVersion,
                }),
                input.now,
              ),
          ]);
          return input.id;
        } catch (error) {
          const completed = await sellerIdentityByCommand(input.commandId);
          if (completed) return completed.id;
          if (attempt === 2) throw error;
        }
      }
      throw new Error("Seller identity version was not saved");
    },

    async savePaymentInstructions(input: {
      actorId: string;
      channel: PaymentChannel;
      commandId: string;
      id: string;
      instructions: string;
      now: string;
    }) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const existing = await paymentInstructionByCommand(input.commandId);
        if (existing) return existing.id;
        const current = await database
          .prepare(
            `SELECT id, version FROM seller_payment_instruction_versions
             WHERE channel = ? AND status = 'current' LIMIT 1`,
          )
          .bind(input.channel)
          .first<{ id: string; version: number }>();
        const nextVersion = (current?.version ?? 0) + 1;
        const statements = [];
        if (current) {
          statements.push(
            database
              .prepare(
                `UPDATE seller_payment_instruction_versions
                 SET status = 'superseded', superseded_at = ?
                 WHERE id = ? AND status = 'current'`,
              )
              .bind(input.now, current.id),
          );
        }
        statements.push(
          database
            .prepare(
              `INSERT INTO seller_payment_instruction_versions (
                 id, channel, version, instructions, status,
                 command_id, created_by, created_at
               ) VALUES (?, ?, ?, ?, 'current', ?, ?, ?)`,
            )
            .bind(
              input.id,
              input.channel,
              nextVersion,
              input.instructions,
              input.commandId,
              input.actorId,
              input.now,
            ),
          database
            .prepare(
              `INSERT INTO admin_audit_events (
                 id, event_type, entity_type, entity_id, actor_id, payload_json, occurred_at
               ) VALUES (?, 'payment_instructions.version_created',
                         'payment_instruction_version', ?, ?, ?, ?)`,
            )
            .bind(
              `payment-instructions:${input.commandId}`,
              input.id,
              input.actorId,
              JSON.stringify({
                channel: input.channel,
                supersededId: current?.id ?? null,
                supersededVersion: current?.version ?? null,
                version: nextVersion,
              }),
              input.now,
            ),
        );
        try {
          await database.batch(statements);
          return input.id;
        } catch (error) {
          const completed = await paymentInstructionByCommand(input.commandId);
          if (completed) return completed.id;
          if (attempt === 2) throw error;
        }
      }
      throw new Error("Payment Instructions version was not saved");
    },

    async saveReturnLocation(input: {
      actorId: string;
      address: string;
      commandId: string;
      id: string;
      label: string;
      mode: "create" | "update";
      now: string;
      phone: string;
    }) {
      const completed = await returnLocationCommand(input.commandId);
      if (completed) return completed.location_id;

      const existing = await database
        .prepare(`SELECT id FROM seller_return_locations WHERE id = ?`)
        .bind(input.id)
        .first<{ id: string }>();
      if (input.mode === "create" && existing) {
        throw new Error("Return location already exists");
      }
      if (input.mode === "update" && !existing) {
        throw new Error("Return location was not found");
      }

      const write =
        input.mode === "create"
          ? database
              .prepare(
                `INSERT INTO seller_return_locations (
                   id, label, address, phone, purpose, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?)`,
              )
              .bind(
                input.id,
                input.label,
                input.address,
                input.phone,
                RETURN_LOCATION_PURPOSE,
                input.now,
              )
          : database
              .prepare(
                `UPDATE seller_return_locations
                 SET label = ?, address = ?, phone = ?, purpose = ?, updated_at = ?
                 WHERE id = ?`,
              )
              .bind(
                input.label,
                input.address,
                input.phone,
                RETURN_LOCATION_PURPOSE,
                input.now,
                input.id,
              );

      try {
        await database.batch([
          write,
          database
            .prepare(
              `INSERT INTO seller_return_location_commands (
                 command_id, location_id, operation, actor_id, occurred_at
               ) VALUES (?, ?, ?, ?, ?)`,
            )
            .bind(
              input.commandId,
              input.id,
              input.mode,
              input.actorId,
              input.now,
            ),
          database
            .prepare(
              `INSERT INTO admin_audit_events (
                 id, event_type, entity_type, entity_id, actor_id,
                 payload_json, occurred_at
               ) VALUES (?, ?, 'seller_return_location', ?, ?, ?, ?)`,
            )
            .bind(
              `return-location:${input.commandId}`,
              `seller_return_location.${input.mode}d`,
              input.id,
              input.actorId,
              JSON.stringify({ label: input.label, operation: input.mode }),
              input.now,
            ),
        ]);
        return input.id;
      } catch (error) {
        const duplicate = await returnLocationCommand(input.commandId);
        if (duplicate) return duplicate.location_id;
        throw error;
      }
    },
  };
}
