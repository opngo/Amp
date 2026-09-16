/**
 * Equalizer: 10 bands, presets, preamp, L/R balance, channel mode and a small
 * live meter. Values are stored in settings and applied by the audio engine.
 */

import { useState } from "react";
import { Button, Divider, Modal, Select, Slider, Switch, Text, ToggleButton, ToggleButtonGroup } from "reshaped";
import { EQ_BANDS, EQ_PRESETS, autoPreamp, clampGain, dbToGain, presetById } from "@amp/core";
import { useSettingsStore } from "../../store/useSettingsStore";
import { useUiStore } from "../../store/useUiStore";

export function EqDialog({ onClose }: { onClose: () => void }) {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const toast = useUiStore((s) => s.toast);
  const eq = settings.equalizer;
  const [band, setBand] = useState<number | null>(null);
  const selectBand = (index: number) => setBand(index);

  const setGain = (index: number, value: number) => {
    const gains = [...eq.gains];
    gains[index] = clampGain(value);
    void update({ equalizer: { gains, enabled: true, preset: "custom" } });
  };

  const preampDb = autoPreamp(eq.gains, eq.preamp);

  return (
    <Modal active onClose={onClose} size="760px" padding={6} className="amp-eq-modal">
      <Modal.Title>Equalizer</Modal.Title>
      <Modal.Subtitle>
        Ten bands from 32 Hz to 16 kHz. The preamp is automatic so boosted bands never clip.
      </Modal.Subtitle>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "14px 0" }}>
        <Switch name="eqEnabled" checked={eq.enabled} onChange={({ checked }) => void update({ equalizer: { enabled: checked } })}>
          Equalizer enabled
        </Switch>
        <Select
          name="preset"
          value={eq.preset}
          onChange={({ value }) => {
            if (value === "custom") return;
            const preset = presetById(value);
            void update({
              equalizer: { preset: value, gains: preset.gains, preamp: preset.preamp ?? 0, enabled: true },
            });
          }}
        >
          <Select.Option value="custom">Custom curve</Select.Option>
          {EQ_PRESETS.map((preset) => (
            <Select.Option key={preset.id} value={preset.id}>
              {preset.name}
            </Select.Option>
          ))}
        </Select>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${EQ_BANDS.length}, minmax(0, 1fr))`,
          gap: 6,
          alignItems: "end",
          padding: "14px 4px",
          borderRadius: "var(--amp-radius)",
          background: "var(--amp-fill)",
          border: "1px solid var(--amp-hairline)",
        }}
      >
        {EQ_BANDS.map((frequency, index) => (
          <div key={frequency} style={{ display: "grid", justifyItems: "center", gap: 6 }}>
            <Text variant="caption-2" numeric color="neutral-faded">
              {eq.gains[index] > 0 ? "+" : ""}
              {eq.gains[index].toFixed(1)}
            </Text>
            <Slider
              name={`band-${frequency}`}
              min={-12}
              max={12}
              step={0.5}
              value={eq.gains[index]}
              orientation="vertical"
              onChange={({ value }) => setGain(index, value)}
            />
            <button
              onClick={() => selectBand(index)}
              style={{ background: "none", border: 0, color: "inherit", cursor: "pointer" }}
            >
              <Text variant="caption-2" color="neutral-faded">
                {frequency >= 1000 ? `${frequency / 1000}k` : frequency}
              </Text>
            </button>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
        <div>
          <Text variant="caption-1" color="neutral-faded">
            Preamp (dB, automatic headroom)
          </Text>
          <Slider
            name="preamp"
            min={-12}
            max={6}
            step={0.5}
            value={preampDb}
            onChange={({ value }) => void update({ equalizer: { preamp: value - autoPreamp(eq.gains, 0) } })}
          />
        </div>
        <div>
          <Text variant="caption-1" color="neutral-faded">
            Balance (left / right)
          </Text>
          <Slider
            name="balance"
            min={-1}
            max={1}
            step={0.05}
            value={eq.balance}
            onChange={({ value }) => void update({ equalizer: { balance: value } })}
          />
        </div>
      </div>

      <Divider />
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginTop: 12 }}>
        <Text variant="caption-1" color="neutral-faded">
          Channels
        </Text>
        <ToggleButtonGroup
          value={[settings.audio.channelMode]}
          selectionMode="single"
          onChange={({ value }) =>
            void update({ audio: { channelMode: (value[0] as "stereo" | "mono" | "swap") ?? "stereo" } })
          }
        >
          <ToggleButton value="stereo">Stereo</ToggleButton>
          <ToggleButton value="mono">Mono</ToggleButton>
          <ToggleButton value="swap">Swap L/R</ToggleButton>
        </ToggleButtonGroup>
        <Switch
          name="normalize"
          checked={settings.audio.normalize}
          onChange={({ checked }) => void update({ audio: { normalize: checked } })}
        >
          Normalize loudness
        </Switch>
        <Text variant="caption-2" color="neutral-faded">
          {band !== null ? `Selected band: ${EQ_BANDS[band]} Hz (${dbToGain(eq.gains[band]).toFixed(2)}x gain)` : "Tap a slider to inspect a band"}
        </Text>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
        <Button
          variant="ghost"
          onClick={() => void update({ equalizer: { gains: new Array(EQ_BANDS.length).fill(0), preset: "flat" } })}
        >
          Reset to flat
        </Button>
        <Button
          color="primary"
          onClick={() => {
            toast({
              title: eq.enabled ? "Equalizer curve saved" : "Equalizer is off",
              tone: "success",
            });
            onClose();
          }}
        >
          Done
        </Button>
      </div>
    </Modal>
  );
}
