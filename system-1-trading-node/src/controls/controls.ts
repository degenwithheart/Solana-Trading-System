import type { SettingsRepo } from "../db/repositories/settings";
import type { TradingConfig } from "../../../shared/types";

export type Controls = TradingConfig["controls"];

const keys = {
  pauseDiscovery: "controls.pauseDiscovery",
  pauseEntries: "controls.pauseEntries",
  pauseExits: "controls.pauseExits",
  killSwitch: "controls.killSwitch",
  activeProfile: "controls.activeProfile"
} as const;

export class ControlsRepo {
  constructor(private readonly settings: SettingsRepo) {}

  load(defaults: Controls): Controls {
    return {
      pauseDiscovery: readBool(this.settings.get(keys.pauseDiscovery), defaults.pauseDiscovery),
      pauseEntries: readBool(this.settings.get(keys.pauseEntries), defaults.pauseEntries),
      pauseExits: readBool(this.settings.get(keys.pauseExits), defaults.pauseExits),
      killSwitch: readBool(this.settings.get(keys.killSwitch), defaults.killSwitch)
    };
  }

  set(patch: Partial<Controls>): void {
    if (patch.pauseDiscovery !== undefined) this.settings.set(keys.pauseDiscovery, String(patch.pauseDiscovery));
    if (patch.pauseEntries !== undefined) this.settings.set(keys.pauseEntries, String(patch.pauseEntries));
    if (patch.pauseExits !== undefined) this.settings.set(keys.pauseExits, String(patch.pauseExits));
    if (patch.killSwitch !== undefined) this.settings.set(keys.killSwitch, String(patch.killSwitch));
  }

  getActiveProfile(defaultProfile: string): string {
    return this.settings.get(keys.activeProfile) ?? defaultProfile;
  }

  setActiveProfile(name: string): void {
    this.settings.set(keys.activeProfile, name);
  }
}

function readBool(raw: string | null, fallback: boolean): boolean {
  if (raw === null) return fallback;
  const v = raw.toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  return fallback;
}

