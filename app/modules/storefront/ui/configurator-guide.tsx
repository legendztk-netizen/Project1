import { Link } from "react-router";

import { countWord } from "../domain/page-seo";

/** The indexable how-to below the configurator. The steps follow the configurator's own stages. */
export function ConfiguratorGuide({ seriesCount }: { seriesCount: number }) {
  const series =
    seriesCount > 0
      ? `${countWord(seriesCount)} hose series`
      : "the published hose series";
  return (
    <section
      aria-labelledby="configurator-guide-title"
      className="configurator-guide"
    >
      <h2 id="configurator-guide-title">
        How to configure a custom hydraulic hose
      </h2>
      <p>
        Build a Hose turns your specification into a quote request for one
        made-to-order hydraulic hose assembly. You start from {series}, and at
        each end you only see fittings that fit the exact hose you chose, so the
        hose and both ends always belong together. The finished length is
        measured the way our{" "}
        <Link to="/assembly-measurement-guide">assembly measurement guide</Link>{" "}
        shows, and every assembly ships in standard export packaging.
      </p>
      <ol>
        <li>
          <strong>Hose.</strong> Choose the hose series and the exact size by
          dash and inside diameter.
        </li>
        <li>
          <strong>End A.</strong> Search the fittings that fit that hose and
          pick the first end.
        </li>
        <li>
          <strong>End B.</strong> Pick the second end, or use the same fitting
          as End A.
        </li>
        <li>
          <strong>Length.</strong> Set the finished overall assembly length in
          your unit. If both ends are angled, an Orientation step then sets the
          angle between them.
        </li>
        <li>
          <strong>Protection.</strong> Choose installed protection and enter the
          system working pressure and operating temperatures.
        </li>
        <li>
          <strong>Review.</strong> Check every component and measurement, then
          continue to the Quote List to request a quote.
        </li>
      </ol>
    </section>
  );
}
