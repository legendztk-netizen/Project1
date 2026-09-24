import type { createShipmentReadyScheduleService } from "../application/shipment-ready-schedule-service";
import {
  customerCalendarDate,
  readyScheduleText,
} from "../domain/ready-schedule";
import "./shipment-documents.css";

type Schedule = Awaited<
  ReturnType<
    ReturnType<typeof createShipmentReadyScheduleService>["customerRead"]
  >
>[number];

export function CustomerShipmentReadySchedules({
  schedules,
}: {
  schedules: Schedule[];
}) {
  if (!schedules.length) return null;
  return (
    <section className="customer-quote-section shipment-ready-schedules">
      <h2>Ready-to-ship dates</h2>
      <div className="shipment-schedule-list">
        {schedules.map((schedule) => (
          <article key={schedule.shipmentId}>
            <h3>{schedule.displayName}</h3>
            {!schedule.acceptedBasis ? (
              <p>No structured date was recorded in the accepted PI.</p>
            ) : schedule.acceptedBasis.kind === "china_business_days" ? (
              <p>Accepted basis: {readyScheduleText(schedule.acceptedBasis)}</p>
            ) : (
              <p>Accepted basis: fixed date in the PI</p>
            )}
            {schedule.acceptedBasis?.kind === "fixed_date" &&
              schedule.acceptedReadyDate &&
              !schedule.currentEstimateDate && (
                <p>
                  The original fixed date had passed at Order confirmation; a
                  current estimate is under review.
                </p>
              )}
            <p>
              {schedule.currentEstimateSource === "revised"
                ? "Updated Estimated Ready-to-Ship Date"
                : "Estimated Ready-to-Ship Date"}
              :{" "}
              {schedule.currentEstimateDate
                ? customerCalendarDate(schedule.currentEstimateDate)
                : "Under review"}
              {schedule.currentEstimateSource === "operational" &&
                " (new operational estimate, not an original PI commitment)"}
              {schedule.currentEstimateSource === "revised" && " (revised)"}
            </p>
            {(schedule.acceptedReadyDate || schedule.history.length > 0) && (
              <details>
                <summary>View date history</summary>
                <ol>
                  {schedule.acceptedReadyDate && (
                    <li>
                      Accepted date:{" "}
                      {customerCalendarDate(schedule.acceptedReadyDate)}
                    </li>
                  )}
                  {schedule.history.map((revision) => (
                    <li key={revision.id}>
                      {revision.previousDate
                        ? customerCalendarDate(revision.previousDate)
                        : "Not recorded"}{" "}
                      → {customerCalendarDate(revision.newDate)}:{" "}
                      {revision.reason}
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
