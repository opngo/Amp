/** First run: import, what Amp understands, and the shortcut for later. */

import { Button, Text } from "reshaped";
import { FolderPlus, FilePlus2, Keyboard, Music4, Sparkles } from "lucide-react";
import { useLibraryStore } from "../../store/useLibraryStore";
import { useUiStore } from "../../store/useUiStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { Kbd } from "../common/Kbd";

export function WelcomeOverlay() {
  const importFromDialog = useLibraryStore((s) => s.importFromDialog);
  const openDialog = useUiStore((s) => s.openDialog);
  const toast = useUiStore((s) => s.toast);
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        placeItems: "center",
        background: "radial-gradient(60% 60% at 50% 20%, color-mix(in srgb, var(--amp-accent) 18%, transparent), transparent 70%)",
        zIndex: 30,
        padding: 24,
        pointerEvents: "none",
      }}
    >
      <div
        className="amp-panel"
        style={{ padding: 28, maxWidth: 620, display: "grid", gap: 16, pointerEvents: "auto", animation: "amp-rise 300ms var(--amp-ease) both" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--amp-accent)" }}>
          <Sparkles size={20} />
          <Text variant="headline-3" weight="bold">
            Welcome to Amp
          </Text>
        </div>
        <Text variant="body-1" color="neutral-faded">
          Amp plays m4b, mp3, mp4, m4a, flac, ogg and opus. Import a folder and it works out the rest: embedded
          chapters for m4b, one book with many chapters when a folder holds a pile of tracks - or separate books if
          you prefer.
        </Text>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          <div className="amp-stat">
            <div style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--amp-accent)" }}>
              <FolderPlus size={15} />
              <Text variant="body-2" weight="semibold">
                Import a folder
              </Text>
            </div>
            <Text variant="caption-1" color="neutral-faded">
              Whole series at once. Sub-folders are scanned too.
            </Text>
          </div>
          <div className="amp-stat">
            <div style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--amp-accent)" }}>
              <Music4 size={15} />
              <Text variant="body-2" weight="semibold">
                Group or split
              </Text>
            </div>
            <Text variant="caption-1" color="neutral-faded">
              Currently {settings.library.groupFolders ? "grouping sibling tracks into one book" : "importing every file as its own book"}.
            </Text>
            <Button
              size="small"
              variant="ghost"
              onClick={() => void update({ library: { groupFolders: !settings.library.groupFolders } })}
            >
              Switch to {settings.library.groupFolders ? "separate books" : "one book per folder"}
            </Button>
          </div>
          <div className="amp-stat">
            <div style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--amp-accent)" }}>
              <Keyboard size={15} />
              <Text variant="body-2" weight="semibold">
                Keyboard first
              </Text>
            </div>
            <Text variant="caption-1" color="neutral-faded">
              <Kbd accelerator="Ctrl+O" /> import, <Kbd accelerator="Space" /> play, <Kbd accelerator="Ctrl+Shift+M" />{" "}
              mini player.
            </Text>
            <Button size="small" variant="ghost" onClick={() => openDialog({ kind: "shortcuts" })}>
              See all shortcuts
            </Button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button
            color="primary"
            icon={FolderPlus}
            onClick={() =>
              void importFromDialog("folder").then((result) => {
                if (result.added) toast({ title: `${result.added} book(s) imported`, tone: "success" });
              })
            }
          >
            Add a folder
          </Button>
          <Button
            variant="outline"
            icon={FilePlus2}
            onClick={() =>
              void importFromDialog("files").then((result) => {
                if (result.added) toast({ title: `${result.added} book(s) imported`, tone: "success" });
              })
            }
          >
            Add files
          </Button>
          <Button variant="ghost" onClick={() => openDialog({ kind: "shortcuts" })}>
            Shortcuts
          </Button>
        </div>
      </div>
    </div>
  );
}
