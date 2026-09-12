import { Layer } from "effect";
import { AppConfigService } from "../src/server/services/config";
import { SettingsService } from "../src/server/services/settings";
import { SettingsStoreMemoryLive } from "../src/server/services/settings-store";

/**
 * Test environment: explicit config + ephemeral settings store + a
 * SettingsService wired to both. Single instance per helper call — build once
 * per test file and share (e.g. via ManagedRuntime) to keep state.
 */
export const testEnv = (config: Layer.Layer<AppConfigService>) => {
  const base = Layer.mergeAll(config, SettingsStoreMemoryLive);
  const settings = SettingsService.Default.pipe(Layer.provide(base));
  return Layer.mergeAll(base, settings);
};
