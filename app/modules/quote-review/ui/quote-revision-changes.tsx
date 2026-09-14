import type { QuoteRevisionDifference } from "../domain/quote-revision-differences";
export function QuoteRevisionChanges({
  changes,
}: {
  changes: QuoteRevisionDifference[];
}) {
  return (
    <section className="quote-revision-changes">
      <h2>Changes from previous quote</h2>
      {changes.length ? (
        changes.map((change) => (
          <details key={change.field}>
            <summary>{change.field}</summary>
            <div className="quote-change-comparison">
              <div>
                <strong>Previous</strong>
                <p>{change.former}</p>
              </div>
              <div>
                <strong>Revised</strong>
                <p>{change.current}</p>
              </div>
            </div>
          </details>
        ))
      ) : (
        <p>No material changes.</p>
      )}
    </section>
  );
}
