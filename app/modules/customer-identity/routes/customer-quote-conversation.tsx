import { redirect } from "react-router";
import type { Route } from "./+types/customer-quote-conversation";

// Quote conversations now live in Messages; keep old links working.
export function loader({ params }: Route.LoaderArgs) {
  return redirect(`/account/messages/${encodeURIComponent(params.requestId)}`);
}
