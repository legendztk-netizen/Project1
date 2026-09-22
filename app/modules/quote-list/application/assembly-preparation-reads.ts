import { createD1ConfiguratorRepository } from "../../configurator/infrastructure/d1-configurator-repository";
import { createD1ConfiguratorReferenceRepository } from "../../configurator-reference/infrastructure/d1-configurator-reference-repository";

function memoizeRead<TArgs extends unknown[], TResult>(
  read: (...args: TArgs) => Promise<TResult>,
) {
  const pending = new Map<string, Promise<TResult>>();
  return (...args: TArgs) => {
    const key = JSON.stringify(args);
    let result = pending.get(key);
    if (!result) {
      result = read(...args).catch((error) => {
        pending.delete(key);
        throw error;
      });
      pending.set(key, result);
    }
    return result;
  };
}

// Create once per list refresh, never at module scope or across commands.
export function createAssemblyPreparationReads(database: D1Database) {
  const configurator = createD1ConfiguratorRepository(database);
  const references = createD1ConfiguratorReferenceRepository(database);
  return {
    findSelectedEnds: memoizeRead(configurator.findSelectedEnds),
    hasDerivedAssemblyCombination: memoizeRead(
      configurator.hasDerivedAssemblyCombination,
    ),
    findActiveSnapshot: memoizeRead(references.findActiveSnapshot),
  };
}
