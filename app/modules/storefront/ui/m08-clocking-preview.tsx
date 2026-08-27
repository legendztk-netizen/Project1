import { useId } from "react";

const dialPoints = [0, 45, 90, 135, 180, 225, 270, 315] as const;

function clockingPoint(angle: number, radius: number) {
  const radians = (angle * Math.PI) / 180;
  return [500 - Math.sin(radians) * radius, 315 + Math.cos(radians) * radius];
}

function clockingArc(angle: number) {
  const [x, y] = clockingPoint(angle, 130);
  return `M 500 445 A 130 130 0 ${angle > 180 ? 1 : 0} 1 ${x} ${y}`;
}

export function formatClockingAngle(angle: number) {
  return String(angle).padStart(3, "0");
}

export function M08ClockingPreview({ angle }: { angle: number | null }) {
  const markerId = `clocking-arrow-${useId().replaceAll(":", "")}`;
  const endAPoint = angle === null ? null : clockingPoint(angle, 205);
  const formattedAngle = angle === null ? null : formatClockingAngle(angle);
  const description =
    angle === null
      ? "Double-elbow Clocking angle not selected. View from End A toward End B. End B is fixed at 000 degrees at 6 o'clock."
      : `Double-elbow Clocking ${formattedAngle} degrees. View from End A toward End B. End B is fixed at 000 degrees at 6 o'clock and End A is measured clockwise.`;

  return (
    <figure className="clocking-diagram-frame">
      <svg
        aria-label={description}
        className="clocking-diagram"
        role="img"
        viewBox="0 0 1000 620"
      >
        <defs>
          <marker
            id={markerId}
            markerHeight="8"
            markerWidth="8"
            orient="auto"
            refX="5"
            refY="5"
            viewBox="0 0 10 10"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#1769aa" />
          </marker>
        </defs>
        <line className="clocking-axis" x1="190" x2="810" y1="315" y2="315" />
        <line className="clocking-axis" x1="500" x2="500" y1="55" y2="575" />
        <circle className="clocking-dial" cx="500" cy="315" r="220" />
        {dialPoints.map((preset) => {
          const [x, y] = clockingPoint(preset, 220);
          return (
            <circle
              className="clocking-tick"
              cx={x}
              cy={y}
              key={preset}
              r="5"
            />
          );
        })}
        <line
          className="clocking-arm end-b"
          x1="500"
          x2="500"
          y1="315"
          y2="520"
        />
        {endAPoint ? (
          <line
            className="clocking-arm end-a"
            x1="500"
            x2={endAPoint[0]}
            y1="315"
            y2={endAPoint[1]}
          />
        ) : null}
        <circle className="clocking-hub" cx="500" cy="315" r="68" />
        <circle className="clocking-hub-center" cx="500" cy="315" r="24" />
        <circle className="clocking-end" cx="500" cy="520" r="38" />
        {endAPoint ? (
          <circle
            className="clocking-end"
            cx={endAPoint[0]}
            cy={endAPoint[1]}
            r="38"
          />
        ) : null}
        {angle !== null && angle > 0 ? (
          <path
            className="clocking-angle-arc"
            d={clockingArc(angle)}
            markerEnd={`url(#${markerId})`}
          />
        ) : null}
        <g className="clocking-label" transform="translate(500 42)">
          <rect height="46" rx="4" width="370" x="-185" y="-32" />
          <text textAnchor="middle">View End A toward End B</text>
        </g>
        <g className="clocking-label" transform="translate(500 595)">
          <rect height="46" rx="4" width="310" x="-155" y="-32" />
          <text textAnchor="middle">End B · 000°</text>
        </g>
        <g
          className="clocking-label current"
          transform={
            endAPoint
              ? `translate(${endAPoint[0] < 480 ? 220 : 780} ${endAPoint[1] < 215 ? 135 : endAPoint[1] > 415 ? 455 : 260})`
              : "translate(500 190)"
          }
        >
          <rect height="46" rx="4" width="330" x="-165" y="-32" />
          <text textAnchor="middle">
            {formattedAngle
              ? `End A · ${formattedAngle}°`
              : "End A · Select angle"}
          </text>
        </g>
        <text className="clocking-direction" x="790" y="570">
          CLOCKWISE
        </text>
      </svg>
      <figcaption>Not to scale</figcaption>
    </figure>
  );
}
