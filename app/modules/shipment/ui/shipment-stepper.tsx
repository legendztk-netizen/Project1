import { Check } from "lucide-react";
import "./shipment-documents.css";

export function ShipmentStepper({
  labels,
  completed,
}: {
  labels: readonly string[];
  completed: number;
}) {
  return (
    <ol className="shipment-stepper">
      {labels.map((label, index) => {
        const state =
          index <= completed
            ? "complete"
            : index === completed + 1
              ? "current"
              : "upcoming";
        return (
          <li
            key={label}
            data-state={state}
            data-complete={index <= completed}
            aria-current={state === "current" ? "step" : undefined}
          >
            <span className="shipment-stepper-marker" aria-hidden="true">
              {state === "complete" ? <Check size={14} /> : index + 1}
            </span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}
