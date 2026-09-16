/**
 * Output device picker.
 *
 * The same list Settings shows, put next to the transport where it is actually
 * wanted: switching from headphones to speakers is something you do while
 * listening, not while configuring.
 */

import { useEffect, useState } from "react";
import { Modal, Select } from "reshaped";
import { Headphones } from "lucide-react";
import { useSettingsStore } from "../../store/useSettingsStore";
import { useUiStore } from "../../store/useUiStore";
import { engine } from "../../audio/audioEngine";

export function OutputDeviceDialog() {
  const close = useUiStore((s) => s.closeDialog);
  const toast = useUiStore((s) => s.toast);
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    // Labels are only filled in once the app has permission to know them, which
    // playing a book grants; an empty label still gives a usable entry.
    void navigator.mediaDevices?.enumerateDevices?.().then((all) => setDevices(all.filter((device) => device.kind === "audiooutput")));
  }, []);

  const choose = async (deviceId: string) => {
    await update({ audio: { outputDevice: deviceId } });
    const ok = await engine.setOutputDevice(deviceId);
    toast(
      ok
        ? { title: deviceId ? "Output device changed" : "Back to the system default", tone: "success" }
        : { title: "This system would not switch device", tone: "danger" },
    );
    close();
  };

  return (
    <Modal active onClose={close} size="420px" padding={6}>
      <Modal.Title>Play through</Modal.Title>
      <Modal.Subtitle>Switch output without leaving the player</Modal.Subtitle>
      <div className="amp-dialog">
        <header className="amp-dialog-head">
          <Headphones size={16} />
          <h2 className="amp-dialog-title">Output device</h2>
        </header>
        <Select name="output-device" value={settings.audio.outputDevice} onChange={({ value }) => void choose(value)}>
          <Select.Option value="">System default</Select.Option>
          {devices.map((device, index) => (
            <Select.Option key={device.deviceId || index} value={device.deviceId}>
              {device.label || `Output ${index + 1}`}
            </Select.Option>
          ))}
        </Select>
        {devices.length === 0 && (
          <p className="amp-dialog-note">
            No separate outputs are visible. Start playing a book and this list fills with everything the system offers.
          </p>
        )}
      </div>
    </Modal>
  );
}
