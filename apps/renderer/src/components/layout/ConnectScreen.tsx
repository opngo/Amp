/**
 * Shown when the renderer runs in a browser with no Amp server behind it.
 *
 * There is no demo library in Amp, by design: rather than filling the window
 * with invented books, the app says what it needs and how to get it - the
 * desktop app for local files, or the server URL for a remote library.
 */

import { useState } from "react";
import { Button, Text, TextField } from "reshaped";
import { HardDrive, Link2, MonitorPlay } from "lucide-react";
import { AmpLogo } from "@amp/ui";
import { saveConnection } from "../../platform/bridge";
import { useUiStore } from "../../store/useUiStore";

export function ConnectScreen() {
  const toast = useUiStore((s) => s.toast);
  const [value, setValue] = useState("");

  const connect = () => {
    const raw = value.trim();
    if (!raw) return;
    let url = raw;
    let token = "";
    try {
      const parsed = new URL(raw.includes("://") ? raw : `http://${raw}`);
      url = `${parsed.protocol}//${parsed.host}`;
      token = parsed.searchParams.get("token") ?? "";
    } catch {
      toast({ title: "That does not look like a server address", tone: "danger" });
      return;
    }
    saveConnection({ url, token });
    window.location.reload();
  };

  return (
    <div className="amp-drop-zone" style={{ border: "0", background: "var(--amp-page)" }}>
      <div style={{ maxWidth: 460, display: "grid", gap: 18, justifyItems: "center", padding: 24 }}>
        <AmpLogo size={54} title="Amp" />
        <div style={{ display: "grid", gap: 6, justifyItems: "center", textAlign: "center" }}>
          <Text variant="title-4" weight="bold">
            This window is not connected
          </Text>
          <Text variant="body-2" color="neutral-faded">
            Amp reads the audiobooks on the machine running it. Open it through the desktop app, or point this page at an
            Amp server.
          </Text>
        </div>

        <div style={{ display: "grid", gap: 10, width: "100%" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <MonitorPlay size={17} style={{ color: "var(--amp-text-2)", marginTop: 2 }} />
            <Text variant="body-2" color="neutral-faded">
              Desktop app: <strong>npm run dev:desktop</strong> or an installer from the releases page.
            </Text>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <HardDrive size={17} style={{ color: "var(--amp-text-2)", marginTop: 2 }} />
            <Text variant="body-2" color="neutral-faded">
              Server: turn it on in Settings, Server, then open the URL it gives you - including the token.
            </Text>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <Link2 size={17} style={{ color: "var(--amp-text-2)", marginTop: 2 }} />
            <Text variant="body-2" color="neutral-faded">
              Python: <strong>python python/server.py --root apps/renderer/dist --print-url</strong> prints a ready URL.
            </Text>
          </div>
        </div>

        <form
          style={{ display: "flex", gap: 8, width: "100%" }}
          onSubmit={(event) => {
            event.preventDefault();
            connect();
          }}
        >
          <TextField
            name="server"
            size="small"
            placeholder="http://100.64.0.1:7777?token=..."
            value={value}
            onChange={({ value: next }) => setValue(next)}
            attributes={{ style: { flex: 1 } }}
          />
          <Button size="small" color="primary" type="submit">
            Connect
          </Button>
        </form>
      </div>
    </div>
  );
}
