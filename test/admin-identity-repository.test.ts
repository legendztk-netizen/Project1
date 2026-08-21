import { describe, expect, it, vi } from "vitest";

import { findActiveAdminIdentityByEmail } from "../app/modules/admin/infrastructure/d1-admin-identity-repository";

describe("D1 Admin identity repository", () => {
  it("maps an active D1 record to the application identity", async () => {
    const first = vi.fn().mockResolvedValue({
      account_type: "owner",
      email: "owner@example.com",
      id: "admin-owner",
    });
    const bind = vi.fn(() => ({ first }));
    const prepare = vi.fn(() => ({ bind }));

    await expect(
      findActiveAdminIdentityByEmail(
        { prepare } as unknown as D1Database,
        "owner@example.com",
      ),
    ).resolves.toEqual({
      accountType: "owner",
      canManageSubaccounts: true,
      email: "owner@example.com",
      id: "admin-owner",
    });
    expect(bind).toHaveBeenCalledWith("owner@example.com");
  });

  it("derives subaccount-management permission from account type", async () => {
    const first = vi.fn().mockResolvedValue({
      account_type: "subaccount",
      email: "operator@example.com",
      id: "admin-operator",
    });
    const database = {
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first })) })),
    } as unknown as D1Database;

    await expect(
      findActiveAdminIdentityByEmail(database, "operator@example.com"),
    ).resolves.toMatchObject({
      accountType: "subaccount",
      canManageSubaccounts: false,
    });
  });

  it("returns null when no active D1 identity exists", async () => {
    const first = vi.fn().mockResolvedValue(null);
    const database = {
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first })) })),
    } as unknown as D1Database;

    await expect(
      findActiveAdminIdentityByEmail(database, "disabled@example.com"),
    ).resolves.toBeNull();
  });
});
