import { ArrowLeft, Download } from "lucide-react";
import { data, Link, type LoaderFunctionArgs } from "react-router";

import { cloudflareContext } from "#workers/context";
import {
  piCustomerProfile,
  piPrivateHeaders,
  piRouteId,
} from "#workers/proforma-invoice";
import { createShipmentDocumentsService } from "../../shipment/application/shipment-documents-service";
import { AccountWorkspace } from "../ui/account-workspace";
import "../../shipment/ui/shipment-documents.css";

export const headers = piPrivateHeaders;

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { env } = context.get(cloudflareContext);
  const profileId = await piCustomerProfile(env, request);
  const orderId = piRouteId(params.orderId);
  const shipmentId = piRouteId(params.shipmentId);
  const listing = await createShipmentDocumentsService(
    env.DB,
    env.PRIVATE_FILES,
  ).customerList(
    profileId,
    orderId,
    shipmentId,
    Number(new URL(request.url).searchParams.get("page") ?? 1),
  );
  return data({ orderId, shipmentId, ...listing }, { headers: headers() });
}

export default function CustomerShipmentDocuments({
  loaderData,
}: {
  loaderData: Awaited<ReturnType<typeof loader>>["data"];
}) {
  const { orderId, shipmentId, documents, documentPage, hasMoreDocuments } =
    loaderData;
  const base = `/account/orders/${encodeURIComponent(orderId)}/shipments/${encodeURIComponent(shipmentId)}/documents`;
  return (
    <AccountWorkspace activeView="orders">
      <main className="account-detail-content customer-quote-detail shipment-documents-page">
        <Link
          className="customer-quote-back-link"
          to={`/account/orders/${encodeURIComponent(orderId)}`}
        >
          <ArrowLeft size={17} aria-hidden="true" /> Back to Order
        </Link>
        <h1>Shipment documents</h1>
        {documents.length === 0 ? (
          <p>No shared documents are available for this shipment.</p>
        ) : (
          <ul className="shipment-document-list">
            {documents.map((document) => (
              <li key={document.id}>
                <div>
                  <strong>{document.filename}</strong>
                  <span>{document.kind.replaceAll("_", " ")}</span>
                </div>
                <Link
                  className="button button-secondary"
                  reloadDocument
                  to={`${base}/${encodeURIComponent(document.id)}/download`}
                >
                  <Download size={16} aria-hidden="true" /> Download
                </Link>
              </li>
            ))}
          </ul>
        )}
        {(documentPage > 1 || hasMoreDocuments) && (
          <nav
            className="shipment-document-pagination"
            aria-label="Shipment document pages"
          >
            {documentPage > 1 && (
              <Link to={`?page=${documentPage - 1}`}>Previous</Link>
            )}
            <span>Page {documentPage}</span>
            {hasMoreDocuments && (
              <Link to={`?page=${documentPage + 1}`}>Next</Link>
            )}
          </nav>
        )}
      </main>
    </AccountWorkspace>
  );
}
