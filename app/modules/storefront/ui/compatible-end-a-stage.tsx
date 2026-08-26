import { AlertTriangle, ArrowLeft, Check, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  exactSameHoseEndCandidate,
  filterCompatibleHoseEndCandidates,
  type CompatibleHoseEndCandidate,
  type HoseEndFilters,
} from "../../configurator/domain/compatible-end-a";

type HoseEndLoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { candidates: CompatibleHoseEndCandidate[]; kind: "ready" };

const emptyHoseEndFilters: HoseEndFilters = {
  angle: "",
  connectionDash: "",
  gender: "",
  interfaceGroup: "",
  query: "",
  swivelForm: "",
};

function uniqueCandidateValues(
  candidates: CompatibleHoseEndCandidate[],
  select: (candidate: CompatibleHoseEndCandidate) => string | null,
) {
  return [...new Set(candidates.map(select).filter(Boolean) as string[])].sort(
    (left, right) => left.localeCompare(right, undefined, { numeric: true }),
  );
}

function HoseEndFilterSelect({
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

export function CompatibleHoseEndStage({
  copyFromEndA = null,
  endRole,
  hoseSku,
  onBack,
  onSelect,
  releaseId,
  requestedEndSku,
  selected,
}: {
  copyFromEndA?: CompatibleHoseEndCandidate | null;
  endRole: "A" | "B";
  hoseSku: string;
  onBack: () => void;
  onSelect: (candidate: CompatibleHoseEndCandidate) => void;
  releaseId: string;
  requestedEndSku: string | null;
  selected: CompatibleHoseEndCandidate | null;
}) {
  const stageCopy =
    endRole === "A"
      ? {
          backLabel: "Back to Hose",
          emptyBackLabel: "Choose another Hose",
          returnTarget: "Hose",
          stepNumber: 2,
        }
      : {
          backLabel: "Back to End A",
          emptyBackLabel: "Back to End A",
          returnTarget: "End A",
          stepNumber: 3,
        };
  const [loadState, setLoadState] = useState<HoseEndLoadState>({
    kind: "loading",
  });
  const [filters, setFilters] = useState<HoseEndFilters>(emptyHoseEndFilters);
  const candidates = loadState.kind === "ready" ? loadState.candidates : [];
  const filteredCandidates = useMemo(
    () => filterCompatibleHoseEndCandidates(candidates, filters),
    [candidates, filters],
  );
  const sameAsEndA = exactSameHoseEndCandidate(candidates, copyFromEndA);
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
  const requestedEndCompatible = requestedEndSku
    ? candidates.some((candidate) => candidate.hoseEndSku === requestedEndSku)
    : false;

  useEffect(() => {
    const controller = new AbortController();
    setLoadState({ kind: "loading" });
    setFilters(emptyHoseEndFilters);
    fetch(
      `/api/configurator/compatible-end-a?release=${encodeURIComponent(releaseId)}&hose=${encodeURIComponent(hoseSku)}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Compatible fittings could not be loaded.");
        return (await response.json()) as {
          candidates: CompatibleHoseEndCandidate[];
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
  }, [endRole, hoseSku, releaseId]);

  function updateFilter(key: keyof HoseEndFilters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  return (
    <section
      className="end-a-stage"
      aria-labelledby={`end-${endRole.toLowerCase()}-heading`}
    >
      <header className="end-a-stage-heading">
        <button
          className="button button-secondary button-with-icon"
          onClick={onBack}
          type="button"
        >
          <ArrowLeft aria-hidden="true" size={18} />
          {stageCopy.backLabel}
        </button>
        <div>
          <span className="eyebrow">Step {stageCopy.stepNumber}</span>
          <h2 id={`end-${endRole.toLowerCase()}-heading`}>
            Choose End {endRole}
          </h2>
          <p>
            Every result below is an exact compatible combination for {hoseSku}.
          </p>
        </div>
      </header>

      {loadState.kind === "loading" ? (
        <div className="configurator-stage-prompt" role="status">
          <span>{stageCopy.stepNumber}</span>
          <p>Loading compatible End {endRole} fittings...</p>
        </div>
      ) : loadState.kind === "error" ? (
        <div className="configurator-alert" role="alert">
          <AlertTriangle aria-hidden="true" size={20} />
          <div>
            <strong>Compatible fittings could not be loaded</strong>
            <p>
              {loadState.message} Return to {stageCopy.returnTarget} and try
              again.
            </p>
          </div>
        </div>
      ) : candidates.length === 0 ? (
        <div className="end-a-empty">
          <AlertTriangle aria-hidden="true" size={28} />
          <h3>
            No compatible End {endRole} fittings are published for this hose
          </h3>
          <p>
            Return to {stageCopy.returnTarget} and choose another option. A
            manual quote can be used when the required combination is not
            listed.
          </p>
          <button
            className="button button-secondary button-with-icon"
            onClick={onBack}
            type="button"
          >
            <ArrowLeft aria-hidden="true" size={18} />
            {stageCopy.emptyBackLabel}
          </button>
        </div>
      ) : (
        <>
          {requestedEndSku ? (
            <div className="configurator-alert" role="status">
              <AlertTriangle aria-hidden="true" size={20} />
              <div>
                <strong>
                  {requestedEndCompatible
                    ? `This link points to a compatible End ${endRole}.`
                    : `This End ${endRole} is not compatible with the selected hose.`}
                </strong>
                <p>
                  Requested SKU: {requestedEndSku}. Choose an exact supported
                  result below.
                </p>
              </div>
            </div>
          ) : null}

          {endRole === "B" && sameAsEndA ? (
            <div className="same-as-end-a">
              <div>
                <span className="eyebrow">Exact match available</span>
                <strong>Use the same fitting as End A</strong>
                <p>
                  {sameAsEndA.displayName} · {sameAsEndA.thread} · SKU{" "}
                  {sameAsEndA.hoseEndSku}
                </p>
              </div>
              <button
                className="button button-secondary"
                onClick={() => onSelect(sameAsEndA)}
                type="button"
              >
                Use Same as End A
              </button>
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
              <HoseEndFilterSelect
                label="Interface family"
                onChange={(value) => updateFilter("interfaceGroup", value)}
                options={filterOptions.interfaceGroup}
                value={filters.interfaceGroup ?? ""}
              />
              <HoseEndFilterSelect
                label="Shape"
                onChange={(value) => updateFilter("angle", value)}
                options={filterOptions.angle}
                value={filters.angle ?? ""}
              />
              <HoseEndFilterSelect
                label="Gender"
                onChange={(value) => updateFilter("gender", value)}
                options={filterOptions.gender}
                value={filters.gender ?? ""}
              />
              <HoseEndFilterSelect
                label="Swivel / fixed"
                onChange={(value) => updateFilter("swivelForm", value)}
                options={filterOptions.swivelForm}
                value={filters.swivelForm ?? ""}
              />
              <HoseEndFilterSelect
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
                onClick={() => setFilters(emptyHoseEndFilters)}
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
                <strong>
                  Your selected End {endRole} is hidden by these filters.
                </strong>
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
                onClick={() => setFilters(emptyHoseEndFilters)}
                type="button"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div
              aria-label={`Compatible End ${endRole} fittings`}
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
