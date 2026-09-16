/** Active torrents: progress, speed, pause/resume, import into the library. */

import { useEffect } from "react";
import { Badge, Button, Divider, ProgressBar, Text } from "reshaped";
import { FolderOpen, Import, Pause, Play, RefreshCw, Trash2 } from "lucide-react";
import { formatBytes, formatDuration, humanState, isTorrentFinished } from "@amp/core";
import { useDownloadsStore } from "../../store/useDownloadsStore";
import { useLibraryStore } from "../../store/useLibraryStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { useUiStore } from "../../store/useUiStore";
import { getBridge } from "../../platform/bridge";
import { EmptyState } from "../common/EmptyState";
import { Waveform } from "../common/Waveform";

export function DownloadsView() {
  const downloads = useDownloadsStore((s) => s.downloads);
  const refresh = useDownloadsStore((s) => s.refresh);
  const startPolling = useDownloadsStore((s) => s.startPolling);
  const stopPolling = useDownloadsStore((s) => s.stopPolling);
  const pause = useDownloadsStore((s) => s.pause);
  const resume = useDownloadsStore((s) => s.resume);
  const remove = useDownloadsStore((s) => s.remove);
  const importFinished = useDownloadsStore((s) => s.importFinished);
  const connected = useDownloadsStore((s) => s.connected);
  const connectionDetail = useDownloadsStore((s) => s.connectionDetail);
  const qb = useSettingsStore((s) => s.settings.torrents.qbittorrent);
  const update = useSettingsStore((s) => s.update);
  const importPaths = useLibraryStore((s) => s.importPaths);
  const toast = useUiStore((s) => s.toast);

  useEffect(() => {
    startPolling();
    return () => stopPolling();
  }, [startPolling, stopPolling]);

  return (
    <div style={{ display: "grid", gap: 16, paddingBottom: 20 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
        <div>
          <Text variant="headline-3" weight="bold">
            Downloads
          </Text>
          <Text variant="caption-1" color="neutral-faded">
            {connected ? "qBittorrent is responding" : "qBittorrent not connected"} - {qb.url} - category{" "}
            {qb.category || "none"}
          </Text>
          {!connected && connectionDetail && (
            <Text variant="caption-1" color="neutral-faded">
              {firstSentence(connectionDetail)}
            </Text>
          )}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button size="small" variant="outline" icon={RefreshCw} onClick={() => void refresh()}>
            Refresh
          </Button>
          <Button
            size="small"
            color="primary"
            icon={Import}
            onClick={() =>
              void importFinished().then((added) => {
                if (added > 0) toast({ title: `${added} finished download(s) imported`, tone: "success" });
                else toast({ title: "Nothing new to import yet", tone: "info" });
              })
            }
          >
            Import finished
          </Button>
          <Button
            size="small"
            variant={qb.sequential ? "solid" : "outline"}
            color={qb.sequential ? "primary" : "neutral"}
            onClick={() => void update({ torrents: { qbittorrent: { ...qb, sequential: !qb.sequential } } })}
          >
            Sequential download: {qb.sequential ? "on" : "off"}
          </Button>
        </div>
      </div>

      {downloads.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No downloads yet"
          description="Search for a book and press Download - the magnet goes straight to qBittorrent with sequential downloading enabled, so you can start listening while it finishes."
          actionLabel="Search audiobooks"
          onAction={() => useUiStore.getState().setRoute("search")}
        />
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {downloads.map((item) => (
            <div key={item.hash} className="amp-panel" style={{ padding: 12, display: "grid", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <Waveform active={item.state === "downloading"} bars={4} />
                <Text variant="body-2" weight="semibold" attributes={{ style: { flex: 1, minWidth: 200 } }} maxLines={1}>
                  {item.name}
                </Text>
                <Badge size="small" color={isTorrentFinished(item.state) ? "positive" : "neutral"}>
                  {humanState(item.state)}
                </Badge>
                <Text variant="caption-1" numeric color="neutral-faded">
                  {formatBytes(item.downloaded)} / {formatBytes(item.size)}
                </Text>
                <Text variant="caption-1" numeric color="neutral-faded">
                  {item.downloadSpeed > 0 ? `${formatBytes(item.downloadSpeed)}/s` : ""}{" "}
                  {item.eta && item.eta < 8640000 && item.state === "downloading" ? `- ${formatDuration(item.eta)} left` : ""}
                </Text>
              </div>
              <ProgressBar value={Math.round(item.progress * 100)} />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {isTorrentFinished(item.state) ? (
                  <Button
                    size="small"
                    color="primary"
                    icon={Import}
                    onClick={() =>
                      void importPaths([`${item.savePath}/${item.name}`]).then((result) =>
                        toast({ title: `${result.added} book(s) imported from the download`, tone: "success" }),
                      )
                    }
                  >
                    Import this book
                  </Button>
                ) : item.state === "pausedDL" ? (
                  <Button size="small" variant="outline" icon={Play} onClick={() => void resume(item.hash)}>
                    Resume
                  </Button>
                ) : (
                  <Button size="small" variant="outline" icon={Pause} onClick={() => void pause(item.hash)}>
                    Pause
                  </Button>
                )}
                <Button
                  size="small"
                  variant="ghost"
                  icon={FolderOpen}
                  onClick={() => void getBridge().then((host) => host.torrents.openFolder(item.savePath))}
                >
                  Open folder
                </Button>
                <Button
                  size="small"
                  variant="ghost"
                  color="critical"
                  icon={Trash2}
                  onClick={() => void remove(item.hash, false)}
                >
                  Remove
                </Button>
                <Divider />
                <Text variant="caption-2" color="neutral-faded">
                  {item.savePath}
                </Text>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Hosts can answer with a paragraph; the header only needs the reason. */
function firstSentence(detail: string): string {
  const [sentence] = detail.split(/(?<=[.!?])\s/);
  return sentence.length > 160 ? `${sentence.slice(0, 157)}...` : sentence;
}
