import { useEffect, useMemo, useState } from "react";
import { Button, Divider, Modal, Text } from "reshaped";
import { computeStats } from "@amp/core";
import { getBridge } from "../../platform/bridge";
import { useLibraryStore } from "../../store/useLibraryStore";
import { useUiStore } from "../../store/useUiStore";

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const libraryState = useLibraryStore((s) => s.state);
  const stats = useMemo(() => computeStats(libraryState), [libraryState]);
  const toast = useUiStore((s) => s.toast);
  const [info, setInfo] = useState<{ platform: string; version: string; dataDir?: string; disk?: number } | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [update, setUpdate] = useState<{ available: boolean; version?: string }>({ available: false });

  useEffect(() => {
    void getBridge().then(async (host) => {
      const disk = await host.library.stats();
      setInfo({ platform: host.platform, version: host.version, dataDir: disk.dataDir, disk: disk.diskBytes });
      setLogs(await host.logs());
      setUpdate(await host.updater.check());
    });
  }, []);

  return (
    <Modal active onClose={onClose} size="620px" padding={6}>
      <Modal.Title>Amp {info?.version ?? ""}</Modal.Title>
      <Modal.Subtitle>A small, fast audiobook player for m4b, mp3, mp4, flac and friends</Modal.Subtitle>
      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        <Text variant="body-2">
          {stats.books} books - {stats.chapters} chapters - {stats.hours} hours in the library
        </Text>
        <Text variant="caption-1" color="neutral-faded">
          Host: {info?.platform ?? "…"} | Library file: {info?.dataDir ?? "…"} | On disk:{" "}
          {info ? `${((info.disk ?? 0) / 1024 ** 3).toFixed(2)} GB` : "…"}
        </Text>
        <Divider />
        <Text variant="body-2" weight="semibold">
          What is included
        </Text>
        <Text variant="caption-1" color="neutral-faded">
          Reshaped component system, Lucide icons, adaptive colour from cover art, six visualizer modes with
          stackable contour lines, 10 band equalizer, chapter editor that can write chapters back into the m4b with
          ffmpeg, bookmarks, playlists, queue, torrent search with qBittorrent integration, optional local Whisper
          transcription, tray mode with global hotkeys, Tailscale web server and a Python GUI and TUI.
        </Text>
        <Divider />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button variant="outline" onClick={() => void getBridge().then((host) => host.player.openExternal("https://github.com/"))}>
            Project repository
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              void getBridge()
                .then((host) => host.settings.export())
                .then((json) => {
                  void navigator.clipboard?.writeText(json);
                  toast({ title: "Settings JSON copied to the clipboard", tone: "success" });
                })
            }
          >
            Copy settings JSON
          </Button>
          <Button
            variant="outline"
            disabled={!update.available}
            onClick={() => void getBridge().then((host) => host.updater.open())}
          >
            {update.available ? `Update to ${update.version}` : "Check for updates"}
          </Button>
        </div>
        <div
          style={{
            maxHeight: 130,
            overflowY: "auto",
            padding: 10,
            background: "rgba(0,0,0,0.35)",
            border: "1px solid var(--amp-hairline)",
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            fontSize: 11,
            lineHeight: 1.5,
          }}
        >
          {logs.map((line, index) => (
            <div key={index}>{line}</div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button color="primary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
