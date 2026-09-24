import type { createShipmentReadyScheduleService } from "../application/shipment-ready-schedule-service";
import { readyScheduleText } from "../domain/ready-schedule";
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
            {schedule.acceptedBasis ? (
              <p>Accepted basis: {readyScheduleText(schedule.acceptedBasis)}</p>
            ) : (
              <p>No structured date was recorded in the accepted PI.</p>
            )}
            {schedule.acceptedReadyDate && (
              <p>Original calculated date: {schedule.acceptedReadyDate}</p>
            )}
            <p>
              Current estimated ready date:{" "}
              {schedule.currentEstimateDate ?? "Under review"}
              {schedule.currentEstimateSource === "operational" &&
                " (new operational estimate, not an original PI commitment)"}
              {schedule.currentEstimateSource === "revised" && " (revised)"}
            </p>
            {schedule.history.length > 0 && (
              <details>
                <summary>View date history</summary>
                <ol>
                  {schedule.history.map((revision) => (
                    <li key={revision.id}>
                      {revision.previousDate ?? "Not recorded"} →{" "}
                      {revision.newDate}: {revision.reason}
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
