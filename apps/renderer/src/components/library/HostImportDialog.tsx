/**
 * Import by path, for clients that have no native file picker.
 *
 * When Amp runs in a browser the library lives on the machine serving it, so the
 * paths have to be typed. This dialog collects them and calls the same import the
 * desktop picker uses: the host does the scanning, the browser only sends strings.
 */

import { useState } from "react";
import { Alert, Button, FormControl, Modal, Text, TextField } from "reshaped";
import { Layers } from "lucide-react";
import { useLibraryStore } from "../../store/useLibraryStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { useUiStore } from "../../store/useUiStore";

export function HostImportDialog({
  target,
  onClose,
}: {
  target: "files" | "folder";
  onClose: () => void;
}) {
  const importPaths = useLibraryStore((s) => s.importPaths);
  const groupByDefault = useSettingsStore((s) => s.settings.library.groupFolders);
  const toast = useUiStore((s) => s.toast);
  const [value, setValue] = useState("");
  const [asOneBook, setAsOneBook] = useState(groupByDefault);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paths = value
    .split(/[\n,;]+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const run = async () => {
    if (paths.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await importPaths(paths, null, {
        groupFolders: target === "folder" ? asOneBook : false,
      });
      const failed = result.errors.filter(Boolean);
      toast({
        title: `${result.added} added - ${result.updated} updated`,
        description: failed[0] ?? (paths.length > 1 ? `${paths.length} paths` : paths[0]),
        tone: result.added || result.updated ? "success" : failed.length ? "danger" : "info",
      });
      if (failed.length) setError(failed.join("\n"));
      else onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The host refused that path.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal active onClose={onClose} size="520px" padding={6}>
      <Modal.Title>{target === "folder" ? "Import a folder on the host" : "Import files on the host"}</Modal.Title>
      <Modal.Subtitle>
        Amp plays what is already on the machine running the server. Paste the absolute path and the host scans it -
        nothing is copied.
      </Modal.Subtitle>

      <div style={{ display: "grid", gap: 14, marginTop: 16 }}>
        <FormControl>
          <FormControl.Label>{target === "folder" ? "Folder path" : "File paths, one per line"}</FormControl.Label>
          <TextField
            name="host-paths"
            value={value}
            multiline
            placeholder={target === "folder" ? "/Users/you/Audiobooks" : "/Users/you/Audiobooks/book.m4b"}
            onChange={({ value: next }) => setValue(next)}
            attributes={{
              autoFocus: true,
              style: { resize: "vertical", minHeight: target === "files" ? 96 : 72 },
              onKeyDown: (event: React.KeyboardEvent) => {
                if (event.key === "Enter" && !event.shiftKey) void run();
              },
            }}
          />
          <FormControl.Helper>
            A folder of mp3 or mp4 tracks becomes one book with a chapter per file, or one book per file - the switch
            below decides for this import.
          </FormControl.Helper>
        </FormControl>

        {target === "folder" && (
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={asOneBook}
              onChange={(event) => setAsOneBook(event.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span style={{ display: "grid", gap: 2 }}>
              <Text variant="body-2" weight="medium">
                Treat the tracks as one book
              </Text>
              <Text variant="caption-1" color="neutral-faded">
                One book, with a chapter for every file. Untick it and each file becomes its own book.
              </Text>
            </span>
          </label>
        )}

        {paths.length > 1 && (
          <Alert color="neutral">
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Layers size={15} />
              {`${paths.length} paths will be scanned in one pass.`}
            </span>
          </Alert>
        )}

        {error && <Alert color="critical">{error}</Alert>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button color="primary" loading={busy} disabled={paths.length === 0} onClick={() => void run()}>
            {target === "folder" ? "Scan folder" : "Scan files"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
