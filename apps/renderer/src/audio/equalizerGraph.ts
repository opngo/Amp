/** Small helpers around the engine's EQ so the UI never touches WebAudio directly. */

import { EQ_PRESETS, autoPreamp, presetById, resampleGains } from "@amp/core";
import { engine } from "./audioEngine";
import type { Settings } from "@amp/core";

export interface EqualizerSettingsShape {
  enabled: boolean;
  gains: number[];
  preamp: number;
  balance: number;
  preset: string;
}

export function applyEqualizer(settings: Settings): void {
  engine.setEq({
    enabled: settings.equalizer.enabled,
    gains: settings.equalizer.gains,
    preamp: settings.equalizer.preamp,
  });
  engine.setBalance(settings.equalizer.balance);
  engine.setChannelMode(settings.audio.channelMode);
}

export { EQ_PRESETS, presetById, resampleGains, autoPreamp };
