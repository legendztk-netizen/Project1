import { useEffect, useRef, useState } from "react";
import { Form, useNavigation } from "react-router";
import { Landmark } from "lucide-react";
import { ActionDialog } from "../../shared/ui/action-dialog";
import type { CustomerRefundAccount } from "../application/refund-account-service";
import "./after-sales.css";

export function CustomerRefundAccountAction({
  account,
  commandId,
  actionData,
}: {
  account: CustomerRefundAccount;
  commandId: string;
  actionData?: { error?: string };
}) {
  const [open, setOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState(account);
  const bankDetails =
    editingAccount.details?.channel !== "paypal"
      ? editingAccount.details
      : null;
  const paypalDetails =
    editingAccount.details?.channel === "paypal"
      ? editingAccount.details
      : null;
  const [channel, setChannel] = useState("bank_transfer");
  const [country, setCountry] = useState("US");
  const submitted = useRef(false);
  const actionAtOpen = useRef(actionData);
  const navigation = useNavigation();
  useEffect(() => {
    if (navigation.state !== "idle" || !submitted.current) return;
    submitted.current = false;
    if (!actionData?.error) setOpen(false);
  }, [navigation.state, actionData]);
  if (!account.eligible) return null;
  return (
    <>
      <button
        type="button"
        className="button button-secondary refund-account-button"
        onClick={() => {
          actionAtOpen.current = actionData;
          setEditingAccount(account);
          setCountry(
            account.details && account.details.channel !== "paypal"
              ? account.details.bankCountry
              : "US",
          );
          setChannel(
            account.account?.channel ?? account.channel ?? "bank_transfer",
          );
          setOpen(true);
        }}
      >
        <Landmark size={18} aria-hidden="true" />
        {account.account ? "Update refund account" : "Refund account"}
      </button>
      {open && (
        <ActionDialog
          language="en"
          title="Refund account"
          wide
          description="Provide a bank or PayPal account for your approved refund. It must belong to the person or business that placed this order. We will send the refund separately; submitting this form does not transfer money."
          error={
            actionData !== actionAtOpen.current ? actionData?.error : undefined
          }
          onClose={() => setOpen(false)}
          onSubmitted={() => {
            submitted.current = true;
          }}
        >
          <Form
            method="post"
            className="shipping-change-form refund-account-form"
            autoComplete="off"
          >
            <input type="hidden" name="intent" value="refund-account-submit" />
            <input type="hidden" name="commandId" value={commandId} />
            <input
              type="hidden"
              name="expectedVersion"
              value={editingAccount.account?.version ?? 0}
            />
            {editingAccount.account && (
              <p>
                {editingAccount.account.channel === "paypal"
                  ? "A PayPal account is currently provided."
                  : `Current bank account ends in ${editingAccount.account.accountLast4}.`}{" "}
                Review and update your saved details below. Changes apply to
                unpaid refunds.
              </p>
            )}
            <label>
              Refund method
              <select
                name="channel"
                value={channel}
                onChange={(event) => setChannel(event.target.value)}
              >
                <option value="bank_transfer">Bank transfer</option>
                <option value="paypal">PayPal</option>
              </select>
            </label>
            {channel !== editingAccount.channel && (
              <p>
                A different refund method requires review before we send your
                refund.
              </p>
            )}
            {channel === "paypal" ? (
              <>
                <label>
                  Account holder's full name
                  <input
                    name="holderName"
                    required
                    maxLength={200}
                    defaultValue={editingAccount.details?.holderName ?? ""}
                  />
                </label>
                <label>
                  PayPal email address
                  <input
                    type="email"
                    name="paypalEmail"
                    defaultValue={paypalDetails?.paypalEmail ?? ""}
                    required
                    maxLength={254}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <p>
                  Use the PayPal account belonging to the person or business
                  that placed this order. Where available, we refund the
                  original PayPal transaction.
                </p>
              </>
            ) : (
              <>
                <div className="shipping-change-fields">
                  <label>
                    Account holder's full name
                    <input
                      name="holderName"
                      required
                      maxLength={200}
                      defaultValue={editingAccount.details?.holderName ?? ""}
                    />
                  </label>
                  <label>
                    Bank name
                    <input
                      name="bankName"
                      defaultValue={bankDetails?.bankName ?? ""}
                      required
                      maxLength={200}
                    />
                  </label>
                  <label>
                    Bank country (two-letter code)
                    <input
                      name="bankCountry"
                      required
                      maxLength={2}
                      pattern="[A-Za-z]{2}"
                      value={country}
                      onChange={(event) =>
                        setCountry(event.target.value.toUpperCase())
                      }
                    />
                  </label>
                  <label>
                    Account type
                    <select
                      name="accountType"
                      defaultValue={bankDetails?.accountType ?? "checking"}
                    >
                      <option value="checking">Checking</option>
                      <option value="savings">Savings</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <label>
                    Account number / IBAN
                    <input
                      name="accountNumber"
                      defaultValue={bankDetails?.accountNumber ?? ""}
                      required
                      maxLength={40}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                  <label>
                    {country === "US"
                      ? "US routing number for incoming transfers"
                      : "Local routing / clearing code (optional)"}
                    <input
                      name="routingCode"
                      defaultValue={bankDetails?.routingCode ?? ""}
                      required={country === "US"}
                      maxLength={20}
                      inputMode={country === "US" ? "numeric" : "text"}
                    />
                  </label>
                  <label>
                    SWIFT / BIC {country === "US" ? "(optional)" : ""}
                    <input
                      name="swiftCode"
                      defaultValue={bankDetails?.swiftCode ?? ""}
                      required={country !== "US"}
                      maxLength={11}
                      spellCheck={false}
                    />
                  </label>
                  <label>
                    Bank address (optional)
                    <input
                      name="bankAddress"
                      defaultValue={bankDetails?.bankAddress ?? ""}
                      maxLength={500}
                    />
                  </label>
                </div>
                <label>
                  Account holder's address
                  <textarea
                    name="holderAddress"
                    defaultValue={bankDetails?.holderAddress ?? ""}
                    required
                    maxLength={500}
                    rows={2}
                  />
                </label>
              </>
            )}
            <label className="shipping-change-choice">
              <input type="checkbox" name="samePurchasingContext" required />I
              confirm this account belongs to the person or business that placed
              this order and the details are correct.
            </label>
            <p>
              Do not provide passwords, PINs or card security codes. For bank
              transfers, use the routing instructions supplied by your bank.
            </p>
            <button
              className="button button-primary"
              disabled={navigation.state !== "idle"}
            >
              Submit refund account
            </button>
          </Form>
        </ActionDialog>
      )}
    </>
  );
}
export function CustomerRefundAccountStatus({
  account,
}: {
  account: CustomerRefundAccount;
}) {
  if (!account.eligible) return null;
  return (
    <p className="after-sales-next-step" role="status">
      {account.account
        ? `Refund account provided${account.account.channel === "paypal" ? " · PayPal" : ` · bank account ending ${account.account.accountLast4}`}. ${account.account.kind === "alternative" ? "Your selected refund method requires review before remittance." : "Your refund is awaiting remittance."}`
        : "Your refund is approved. Please select Refund account above to provide your bank or PayPal account."}
    </p>
  );
}
