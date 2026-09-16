/** Custom window chrome: brand, inline library search, import and window
 * controls. The bar is the Electron drag region (see .amp-titlebar). */

import { Button, Text, TextField } from "reshaped";
import {
  AudioLines,
  FolderPlus,
  Import,
  Keyboard,
  Minus,
  PanelRight,
  PictureInPicture2,
  Search,
  Settings,
  Square,
  X,
} from "lucide-react";
import { formatTime } from "@amp/core";
import { useLibraryStore } from "../../store/useLibraryStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { useUiStore } from "../../store/useUiStore";
import { bridgeIfReady } from "../../platform/bridge";

export function TitleBar() {
  const filter = useLibraryStore((s) => s.filter);
  const setFilter = useLibraryStore((s) => s.setFilter);
  const importFromDialog = useLibraryStore((s) => s.importFromDialog);
  const toast = useUiStore((s) => s.toast);
  const openDialog = useUiStore((s) => s.openDialog);
  const setRoute = useUiStore((s) => s.setRoute);
  const setMini = useUiStore((s) => s.setMini);
  const playerVisible = useUiStore((s) => s.playerVisible);
  const setPlayerVisible = useUiStore((s) => s.setPlayerVisible);
  const position = usePlayerStore((s) => s.state.position);
  const playing = usePlayerStore((s) => s.state.playing);
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const host = bridgeIfReady();
  const isElectron = host?.platform === "electron";

  return (
    <header className="amp-titlebar">
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--amp-accent)" }}>
        <AudioLines size={18} />
        <Text variant="body-2" weight="semibold">
          Amp
        </Text>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flex: 1, maxWidth: 460 }}>
        <TextField
          name="library-search"
          size="small"
          placeholder="Search your library (title, author, narrator, tag)"
          icon={Search}
          value={filter.text}
          onChange={({ value }) => {
            setFilter({ text: value });
            if (value) setRoute("library");
          }}
          attributes={{ style: { width: "100%" } }}
        />
      </div>

      <div className="amp-no-drag" style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
        <Button size="small" variant="ghost" icon={Import} onClick={() => void importFromDialog("files").then(report(toast))}>
          Import files
        </Button>
        <Button
          size="small"
          variant="ghost"
          icon={FolderPlus}
          onClick={() => void importFromDialog("folder").then(report(toast))}
        >
          Import folder
        </Button>
        <Button
          size="small"
          variant="ghost"
          icon={Keyboard}
          onClick={() => openDialog({ kind: "shortcuts" })}
          attributes={{ "aria-label": "Keyboard shortcuts" }}
        />
        <Button
          size="small"
          variant="ghost"
          icon={PanelRight}
          highlighted={playerVisible}
          onClick={() => setPlayerVisible(!playerVisible)}
          attributes={{ "aria-label": "Toggle player" }}
        />
        <Button
          size="small"
          variant="ghost"
          icon={PictureInPicture2}
          highlighted={settings.window.mini}
          onClick={() => {
            const next = !settings.window.mini;
            setMini(next);
            void update({ window: { mini: next } });
          }}
          attributes={{ "aria-label": "Mini player" }}
        />
        <Button size="small" variant="ghost" icon={Settings} onClick={() => setRoute("settings")} attributes={{ "aria-label": "Settings" }} />

        {playing && (
          <Text variant="caption-1" color="neutral-faded" numeric>
            {formatTime(position)}
          </Text>
        )}

        {isElectron && (
          <div style={{ display: "flex", gap: 2, marginLeft: 8 }}>
            <Button size="small" variant="ghost" icon={Minus} onClick={() => void host?.player.window("minimize")} attributes={{ "aria-label": "Minimize" }} />
            <Button size="small" variant="ghost" icon={Square} onClick={() => void host?.player.window("maximize")} attributes={{ "aria-label": "Maximize" }} />
            <Button size="small" variant="ghost" icon={X} onClick={() => void host?.player.window("close")} attributes={{ "aria-label": "Close" }} />
          </div>
        )}
      </div>
    </header>
  );
}

function report(toast: (t: { title: string; description?: string; tone: "info" | "success" | "danger" }) => void) {
  return (result: { added: number; updated: number; errors: string[] }) => {
    if (result.added === 0 && result.errors.length === 0) return;
    toast({
      title: `${result.added} book(s) added`,
      description: result.updated ? `${result.updated} updated` : result.errors[0],
      tone: result.errors.length ? "danger" : "success",
    });
  };
}
