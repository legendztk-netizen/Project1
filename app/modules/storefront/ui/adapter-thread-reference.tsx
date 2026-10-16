import {
  compareDashSizes,
  type DashSize,
} from "../../catalog/domain/dash-size";
import type {
  PublicCatalogFamily,
  PublicCatalogItem,
} from "../../catalog/domain/public-catalog";

interface ThreadColumn {
  interfaceName: string;
  threads: Map<DashSize, string>;
}

/** One column per end interface, listing only the Dash sizes this series offers on that end. */
function threadColumns(family: PublicCatalogFamily) {
  const columns = new Map<string, ThreadColumn>();
  for (const variant of family.variants) {
    const selection = variant.variantSelection;
    if (selection?.kind !== "adapter") continue;
    for (const end of selection.ends) {
      if (!end.interfaceName || !end.dash || !end.thread) continue;
      const column = columns.get(end.interfaceName) ?? {
        interfaceName: end.interfaceName,
        threads: new Map(),
      };
      column.threads.set(end.dash, end.thread);
      columns.set(end.interfaceName, column);
    }
  }
  return [...columns.values()];
}

export function AdapterThreadReference({
  family,
  selected,
}: {
  family: PublicCatalogFamily;
  selected: PublicCatalogItem;
}) {
  const columns = threadColumns(family);
  if (!columns.length) return null;
  const dashes = [
    ...new Set(columns.flatMap((column) => [...column.threads.keys()])),
  ].toSorted(compareDashSizes);
  const selectedEnds =
    selected.variantSelection?.kind === "adapter"
      ? selected.variantSelection.ends
      : [];
  return (
    <div className="thread-reference">
      <h3>Dash to thread reference</h3>
      <p>Sizes offered in this series. The selected sizes are highlighted.</p>
      <table>
        <thead>
          <tr>
            <th scope="col">Dash</th>
            {columns.map((column) => (
              <th key={column.interfaceName} scope="col">
                {column.interfaceName}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dashes.map((dash) => (
            <tr key={dash}>
              <th scope="row">{dash}</th>
              {columns.map((column) => {
                const isSelected = selectedEnds.some(
                  (end) =>
                    end.interfaceName === column.interfaceName &&
                    end.dash === dash,
                );
                return (
                  <td
                    className={isSelected ? "is-selected" : undefined}
                    key={column.interfaceName}
                  >
                    {column.threads.get(dash) ?? "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
