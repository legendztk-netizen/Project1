import type {
  CustomerSignInMethod,
  IpLocation,
} from "../../customer-identity/domain/customer-access";
import { formatBeijingDateTime } from "../../quote-review/domain/admin-quote-review";

export const signInMethodLabels: Record<CustomerSignInMethod, string> = {
  email_code: "邮箱验证码",
  password: "密码",
  password_reset: "邮箱验证码重设密码",
};

export function beijingDate(value: string) {
  return formatBeijingDateTime(value).split(" ")[0];
}

/** Cloudflare's approximate location of an IP address, e.g. `US · Texas · Houston`. */
export function accessLocation(location: IpLocation) {
  return (
    [location.country, location.region, location.city]
      .filter(Boolean)
      .join(" · ") || null
  );
}
