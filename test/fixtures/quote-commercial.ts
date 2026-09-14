import type { QuoteCommercialTerms } from "../../app/modules/quote-review/domain/quote-commercial-terms";

export const commercialAddress = {
  addressLine1: "1 Test Street",
  addressLine2: "",
  city: "New York",
  countryCode: "US",
  label: "Test address",
  postalCode: "10001",
  recipientEmail: "test@example.com",
  recipientName: "Test Buyer",
  recipientPhone: "+1 212 555 0100",
  stateProvince: "NY",
};
export function commercialTerms(): QuoteCommercialTerms {
  return {
    destination: { ...commercialAddress },
    addressConfirmed: true,
    addressReplacementReason: "",
    shipmentMode: "together",
    splitPlan: "",
    transportMethod: "Air freight",
    incoterm: "DDP",
    termReplacementReason: "",
    namedPlace: "New York, US",
    packingEstimate: "Estimated 2 cartons, 20 kg gross, 50 x 40 x 30 cm each",
    freightReviewConfirmed: true,
    actualPacking: "",
    taxTreatment: "Not Collected",
    taxEvidenceId: null,
    leadTime: "20 days after cleared payment for the quoted quantity",
    charges: {
      freight: 2000,
      insurance: 100,
      dutiesImport: 300,
      salesTax: 0,
      cuttingLabeling: 250,
      assemblyService: 100,
      protectionService: 50,
    },
    manualCurrencyConfirmed: true,
  };
}
