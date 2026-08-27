import type { DashSize } from "../../catalog/domain/dash-size";
import type { HoseConfigurationDraft } from "./hose-configuration-draft";

export interface CompatibleHoseEndCandidate {
  aliases: string[];
  angle: string;
  assemblyWorkingBar: number | null;
  compatibilityId: string;
  connectionDash: DashSize | null;
  connectionStandard: string;
  displayName: string;
  ferrule: {
    hoseConstruction: string;
    hoseTailDash: DashSize | null;
    series: string;
    skiveRequirement: string;
    sku: string;
  };
  gender: string;
  hoseEndSku: string;
  hoseTailDash: DashSize | null;
  interfaceFamily: string;
  interfaceGroup: string;
  maximumWorkingBar: number | null;
  sealingForm: string;
  swivelForm: string;
  thread: string;
}

export interface HoseEndFilters {
  angle?: string;
  connectionDash?: string;
  gender?: string;
  interfaceGroup?: string;
  query?: string;
  swivelForm?: string;
}

type ConfiguredHoseEnd = NonNullable<HoseConfigurationDraft["endA"]>;

export function isExactCompatibleCandidate(
  candidate: CompatibleHoseEndCandidate,
  selected: CompatibleHoseEndCandidate | ConfiguredHoseEnd,
) {
  const selectedHoseEndSku =
    "hoseEndSku" in selected ? selected.hoseEndSku : selected.hoseEnd.sku;
  return (
    candidate.compatibilityId === selected.compatibilityId &&
    candidate.hoseEndSku === selectedHoseEndSku &&
    candidate.ferrule.sku === selected.ferrule.sku
  );
}

function matches(value: string, filter?: string) {
  return !filter || value === filter;
}

export function filterCompatibleHoseEndCandidates(
  candidates: CompatibleHoseEndCandidate[],
  filters: HoseEndFilters,
) {
  const query = filters.query?.trim().toLocaleLowerCase() ?? "";
  return candidates.filter((candidate) => {
    if (!matches(candidate.interfaceGroup, filters.interfaceGroup))
      return false;
    if (!matches(candidate.angle, filters.angle)) return false;
    if (!matches(candidate.gender, filters.gender)) return false;
    if (!matches(candidate.swivelForm, filters.swivelForm)) return false;
    if (!matches(candidate.connectionDash ?? "", filters.connectionDash)) {
      return false;
    }
    if (!query) return true;
    return [
      candidate.hoseEndSku,
      candidate.displayName,
      candidate.interfaceFamily,
      candidate.connectionStandard,
      candidate.thread,
      candidate.sealingForm,
      candidate.connectionDash ?? "",
      candidate.hoseTailDash ?? "",
      ...candidate.aliases,
    ]
      .join(" ")
      .toLocaleLowerCase()
      .includes(query);
  });
}

function configuredEnd(candidate: CompatibleHoseEndCandidate) {
  return {
    assemblyWorkingBar: candidate.assemblyWorkingBar,
    compatibilityId: candidate.compatibilityId,
    ferrule: { ...candidate.ferrule },
    hoseEnd: {
      aliases: [...candidate.aliases],
      angle: candidate.angle,
      connectionDash: candidate.connectionDash,
      connectionStandard: candidate.connectionStandard,
      displayName: candidate.displayName,
      gender: candidate.gender,
      hoseTailDash: candidate.hoseTailDash,
      interfaceFamily: candidate.interfaceFamily,
      interfaceGroup: candidate.interfaceGroup,
      maximumWorkingBar: candidate.maximumWorkingBar,
      sealingForm: candidate.sealingForm,
      sku: candidate.hoseEndSku,
      swivelForm: candidate.swivelForm,
      thread: candidate.thread,
    },
  };
}

export function attachEndAToDraft(
  draft: HoseConfigurationDraft,
  candidate: CompatibleHoseEndCandidate,
): HoseConfigurationDraft {
  return {
    ...draft,
    endA: configuredEnd(candidate),
  };
}

export function attachEndBToDraft(
  draft: HoseConfigurationDraft,
  candidate: CompatibleHoseEndCandidate,
): HoseConfigurationDraft {
  return {
    ...draft,
    endB: configuredEnd(candidate),
  };
}

export function exactSameHoseEndCandidate(
  candidates: CompatibleHoseEndCandidate[],
  endA: CompatibleHoseEndCandidate | null,
) {
  if (!endA) return null;
  return (
    candidates.find((candidate) => candidate.hoseEndSku === endA.hoseEndSku) ??
    null
  );
}
