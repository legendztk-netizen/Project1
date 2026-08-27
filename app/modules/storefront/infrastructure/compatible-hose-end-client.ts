import type { CompatibleHoseEndCandidate } from "../../configurator/domain/compatible-end-a";

export async function fetchCompatibleHoseEndCandidates({
  hoseSku,
  releaseId,
  signal,
}: {
  hoseSku: string;
  releaseId: string;
  signal: AbortSignal;
}) {
  const response = await fetch(
    `/api/configurator/compatible-end-a?release=${encodeURIComponent(releaseId)}&hose=${encodeURIComponent(hoseSku)}`,
    { signal },
  );
  if (!response.ok) {
    throw new Error("Compatible fittings could not be loaded.");
  }
  const body = (await response.json()) as {
    candidates: CompatibleHoseEndCandidate[];
  };
  return body.candidates;
}
