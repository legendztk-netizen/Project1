export function createD1RegistrationConfigurationRepository(
  database: D1Database,
) {
  return {
    async abandon(input: { challengeId: string; transactionId: string }) {
      const result = await database
        .prepare(
          `DELETE FROM customer_otp_challenges
           WHERE id = ? AND purpose = 'register' AND consumed_at IS NULL
             AND EXISTS (
               SELECT 1 FROM customer_registration_configuration_transactions
               WHERE id = ? AND otp_challenge_id = customer_otp_challenges.id
                 AND converted_at IS NULL
             )`,
        )
        .bind(input.challengeId, input.transactionId)
        .run();
      return (result.meta.changes ?? 0) === 1;
    },

    async cleanupExpired(now: string) {
      const result = await database
        .prepare(
          `DELETE FROM customer_registration_configuration_transactions
           WHERE converted_at IS NULL AND expires_at <= ?`,
        )
        .bind(now)
        .run();
      return result.meta.changes ?? 0;
    },

    async create(input: {
      challengeId: string;
      createdAt: string;
      expiresAt: string;
      id: string;
      snapshotJson: string;
    }) {
      const results = await database.batch([
        database
          .prepare(
            `INSERT INTO customer_registration_configuration_transactions
             (id, otp_challenge_id, snapshot_json, created_at, expires_at)
           SELECT ?, ?, ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM customer_otp_challenges
             WHERE id = ? AND purpose = 'register'
               AND delivery_status = 'delivered' AND consumed_at IS NULL
               AND superseded_at IS NULL
           )`,
          )
          .bind(
            input.id,
            input.challengeId,
            input.snapshotJson,
            input.createdAt,
            input.expiresAt,
            input.challengeId,
          ),
        database
          .prepare(
            `UPDATE customer_otp_challenges
             SET registration_configuration_requested = 1
             WHERE id = ? AND purpose = 'register'
               AND delivery_status = 'delivered' AND consumed_at IS NULL
               AND superseded_at IS NULL
               AND EXISTS (
                 SELECT 1 FROM customer_registration_configuration_transactions
                 WHERE id = ? AND otp_challenge_id = customer_otp_challenges.id
               )`,
          )
          .bind(input.challengeId, input.id),
      ]);
      if (
        (results[0]?.meta.changes ?? 0) !== 1 ||
        (results[1]?.meta.changes ?? 0) !== 1
      ) {
        throw new Error(
          "Registration configuration transaction was not created",
        );
      }
      return { id: input.id };
    },

    async discardChallenge(challengeId: string) {
      await database
        .prepare(
          `DELETE FROM customer_otp_challenges
           WHERE id = ? AND purpose = 'register' AND consumed_at IS NULL`,
        )
        .bind(challengeId)
        .run();
    },
  };
}
