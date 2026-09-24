import {
  validatedReadySchedule,
  type ReadyScheduleBasis,
} from "../domain/ready-schedule";

export function parseReadyScheduleForm(
  form: FormData,
  prefix: string,
): ReadyScheduleBasis {
  const kind = String(form.get(`${prefix}Kind`) ?? "");
  if (kind === "fixed_date")
    return validatedReadySchedule({
      kind,
      readyDate: String(form.get(`${prefix}Date`) ?? ""),
    });
  if (kind === "china_business_days")
    return validatedReadySchedule({
      kind,
      days: Number(form.get(`${prefix}Days`) ?? ""),
    });
  throw new Error("Select a reviewed ready-date schedule");
}
