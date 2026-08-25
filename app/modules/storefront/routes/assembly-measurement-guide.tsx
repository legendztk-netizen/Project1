import { ArrowLeft, CircleAlert, Ruler, RotateCw } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import m01Image from "../../../../assets/measurement-diagrams/M01-straight-male-to-straight-male.jpg";
import m02Image from "../../../../assets/measurement-diagrams/M02-female-seat-to-female-seat.jpg";
import m03Image from "../../../../assets/measurement-diagrams/M03-straight-to-45-elbow.jpg";
import m04Image from "../../../../assets/measurement-diagrams/M04-straight-to-90-elbow.jpg";
import m05Image from "../../../../assets/measurement-diagrams/M05-45-elbow-to-45-elbow.jpg";
import m06Image from "../../../../assets/measurement-diagrams/M06-90-elbow-to-90-elbow.jpg";
import m07Image from "../../../../assets/measurement-diagrams/M07-orfs-flat-face-to-flat-face.jpg";
import { StorefrontHeader } from "../ui/storefront-header";
import "../styles/measurement-guide.css";

type Point = readonly [number, number];
type Segment = readonly [number, number, number, number];

interface MeasurementMethod {
  basis: string;
  centerlines?: readonly Segment[];
  endA: Point;
  endB: Point;
  id: `M0${1 | 2 | 3 | 4 | 5 | 6 | 7}`;
  image: string;
  imageHeight: number;
  imageWidth: number;
  sealingFaces?: readonly Segment[];
  title: string;
}

const methods: readonly MeasurementMethod[] = [
  {
    basis:
      "Measure from the defined end point of End A to the defined end point of End B.",
    endA: [70, 360],
    endB: [2100, 360],
    id: "M01",
    image: m01Image,
    imageHeight: 724,
    imageWidth: 2172,
    title: "Straight male end to straight male end",
  },
  {
    basis:
      "Measure between the two conical sealing surfaces, not the outside edges of the swivel nuts.",
    endA: [76, 350],
    endB: [2096, 350],
    id: "M02",
    image: m02Image,
    imageHeight: 724,
    imageWidth: 2172,
    sealingFaces: [
      [76, 294, 76, 406],
      [2096, 294, 2096, 406],
    ],
    title: "Female swivel seat to female swivel seat",
  },
  {
    basis:
      "At the 45-degree elbow, measure to the intersection of its centerline and sealing surface.",
    centerlines: [[1740, 235, 2010, 505]],
    endA: [84, 350],
    endB: [1952, 447],
    id: "M03",
    image: m03Image,
    imageHeight: 724,
    imageWidth: 2172,
    sealingFaces: [
      [84, 294, 84, 406],
      [1908, 491, 1996, 403],
    ],
    title: "Straight end to 45-degree elbow",
  },
  {
    basis:
      "At the 90-degree elbow, measure to the intersection of its centerline and sealing surface.",
    centerlines: [[1712, 356, 1712, 730]],
    endA: [68, 298],
    endB: [1712, 660],
    id: "M04",
    image: m04Image,
    imageHeight: 846,
    imageWidth: 1859,
    sealingFaces: [
      [68, 242, 68, 354],
      [1648, 660, 1776, 660],
    ],
    title: "Straight end to 90-degree elbow",
  },
  {
    basis:
      "Measure between the centerline and sealing-surface intersection at each 45-degree elbow. Specify Clocking separately.",
    centerlines: [
      [320, 240, 60, 500],
      [1850, 238, 2120, 508],
    ],
    endA: [124, 436],
    endB: [2048, 436],
    id: "M05",
    image: m05Image,
    imageHeight: 724,
    imageWidth: 2172,
    sealingFaces: [
      [80, 392, 168, 480],
      [2004, 480, 2092, 392],
    ],
    title: "45-degree elbow to 45-degree elbow",
  },
  {
    basis:
      "Measure between the centerline and sealing-surface intersection at each 90-degree elbow. Specify Clocking separately.",
    centerlines: [
      [112, 274, 112, 588],
      [2060, 274, 2060, 588],
    ],
    endA: [112, 522],
    endB: [2060, 522],
    id: "M06",
    image: m06Image,
    imageHeight: 724,
    imageWidth: 2172,
    sealingFaces: [
      [52, 522, 172, 522],
      [2000, 522, 2120, 522],
    ],
    title: "90-degree elbow to 90-degree elbow",
  },
  {
    basis:
      "Measure from flat sealing plane to flat sealing plane, not to the hex or ferrule.",
    endA: [52, 360],
    endB: [2120, 360],
    id: "M07",
    image: m07Image,
    imageHeight: 724,
    imageWidth: 2172,
    sealingFaces: [
      [52, 298, 52, 422],
      [2120, 298, 2120, 422],
    ],
    title: "ORFS flat face to ORFS flat face",
  },
];

const endpointReferences = [
  [
    "Straight male end (JIC, NPT/NPTF, BSPP/BSPT)",
    "The defined end point at the tip of the connection.",
  ],
  [
    "Female swivel with conical seat (JIC, BSPP/BSPT)",
    "The internal sealing surface, not the swivel nut edge.",
  ],
  [
    "Other straight connection",
    "The sealing surface identified by the matching M01-M07 diagram.",
  ],
  [
    "45-degree elbow",
    "The intersection of the elbow centerline and sealing surface.",
  ],
  [
    "90-degree elbow",
    "The intersection of the elbow centerline and sealing surface.",
  ],
  [
    "ORFS male or female flat face",
    "The flat sealing plane at the face of the connection.",
  ],
] as const;

const clockingPresets = [0, 45, 90, 135, 180, 225, 270, 315] as const;

function clampClockingAngle(value: number) {
  return Math.max(0, Math.min(359, Math.round(value)));
}

function clockingPoint(angle: number, radius: number) {
  const radians = (angle * Math.PI) / 180;
  return [500 - Math.sin(radians) * radius, 315 + Math.cos(radians) * radius];
}

function clockingArc(angle: number) {
  const [x, y] = clockingPoint(angle, 130);
  return `M 500 445 A 130 130 0 ${angle > 180 ? 1 : 0} 1 ${x} ${y}`;
}

function ClockingDiagram() {
  const [angle, setAngle] = useState(90);
  const [endAX, endAY] = clockingPoint(angle, 205);
  const formattedAngle = String(angle).padStart(3, "0");

  function updateAngle(value: number) {
    if (Number.isFinite(value)) setAngle(clampClockingAngle(value));
  }

  return (
    <div className="clocking-interactive">
      <div className="clocking-diagram-frame">
        <svg
          aria-label={`Double-elbow Clocking at ${formattedAngle} degrees`}
          className="clocking-diagram"
          role="img"
          viewBox="0 0 1000 620"
        >
          <defs>
            <marker
              id="clocking-arrow"
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
          {clockingPresets.map((preset) => {
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
          <line
            className="clocking-arm end-a"
            x1="500"
            x2={endAX}
            y1="315"
            y2={endAY}
          />
          <circle className="clocking-hub" cx="500" cy="315" r="68" />
          <circle className="clocking-hub-center" cx="500" cy="315" r="24" />
          <circle className="clocking-end" cx="500" cy="520" r="38" />
          <circle className="clocking-end" cx={endAX} cy={endAY} r="38" />
          {angle > 0 ? (
            <path
              className="clocking-angle-arc"
              d={clockingArc(angle)}
              markerEnd="url(#clocking-arrow)"
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
            transform={`translate(${endAX < 480 ? 220 : 780} ${endAY < 215 ? 135 : endAY > 415 ? 455 : 260})`}
          >
            <rect height="46" rx="4" width="330" x="-165" y="-32" />
            <text textAnchor="middle">End A · {formattedAngle}°</text>
          </g>
          <text className="clocking-direction" x="790" y="570">
            CLOCKWISE
          </text>
        </svg>
      </div>

      <div className="clocking-controls">
        <div className="clocking-control-heading">
          <div>
            <label htmlFor="clocking-angle">Clocking angle</label>
            <p>Enter any whole degree from 000 to 359.</p>
          </div>
          <output htmlFor="clocking-angle clocking-slider">
            {formattedAngle}°
          </output>
        </div>
        <div className="clocking-input-row">
          <input
            id="clocking-angle"
            inputMode="numeric"
            max="359"
            min="0"
            onChange={(event) => updateAngle(event.currentTarget.valueAsNumber)}
            step="1"
            type="number"
            value={angle}
          />
          <input
            aria-label="Adjust Clocking angle"
            id="clocking-slider"
            max="359"
            min="0"
            onChange={(event) => updateAngle(event.currentTarget.valueAsNumber)}
            step="1"
            type="range"
            value={angle}
          />
        </div>
        <div aria-label="Clocking angle presets" className="clocking-presets">
          {clockingPresets.map((preset) => (
            <button
              aria-pressed={angle === preset}
              key={preset}
              onClick={() => setAngle(preset)}
              type="button"
            >
              {String(preset).padStart(3, "0")}°
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function meta() {
  return [
    { title: "Hose Assembly Measurement Guide | Hydraulic Supply" },
    {
      name: "description",
      content:
        "Finished hose assembly length endpoints and double-elbow Clocking reference.",
    },
  ];
}

function MeasurementFigure({ method }: { method: MeasurementMethod }) {
  const baseline = method.imageHeight - Math.max(54, method.imageHeight * 0.08);
  const markerId = `dimension-arrow-${method.id}`;
  return (
    <figure className="measurement-method-figure">
      <div
        className="measurement-method-canvas"
        style={{ aspectRatio: `${method.imageWidth} / ${method.imageHeight}` }}
      >
        <img alt="" decoding="async" loading="lazy" src={method.image} />
        <svg
          aria-label={`${method.id} finished overall length endpoints`}
          role="img"
          viewBox={`0 0 ${method.imageWidth} ${method.imageHeight}`}
        >
          <defs>
            <marker
              id={markerId}
              markerHeight="7"
              markerWidth="7"
              orient="auto-start-reverse"
              refX="5"
              refY="5"
              viewBox="0 0 10 10"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          </defs>
          {method.centerlines?.map((segment) => (
            <line
              className="measurement-centerline"
              key={segment.join(":")}
              x1={segment[0]}
              x2={segment[2]}
              y1={segment[1]}
              y2={segment[3]}
            />
          ))}
          {method.sealingFaces?.map((segment) => (
            <line
              className="measurement-sealing-face"
              key={segment.join(":")}
              x1={segment[0]}
              x2={segment[2]}
              y1={segment[1]}
              y2={segment[3]}
            />
          ))}
          <line
            className="measurement-extension-line"
            x1={method.endA[0]}
            x2={method.endA[0]}
            y1={method.endA[1]}
            y2={baseline}
          />
          <line
            className="measurement-extension-line"
            x1={method.endB[0]}
            x2={method.endB[0]}
            y1={method.endB[1]}
            y2={baseline}
          />
          <line
            className="measurement-dimension-line"
            markerEnd={`url(#${markerId})`}
            markerStart={`url(#${markerId})`}
            x1={method.endA[0]}
            x2={method.endB[0]}
            y1={baseline}
            y2={baseline}
          />
          <circle
            className="measurement-endpoint"
            cx={method.endA[0]}
            cy={method.endA[1]}
            r="10"
          />
          <circle
            className="measurement-endpoint"
            cx={method.endB[0]}
            cy={method.endB[1]}
            r="10"
          />
          <text
            className="measurement-end-label"
            x={method.endA[0] + 28}
            y={Math.max(42, method.endA[1] - 24)}
          >
            End A
          </text>
          <text
            className="measurement-end-label"
            textAnchor="end"
            x={method.endB[0] - 28}
            y={Math.max(42, method.endB[1] - 24)}
          >
            End B
          </text>
          <text
            className="measurement-length-label"
            textAnchor="middle"
            x={(method.endA[0] + method.endB[0]) / 2}
            y={baseline - 20}
          >
            Finished Overall Assembly Length
          </text>
        </svg>
      </div>
      <figcaption>
        <span className="measurement-legend-item endpoint">
          Red point: measurement endpoint
        </span>
        <span className="measurement-legend-item centerline">
          Blue: elbow centerline
        </span>
        <span className="measurement-legend-item sealing">
          Orange: sealing surface
        </span>
      </figcaption>
    </figure>
  );
}

export default function AssemblyMeasurementGuide() {
  return (
    <div className="storefront-shell" data-surface="storefront">
      <StorefrontHeader />
      <main className="measurement-guide-page">
        <Link className="product-back-link" to="/">
          <ArrowLeft size={17} /> Back to products
        </Link>

        <header className="measurement-guide-heading">
          <span className="eyebrow">Build a Hose reference</span>
          <h1>Hose Assembly Measurement Guide</h1>
          <p>
            Match the connection geometry, then measure the Finished Overall
            Assembly Length between the two red endpoints shown in the selected
            method.
          </p>
          <nav aria-label="Measurement method shortcuts">
            {methods.map((method) => (
              <a href={`#${method.id}`} key={method.id}>
                {method.id}
              </a>
            ))}
            <a href="#M08">M08 Clocking</a>
          </nav>
        </header>

        <section className="endpoint-reference-section">
          <div className="measurement-section-heading">
            <Ruler size={22} />
            <div>
              <span className="eyebrow">Step 1</span>
              <h2>Identify each measurement endpoint</h2>
            </div>
          </div>
          <div className="endpoint-reference-table" role="table">
            <div className="endpoint-reference-row header" role="row">
              <span role="columnheader">Connection geometry</span>
              <span role="columnheader">Use this endpoint</span>
            </div>
            {endpointReferences.map(([endStyle, endpoint]) => (
              <div className="endpoint-reference-row" key={endStyle} role="row">
                <strong role="cell">{endStyle}</strong>
                <span role="cell">{endpoint}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="measurement-method-section">
          <div className="measurement-section-heading">
            <Ruler size={22} />
            <div>
              <span className="eyebrow">Step 2</span>
              <h2>Select the matching M01-M07 method</h2>
            </div>
          </div>
          <div className="measurement-method-list">
            {methods.map((method) => (
              <article
                className="measurement-method"
                id={method.id}
                key={method.id}
              >
                <header>
                  <strong>{method.id}</strong>
                  <div>
                    <h3>{method.title}</h3>
                    <p>{method.basis}</p>
                  </div>
                </header>
                <MeasurementFigure method={method} />
              </article>
            ))}
          </div>
        </section>

        <section className="clocking-guide" id="M08">
          <div className="measurement-section-heading">
            <RotateCw size={22} />
            <div>
              <span className="eyebrow">M08</span>
              <h2>Double-elbow Clocking</h2>
            </div>
          </div>
          <div className="clocking-guide-layout">
            <ClockingDiagram />
            <div>
              <ol>
                <li>View the assembly from End A toward End B.</li>
                <li>Hold End B at 6 o'clock as 000 degrees.</li>
                <li>
                  Measure the End A angle clockwise from 000 to 359 degrees.
                </li>
              </ol>
              <p>
                Presets are 000, 045, 090, 135, 180, 225, 270 and 315 degrees.
                Any whole degree is accepted.
              </p>
              <div className="measurement-manual-review">
                <CircleAlert size={19} />
                <span>
                  Choose <strong>Not sure</strong> when the correct method or
                  Clocking angle is uncertain. The assembly will be reviewed
                  before quotation.
                </span>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
