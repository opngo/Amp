/** Sleep timer with presets, live countdown and "end of chapter" mode. */

import { Button, Modal, Text, ToggleButtonGroup, ToggleButton } from "reshaped";
import { SLEEP_PRESETS, sleepLabel } from "@amp/core";
import { usePlayerStore } from "../../store/usePlayerStore";

export function SleepTimerDialog({ onClose }: { onClose: () => void }) {
  const { state, setSleep, toggleStopAfterChapter } = usePlayerStore();
  const value = state.sleepRemaining !== null ? String(Math.round(state.sleepRemaining / 60)) : "off";

  return (
    <Modal active onClose={onClose} size="480px" padding={6}>
      <Modal.Title>Sleep timer</Modal.Title>
      <Modal.Subtitle>Fades the audio out gently instead of cutting off mid sentence</Modal.Subtitle>
      <div style={{ display: "grid", gap: 16, marginTop: 16 }}>
        <ToggleButtonGroup
          value={[value === "off" ? "off" : "custom"]}
          selectionMode="single"
          onChange={({ value: selection }) => {
            if (selection[0] === "off") setSleep(null);
          }}
        >
          <ToggleButton value="custom">
            {state.sleepRemaining !== null ? `Running: ${sleepLabel(state.sleepRemaining)}` : "No timer running"}
          </ToggleButton>
        </ToggleButtonGroup>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {SLEEP_PRESETS.map((minutes) => (
            <Button key={minutes} variant="outline" size="small" onClick={() => setSleep(minutes)}>
              {minutes} min
            </Button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <Text variant="body-2" weight="semibold">
              Stop at the end of this chapter
            </Text>
            <Text variant="caption-1" color="neutral-faded">
              Great for "one more chapter"
            </Text>
          </div>
          <Button
            variant={state.stopAfterChapter ? "solid" : "outline"}
            color={state.stopAfterChapter ? "primary" : "neutral"}
            onClick={toggleStopAfterChapter}
          >
            {state.stopAfterChapter ? "Enabled" : "Disabled"}
          </Button>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <Button variant="ghost" onClick={() => setSleep(null)}>
            Cancel timer
          </Button>
          <Button color="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
