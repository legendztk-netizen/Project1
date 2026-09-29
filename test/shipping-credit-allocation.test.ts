import { expect, it } from "vitest";
import { shippingCreditAllocation } from "../app/modules/shipment/domain/order-shipping-change";
it("separates Sales Tax from logistics without changing the accepted total credit", () => {
  expect(shippingCreditAllocation(-1000, 300)).toEqual({
    logisticsCents: 700,
    taxCents: 300,
  });
  expect(shippingCreditAllocation(-700)).toEqual({
    logisticsCents: 700,
    taxCents: 0,
  });
  expect(shippingCreditAllocation(1200)).toEqual({
    logisticsCents: 0,
    taxCents: 0,
  });
});
it.each([-1, 0.5, 701, NaN])("rejects invalid tax credit %s", (tax) => {
  expect(() => shippingCreditAllocation(-700, tax)).toThrow();
});
it("does not assign a refund component to an additional payment", () => {
  expect(() => shippingCreditAllocation(1200, 100)).toThrow();
});
