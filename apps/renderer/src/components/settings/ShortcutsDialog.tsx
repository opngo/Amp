/** Full shortcut reference plus a recorder to rebind any action. */

import { useState } from "react";
import { Button, Modal, Text, TextField } from "reshaped";
import { eventToAccelerator, prettyAccelerator, shortcutGroups, SHORTCUT_ACTIONS } from "@amp/core";
import { useSettingsStore } from "../../store/useSettingsStore";
import { useUiStore } from "../../store/useUiStore";
import { Kbd } from "../common/Kbd";

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const toast = useUiStore((s) => s.toast);
  const [recording, setRecording] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const bindings = settings.shortcuts;
  const groups = shortcutGroups();

  const capture = (actionId: string) => (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const accelerator = eventToAccelerator(event.nativeEvent);
    if (!accelerator || ["Ctrl", "Shift", "Alt", "Meta"].includes(accelerator)) return;
    void update({ shortcuts: { [actionId]: accelerator } });
    setRecording(null);
    toast({ title: `Bound ${actionId} to ${prettyAccelerator(accelerator)}`, tone: "success" });
  };

  return (
    <Modal active onClose={onClose} size="760px" padding={6}>
      <Modal.Title>Keyboard shortcuts</Modal.Title>
      <Modal.Subtitle>
        Global shortcuts keep working while Amp sits in the tray. Hold a combo in a field to rebind it.
      </Modal.Subtitle>
      <div style={{ display: "flex", gap: 10, margin: "14px 0" }}>
        <TextField name="filter" placeholder="Filter actions…" value={filter} onChange={({ value }) => setFilter(value)} />
        <Button variant="outline" onClick={() => void update({ shortcuts: {} })}>
          Restore defaults
        </Button>
      </div>
      <div style={{ maxHeight: 460, overflowY: "auto", display: "grid", gap: 18 }}>
        {groups.map((group) => {
          const actions = group.actions.filter((action) =>
            `${action.label} ${action.id}`.toLowerCase().includes(filter.toLowerCase()),
          );
          if (actions.length === 0) return null;
          return (
            <div key={group.group} style={{ display: "grid", gap: 6 }}>
              <Text variant="caption-1" color="neutral-faded" weight="semibold">
                {group.group.toUpperCase()}
              </Text>
              {actions.map((action) => {
                const accelerator = bindings[action.id] ?? action.default;
                return (
                  <div key={action.id} className="amp-row-line" style={{ margin: 0, cursor: "default" }}>
                    <Text variant="body-2" attributes={{ style: { flex: 1 } }}>
                      {action.label}
                      {action.global && (
                        <Text variant="caption-2" color="neutral-faded">
                          {" "}
                          - works in the tray
                        </Text>
                      )}
                    </Text>
                    <input
                      readOnly
                      value={recording === action.id ? "Press keys…" : prettyAccelerator(accelerator)}
                      onFocus={() => setRecording(action.id)}
                      onBlur={() => setRecording(null)}
                      onKeyDown={capture(action.id)}
                      className="amp-kbd"
                      style={{ minWidth: 150, textAlign: "center", background: "transparent", color: "inherit" }}
                    />
                    <Button size="small" variant="ghost" onClick={() => setRecording(action.id)}>
                      Rebind
                    </Button>
                    <Button
                      size="small"
                      variant="ghost"
                      onClick={() => void update({ shortcuts: { [action.id]: SHORTCUT_ACTIONS.find((a) => a.id === action.id)?.default ?? "" } })}
                    >
                      Reset
                    </Button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
        <Text variant="caption-1" color="neutral-faded">
          Press <Kbd accelerator="Space" /> anywhere to play or pause, <Kbd accelerator="B" /> to bookmark.
        </Text>
        <Button color="primary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
