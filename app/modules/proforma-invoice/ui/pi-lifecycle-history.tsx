import { Link } from "react-router";
import { Download, Eye } from "lucide-react";
import { formatPiDate } from "../domain/proforma-invoice";
import type { publicPiLifecycle } from "../domain/pi-lifecycle";

export interface PiLifecycleHistoryItem {
  id: string;
  requestId: string;
  snapshotHash: string;
  snapshot: {
    documentNumber: string;
    documentVersion: number;
    issuedAt: string;
    totals: { totalCents: number };
  };
  lifecycle: ReturnType<typeof publicPiLifecycle>;
}

// Receives only the owned customerHistory projection; never load review evidence here.
export function PiLifecycleHistory({
  records,
}: {
  records: readonly PiLifecycleHistoryItem[];
}) {
  if (!records.length) return null;
  return (
    <section
      aria-label="PI history"
      style={{ minWidth: 0, overflowWrap: "anywhere" }}
    >
      <h2>PI history</h2>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {records.map((record) => {
          const state = record.lifecycle;
          const base = `/account/quotes/${encodeURIComponent(record.requestId)}/pi/${encodeURIComponent(record.id)}`;
          // Historical downloads must not attempt to mint current-PI viewing evidence.
          const target = state.canAccept
            ? new URLSearchParams({
                documentVersion: String(record.snapshot.documentVersion),
                snapshotHash: record.snapshotHash,
              })
            : new URLSearchParams();
          const download = target.size
            ? `${base}/pdf?${target}`
            : `${base}/pdf`;
          target.set("disposition", "inline");
          return (
            <li
              key={record.id}
              style={{ paddingBlock: 16, borderBottom: "1px solid #d8dde3" }}
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 12,
                  alignItems: "baseline",
                }}
              >
                <Link to={base}>
                  {record.snapshot.documentNumber} · Version{" "}
                  {record.snapshot.documentVersion}
                </Link>
                <strong>{state.label}</strong>
                <span>
                  USD {(record.snapshot.totals.totalCents / 100).toFixed(2)}
                </span>
              </div>
              <p>
                Issued (ET):{" "}
                {formatPiDate(record.snapshot.issuedAt, "customer")}
              </p>
              {state.acceptedAt && (
                <p>
                  Accepted (ET): {formatPiDate(state.acceptedAt, "customer")}
                </p>
              )}
              {state.awaitingReplacement && <p>Updated PI pending</p>}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
                <a
                  href={`${base}/pdf?${target}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Eye size={16} aria-hidden="true" /> View PDF
                </a>
                <a href={download}>
                  <Download size={16} aria-hidden="true" /> Download PDF
                </a>
                {state.canAccept && (
                  <Link to={`${base}/accept`}>Review and accept</Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
