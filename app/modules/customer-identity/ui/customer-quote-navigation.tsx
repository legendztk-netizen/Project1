import { FileText, MessagesSquare } from "lucide-react";
import { NavLink } from "react-router";

export function CustomerQuoteNavigation({ requestId }: { requestId: string }) {
  const base = `/account/quotes/${encodeURIComponent(requestId)}`;
  return (
    <nav className="customer-quote-navigation" aria-label="Quote sections">
      <NavLink to={`${base}/conversation`}>
        <span>
          <MessagesSquare aria-hidden="true" size={18} />
          Quote conversation
        </span>
      </NavLink>
      <NavLink to={`${base}/pi`}>
        <span>
          <FileText aria-hidden="true" size={18} />
          Proforma invoice
        </span>
      </NavLink>
    </nav>
  );
}
