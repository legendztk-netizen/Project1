import { ClipboardList, FileText, MessagesSquare } from "lucide-react";
import { NavLink } from "react-router";

export function CustomerQuoteNavigation({ requestId }: { requestId: string }) {
  const base = `/account/quotes/${encodeURIComponent(requestId)}`;
  return (
    <nav className="customer-quote-navigation" aria-label="Quote sections">
      <NavLink to={base} end>
        <span>
          <ClipboardList aria-hidden="true" size={18} />
          Overview
        </span>
      </NavLink>
      <NavLink to={`/account/messages/${encodeURIComponent(requestId)}`}>
        <span>
          <MessagesSquare aria-hidden="true" size={18} />
          Messages
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
