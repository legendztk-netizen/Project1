import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";

import type { Route } from "./+types/privacy-notice";
import { cloudflareContext } from "#workers/context";
import {
  privacyContactEmail,
  privacyNoticeCookies,
  privacyNoticeOperator,
  privacyNoticeUpdated,
} from "../domain/privacy-notice";
import { createD1SellerCommercialSettingsRepository } from "../../seller-settings/infrastructure/d1-seller-commercial-settings-repository";
import { StorefrontHeader } from "../ui/storefront-header";
import "../styles/measurement-guide.css";

const sections: ReadonlyArray<{ title: string; items: readonly string[] }> = [
  {
    title: "Information we collect",
    items: [
      "Account: your email address, the name and phone number you add, and an optional password, which we store only as a salted hash.",
      "Company: the legal name, trade name, country and registration or tax ID you give when you buy for a company.",
      "Delivery addresses: recipient name, email, phone number and address.",
      "Quotes and orders: the products and hose assembly specifications you choose, your Quote List and saved configurations, RFQs, Proforma Invoices, orders, shipments, cancellations, returns and refunds.",
      "Proforma Invoice acceptance: the name you type, the time, your IP address and your browser's user agent, kept as evidence of the acceptance.",
      "Messages and files: what you send us through the website or by replying to our email, including attached photos and documents.",
      "Refund details: the bank account or PayPal account you give us for a refund. We store these encrypted.",
      "Payments: you pay by bank transfer or PayPal outside this website. We record the amount, channel and payment reference we receive. We never collect card numbers.",
      "Order requests: when you report a problem or request a return, request or withdraw a cancellation, confirm or dispute a refund, give refund account details, or request a delivery address or shipping plan change, we record your IP address with the request.",
      "Sign-in: the IP address you registered from, and the time, method and IP address of your most recent sign-in, each with the approximate country, region and city that Cloudflare associates with the IP address. We use this to protect your account and to investigate misuse.",
      "Rate limiting: when you request a sign-in code or enter a password, we keep a keyed one-way digest of your IP address to stop repeated attempts. It cannot be turned back into the address.",
    ],
  },
  {
    title: "How we use it",
    items: [
      "To create your account, sign you in and keep the account secure.",
      "To review your RFQs, prepare quotes and Proforma Invoices, build and ship your orders, and handle cancellations, returns and refunds.",
      "To email you about your account, quotes and orders.",
      "To keep the business, tax and accounting records we are required to keep, and to resolve disputes.",
      "We do not use your information for advertising and we do not send marketing email.",
    ],
  },
  {
    title: "Who we share it with",
    items: [
      "Cloudflare, which hosts this website, its database and file storage, and receives email replies for us.",
      "Resend, which sends our email.",
      "Carriers, freight forwarders and customs brokers, who receive delivery and shipment details so that your order can be delivered and cleared through customs.",
      "Banks and PayPal, when we send you a refund.",
      "Public authorities, when the law requires it.",
      "We do not sell your personal information or share it for cross-context behavioral advertising.",
    ],
  },
  {
    title: "Where it is stored",
    items: [
      "Our database and files are hosted by Cloudflare in western North America.",
      "Our team works in China and accesses this information from there to handle your quotes and orders. Service providers may also process it in other countries.",
    ],
  },
  {
    title: "How long we keep it",
    items: [
      "Account, company, address and sign-in information: for as long as your account exists.",
      "RFQs, Proforma Invoices and their acceptance evidence, orders, payments, refunds, order requests and related messages: as business records for tax, accounting and dispute purposes, also after an account is closed.",
      "Request logs that include IP addresses: up to 7 days.",
    ],
  },
  {
    title: "Cookies",
    items: [
      ...privacyNoticeCookies.map(
        (cookie) =>
          `${cookie.name}: ${cookie.purpose} Expires after ${cookie.lifetime}.`,
      ),
      "Cloudflare may set cookies it needs for security, for example when it shows a verification challenge.",
      "We use no analytics or advertising cookies.",
    ],
  },
  {
    title: "Your choices and rights",
    items: [
      "You can see and update your contact details, company information and addresses in My Account.",
      `Email ${privacyContactEmail} from your account email address to ask for a copy of your personal information, a correction, or deletion of your account. We delete or de-identify what we are not required to keep, and we aim to reply within 30 days.`,
      "Depending on where you live, for example in California or Canada, you may have additional rights, including complaining to a privacy regulator. Using these rights does not change how we treat you.",
    ],
  },
  {
    title: "Security",
    items: [
      "Passwords are stored only as salted hashes, sign-in sessions only as digests, and refund account details encrypted. Staff access to customer information is limited by individual account permissions.",
      "No method of storage or transmission is completely secure, so we cannot guarantee absolute security.",
    ],
  },
  {
    title: "Children",
    items: [
      "This website sells hydraulic parts to businesses and adults. It is not intended for children, and we do not knowingly collect information from anyone under 16.",
    ],
  },
  {
    title: "Changes",
    items: [
      "When this notice changes, we update it on this page and change the date at the top.",
    ],
  },
];

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const identity = await createD1SellerCommercialSettingsRepository(
    env.DB,
  ).findCurrentIdentity();
  return {
    appName: env.PUBLIC_APP_NAME,
    operator: privacyNoticeOperator(identity?.registeredAddressEn ?? null),
  };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: `Privacy Notice | ${loaderData?.appName ?? "Hydraulic Supply"}` },
    {
      name: "description",
      content:
        "What personal information we collect, why, who we share it with, how long we keep it and your choices.",
    },
  ];
}

export default function PrivacyNotice({ loaderData }: Route.ComponentProps) {
  return (
    <div className="storefront-shell" data-surface="storefront">
      <StorefrontHeader />
      <main className="measurement-guide-page">
        <Link className="product-back-link" to="/catalog">
          <ArrowLeft size={17} /> Back to products
        </Link>
        <header className="measurement-guide-heading">
          <span className="eyebrow">Policy</span>
          <h1>Privacy Notice</h1>
          <p>
            {loaderData.appName} at customhoseco.com is operated by{" "}
            {loaderData.operator} (&ldquo;we&rdquo;). This notice explains what
            personal information we collect on this website, why, and the
            choices you have. Last updated {privacyNoticeUpdated}.
          </p>
        </header>
        {sections.map((section) => (
          <section className="policy-section" key={section.title}>
            <h2>{section.title}</h2>
            <ul>
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
        <section className="policy-section">
          <h2>Contact</h2>
          <p>
            {loaderData.operator}.{" "}
            <a href={`mailto:${privacyContactEmail}`}>{privacyContactEmail}</a>
          </p>
        </section>
      </main>
    </div>
  );
}
