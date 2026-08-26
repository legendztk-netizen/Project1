import { AlertTriangle, ArrowLeft, Check, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  filterCompatibleEndACandidates,
  type CompatibleEndACandidate,
  type EndAFilters,
} from "../../configurator/domain/compatible-end-a";

type EndALoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { candidates: CompatibleEndACandidate[]; kind: "ready" };

const emptyEndAFilters: EndAFilters = {
  angle: "",
  connectionDash: "",
  gender: "",
  interfaceGroup: "",
  query: "",
  swivelForm: "",
};

function uniqueCandidateValues(
  candidates: CompatibleEndACandidate[],
  select: (candidate: CompatibleEndACandidate) => string | null,
) {
  return [...new Set(candidates.map(select).filter(Boolean) as string[])].sort(
    (left, right) => left.localeCompare(right, undefined, { numeric: true }),
  );
}

function EndAFilterSelect({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  return (
    <label className="end-a-filter">
      <span>{label}</span>
      <select onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CompatibleEndAStage({
  hoseSku,
  onBack,
  onSelect,
  requestedEndASku,
  selected,
}: {
  hoseSku: string;
  onBack: () => void;
  onSelect: (candidate: CompatibleEndACandidate) => void;
  requestedEndASku: string | null;
  selected: CompatibleEndACandidate | null;
}) {
  const [loadState, setLoadState] = useState<EndALoadState>({
    kind: "loading",
  });
  const [filters, setFilters] = useState<EndAFilters>(emptyEndAFilters);
  const candidates = loadState.kind === "ready" ? loadState.candidates : [];
  const filteredCandidates = useMemo(
    () => filterCompatibleEndACandidates(candidates, filters),
    [candidates, filters],
  );
  const filterOptions = {
    angle: uniqueCandidateValues(candidates, (candidate) => candidate.angle),
    connectionDash: uniqueCandidateValues(
      candidates,
      (candidate) => candidate.connectionDash,
    ),
    gender: uniqueCandidateValues(candidates, (candidate) => candidate.gender),
    interfaceGroup: uniqueCandidateValues(
      candidates,
      (candidate) => candidate.interfaceGroup,
    ),
    swivelForm: uniqueCandidateValues(
      candidates,
      (candidate) => candidate.swivelForm,
    ),
  };
  const selectedHidden = Boolean(
    selected &&
    !filteredCandidates.some(
      (candidate) => candidate.compatibilityId === selected.compatibilityId,
    ),
  );
  const requestedEndACompatible = requestedEndASku
    ? candidates.some((candidate) => candidate.hoseEndSku === requestedEndASku)
    : false;

  useEffect(() => {
    const controller = new AbortController();
    setLoadState({ kind: "loading" });
    setFilters(emptyEndAFilters);
    fetch(
      `/api/configurator/compatible-end-a?hose=${encodeURIComponent(hoseSku)}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Compatible fittings could not be loaded.");
        return (await response.json()) as {
          candidates: CompatibleEndACandidate[];
        };
      })
      .then(({ candidates: loadedCandidates }) => {
        setLoadState({ candidates: loadedCandidates, kind: "ready" });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setLoadState({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "Compatible fittings could not be loaded.",
        });
      });
    return () => controller.abort();
  }, [hoseSku]);

  function updateFilter(key: keyof EndAFilters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  return (
    <section className="end-a-stage" aria-labelledby="end-a-heading">
      <header className="end-a-stage-heading">
        <button
          className="button button-secondary button-with-icon"
          onClick={onBack}
          type="button"
        >
          <ArrowLeft aria-hidden="true" size={18} />
          Back to Hose
        </button>
        <div>
          <span className="eyebrow">Step 2</span>
          <h2 id="end-a-heading">Choose End A</h2>
          <p>
            Every result below is an exact compatible combination for {hoseSku}.
          </p>
        </div>
      </header>

      {loadState.kind === "loading" ? (
        <div className="configurator-stage-prompt" role="status">
          <span>2</span>
          <p>Loading compatible End A fittings...</p>
        </div>
      ) : loadState.kind === "error" ? (
        <div className="configurator-alert" role="alert">
          <AlertTriangle aria-hidden="true" size={20} />
          <div>
            <strong>Compatible fittings could not be loaded</strong>
            <p>{loadState.message} Return to Hose and try again.</p>
          </div>
        </div>
      ) : candidates.length === 0 ? (
        <div className="end-a-empty">
          <AlertTriangle aria-hidden="true" size={28} />
          <h3>No compatible End A fittings are published for this hose</h3>
          <p>
            Return to Hose and choose another size. A manual quote can be used
            when the required combination is not listed.
          </p>
          <button
            className="button button-secondary button-with-icon"
            onClick={onBack}
            type="button"
          >
            <ArrowLeft aria-hidden="true" size={18} />
            Choose another Hose
          </button>
        </div>
      ) : (
        <>
          {requestedEndASku ? (
            <div className="configurator-alert" role="status">
              <AlertTriangle aria-hidden="true" size={20} />
              <div>
                <strong>
                  {requestedEndACompatible
                    ? "This link points to a compatible End A."
                    : "This End A is not compatible with the selected hose."}
                </strong>
                <p>
                  Requested SKU: {requestedEndASku}. Choose an exact supported
                  result below.
                </p>
              </div>
            </div>
          ) : null}

          <div className="end-a-finder">
            <label className="end-a-search">
              <span>Search compatible fittings</span>
              <span className="end-a-search-input">
                <Search aria-hidden="true" size={18} />
                <input
                  onChange={(event) =>
                    updateFilter("query", event.target.value)
                  }
                  placeholder="SKU, alias, thread, or dash"
                  type="search"
                  value={filters.query}
                />
              </span>
            </label>
            <div className="end-a-filter-grid">
              <EndAFilterSelect
                label="Interface family"
                onChange={(value) => updateFilter("interfaceGroup", value)}
                options={filterOptions.interfaceGroup}
                value={filters.interfaceGroup ?? ""}
              />
              <EndAFilterSelect
                label="Shape"
                onChange={(value) => updateFilter("angle", value)}
                options={filterOptions.angle}
                value={filters.angle ?? ""}
              />
              <EndAFilterSelect
                label="Gender"
                onChange={(value) => updateFilter("gender", value)}
                options={filterOptions.gender}
                value={filters.gender ?? ""}
              />
              <EndAFilterSelect
                label="Swivel / fixed"
                onChange={(value) => updateFilter("swivelForm", value)}
                options={filterOptions.swivelForm}
                value={filters.swivelForm ?? ""}
              />
              <EndAFilterSelect
                label="Connection size"
                onChange={(value) => updateFilter("connectionDash", value)}
                options={filterOptions.connectionDash}
                value={filters.connectionDash ?? ""}
              />
            </div>
            <div className="end-a-result-bar" aria-live="polite">
              <span>
                {filteredCandidates.length} of {candidates.length} compatible
                fittings
              </span>
              <button
                onClick={() => setFilters(emptyEndAFilters)}
                type="button"
              >
                Clear filters
              </button>
            </div>
          </div>

          {selectedHidden ? (
            <div className="configurator-alert" role="status">
              <AlertTriangle aria-hidden="true" size={20} />
              <div>
                <strong>Your selected End A is hidden by these filters.</strong>
                <p>The selection is retained. Clear filters to see it again.</p>
              </div>
            </div>
          ) : null}

          {filteredCandidates.length === 0 ? (
            <div className="end-a-empty">
              <Search aria-hidden="true" size={28} />
              <h3>No compatible fittings match these filters</h3>
              <p>
                Clear one or more filters. Unsupported catalogue fittings are
                intentionally excluded.
              </p>
              <button
                className="button button-secondary"
                onClick={() => setFilters(emptyEndAFilters)}
                type="button"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div
              aria-label="Compatible End A fittings"
              className="end-a-results"
            >
              {filteredCandidates.map((candidate) => {
                const active =
                  candidate.compatibilityId === selected?.compatibilityId;
                return (
                  <button
                    aria-label={`Select ${candidate.displayName}, ${candidate.thread}, connection ${candidate.connectionDash}`}
                    aria-pressed={active}
                    className="end-a-choice"
                    data-hose-end-sku={candidate.hoseEndSku}
                    key={candidate.compatibilityId}
                    onClick={() => onSelect(candidate)}
                    type="button"
                  >
                    <span className="end-a-choice-title">
                      <span>
                        <strong>{candidate.displayName}</strong>
                        <small>SKU {candidate.hoseEndSku}</small>
                      </span>
                      {active ? <Check aria-hidden="true" size={19} /> : null}
                    </span>
                    <dl>
                      <div>
                        <dt>Connection</dt>
                        <dd>
                          {candidate.connectionDash} · {candidate.thread}
                        </dd>
                      </div>
                      <div>
                        <dt>Exact standard</dt>
                        <dd>{candidate.connectionStandard}</dd>
                      </div>
                      <div>
                        <dt>Seal</dt>
                        <dd>{candidate.sealingForm}</dd>
                      </div>
                      <div>
                        <dt>Hose tail</dt>
                        <dd>{candidate.hoseTailDash}</dd>
                      </div>
                    </dl>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
