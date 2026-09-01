import {
  parseRegistrationConfigurationSnapshot,
  type RegistrationConfigurationSnapshot,
} from "../../configurator/domain/registration-configuration";

export type SavedConfigurationSource = "explicit" | "registration";

export interface SavedConfiguration {
  createdAt: string;
  id: string;
  snapshot: RegistrationConfigurationSnapshot;
  source: SavedConfigurationSource;
  updatedAt: string;
}

export class SavedConfigurationRejected extends Error {}

export function savedConfigurationLabel(
  snapshot: RegistrationConfigurationSnapshot,
) {
  return (
    snapshot.configuration?.hose.familyName ??
    snapshot.selectedSku ??
    "Unfinished hose configuration"
  );
}

export function parseSavedConfigurationSnapshot(serialized: string) {
  try {
    return parseRegistrationConfigurationSnapshot(serialized);
  } catch {
    throw new SavedConfigurationRejected(
      "The saved configuration could not be read.",
    );
  }
}
