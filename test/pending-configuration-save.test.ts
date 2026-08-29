import { describe, expect, it, vi } from "vitest";

import { createPendingConfigurationSaveService } from "../app/modules/configurator/application/pending-configuration-save-service";
import {
  normalizePendingConfigurationEmail,
  pendingConfigurationVerificationToken,
  pendingConfigurationSaveIdentity,
  preparePendingConfigurationSnapshot,
  PendingConfigurationSaveRejected,
} from "../app/modules/configurator/domain/pending-configuration-save";
import { createHoseConfigurationDraft } from "../app/modules/configurator/domain/hose-configuration-draft";
import type { createD1PendingConfigurationRepository } from "../app/modules/configurator/infrastructure/d1-pending-configuration-repository";
import { publicHoseFixture } from "./fixtures/public-hose";

function pageState() {
  return {
    quantityInput: "1",
    selectionProvenance: {},
    stage: "hose",
  } as const;
}

function repositoryFixture() {
  let saved = false;
  let effectStatus = "pending" as "pending" | "dispatching" | "queued" | "sent";
  const repository = {
    claimEmailDispatch: vi.fn(async () => {
      if (effectStatus !== "pending") return null;
      effectStatus = "dispatching";
      return { id: "effect-1" };
    }),
    consumeSaveLimit: vi.fn(async () => true),
    hasActiveSave: vi.fn(async () => saved),
    markEmailEffectQueued: vi.fn(async () => {
      effectStatus = "queued";
    }),
    releaseEmailEffect: vi.fn(async () => {
      effectStatus = "pending";
    }),
    save: vi.fn(async (input: { email: string }) => {
      const created = !saved;
      saved = true;
      return {
        created,
        effectId: "effect-1",
        effectStatus,
        email: input.email,
        id: "pending-1",
      };
    }),
    verifyEmail: vi.fn(),
  };
  return {
    repository: repository as unknown as ReturnType<
      typeof createD1PendingConfigurationRepository
    >,
    spies: repository,
  };
}

function environment(queueSend = vi.fn(async () => undefined)) {
  return {
    APP_ENV: "local",
    ASYNC_JOBS: { send: queueSend },
  } as unknown as CloudflareBindings;
}

describe("pending configuration Email Save", () => {
  it("normalizes a valid address and rejects an invalid one", () => {
    expect(normalizePendingConfigurationEmail(" Buyer@Example.COM ")).toBe(
      "buyer@example.com",
    );
    expect(() => normalizePendingConfigurationEmail("buyer@localhost")).toThrow(
      PendingConfigurationSaveRejected,
    );
  });

  it("captures the exact page draft separately from explicit version references", async () => {
    const configuration = createHoseConfigurationDraft(publicHoseFixture());
    if (!configuration) throw new Error("Expected configuration draft");
    const prepared = preparePendingConfigurationSnapshot({
      configuration,
      pageState: pageState(),
    });

    expect(prepared.snapshot).toEqual({
      configuration,
      pageState: pageState(),
    });
    expect(prepared.versions).toEqual({
      assemblyEstimateSchedule: null,
      catalogRelease: { id: "release-002", number: "CAT-002" },
      clockingConvention: null,
      installedProtection: null,
      lengthTolerance: null,
      measurementMethod: null,
    });
    const first = await pendingConfigurationSaveIdentity(
      "buyer@example.com",
      prepared.snapshot,
    );
    const reordered = await pendingConfigurationSaveIdentity(
      "buyer@example.com",
      {
        pageState: prepared.snapshot.pageState,
        configuration: prepared.snapshot.configuration,
      },
    );
    expect(reordered).toBe(first);
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("persists and queues one effect for an idempotently repeated command", async () => {
    const queueSend = vi.fn(async () => undefined);
    const { repository, spies } = repositoryFixture();
    const service = createPendingConfigurationSaveService(
      environment(queueSend),
      {
        generateId: () => "generated-id",
        now: () => new Date("2026-08-29T00:00:00.000Z"),
        repository,
      },
    );
    const configuration = createHoseConfigurationDraft(publicHoseFixture());

    const first = await service.save({
      configuration,
      email: "BUYER@example.com",
      pageState: pageState(),
    });
    const repeated = await service.save({
      configuration,
      email: "buyer@example.com",
      pageState: pageState(),
    });

    expect(first).toEqual({
      alreadySaved: false,
      email: "buyer@example.com",
      id: "pending-1",
    });
    expect(repeated.alreadySaved).toBe(true);
    expect(queueSend).toHaveBeenCalledTimes(1);
    expect(queueSend).toHaveBeenCalledWith(
      expect.objectContaining({
        effectId: "effect-1",
        email: "buyer@example.com",
        type: "pending_configuration_verification",
        token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
      }),
    );
    expect(spies.save).toHaveBeenCalledTimes(2);
  });

  it("releases a failed email effect without mutating the page draft", async () => {
    const queueSend = vi.fn(async () => {
      throw new Error("queue unavailable");
    });
    const { repository, spies } = repositoryFixture();
    const service = createPendingConfigurationSaveService(
      environment(queueSend),
      {
        generateId: () => "generated-id",
        now: () => new Date("2026-08-29T00:00:00.000Z"),
        repository,
      },
    );
    const configuration = createHoseConfigurationDraft(publicHoseFixture());
    const before = JSON.stringify(configuration);

    await expect(
      service.save({
        configuration,
        email: "buyer@example.com",
        pageState: pageState(),
      }),
    ).rejects.toMatchObject({ code: "EMAIL_UNAVAILABLE" });
    expect(spies.releaseEmailEffect).toHaveBeenCalledWith(
      "effect-1",
      "2026-08-29T00:00:00.000Z",
    );
    expect(JSON.stringify(configuration)).toBe(before);
  });

  it("rejects a rate-limited command before persistence or email dispatch", async () => {
    const queueSend = vi.fn(async () => undefined);
    const { repository, spies } = repositoryFixture();
    spies.consumeSaveLimit.mockResolvedValueOnce(false);
    const service = createPendingConfigurationSaveService(
      environment(queueSend),
      {
        now: () => new Date("2026-08-29T00:00:00.000Z"),
        repository,
      },
    );

    await expect(
      service.save({
        configuration: createHoseConfigurationDraft(publicHoseFixture()),
        email: "buyer@example.com",
        pageState: pageState(),
      }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(spies.save).not.toHaveBeenCalled();
    expect(queueSend).not.toHaveBeenCalled();
  });

  it("derives a stable non-plaintext verification credential", async () => {
    const first = await pendingConfigurationVerificationToken(
      "save-identity",
      "test-secret",
    );
    const repeated = await pendingConfigurationVerificationToken(
      "save-identity",
      "test-secret",
    );
    expect(repeated).toBe(first);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(first).not.toContain("save-identity");
  });
});
