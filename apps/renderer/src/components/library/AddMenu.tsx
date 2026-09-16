/**
 * The one way into the library.
 *
 * Amp used to show a separate "Add folder" and "Add files" button wherever
 * importing was possible, which filled the chrome with two buttons for one
 * idea. This is a single plus button that opens the choices.
 *
 * The folder choices are the interesting part: whether a folder of tracks is
 * one audiobook with chapters or several separate audiobooks is a property of
 * the folder you are about to add, not a global preference to hunt for in
 * Settings. Both are offered here, and the choice is also written back to
 * Settings so the next import starts from what you picked last.
 */

import { useState } from "react";
import { ChevronDown, FolderPlus, FilePlus2, RefreshCw, Disc3, ListMusic, Check } from "lucide-react";
import { Divider, DropdownMenu } from "reshaped";
import { useLibraryStore } from "../../store/useLibraryStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { useUiStore } from "../../store/useUiStore";

type AddVariant = "primary" | "toolbar";

export function AddMenu({
  variant = "toolbar",
  label = "Add",
  align = "bottom-end",
}: {
  variant?: AddVariant;
  label?: string;
  align?: "bottom-start" | "bottom-end";
}) {
  const [open, setOpen] = useState(false);
  const importFromDialog = useLibraryStore((s) => s.importFromDialog);
  const importPaths = useLibraryStore((s) => s.importPaths);
  const rescan = useLibraryStore((s) => s.rescan);
  const groupFolders = useSettingsStore((s) => s.settings.library.groupFolders);
  const updateSettings = useSettingsStore((s) => s.update);
  const openDialog = useUiStore((s) => s.openDialog);
  const toast = useUiStore((s) => s.toast);

  const addFolder = async (asOneBook: boolean) => {
    setOpen(false);
    if (asOneBook !== groupFolders) await updateSettings({ library: { groupFolders: asOneBook } });
    const result = await importFromDialog("folder");
    if (result.added) toast({ title: `${result.added} book(s) added`, tone: "success" });
  };

  const addFiles = async () => {
    setOpen(false);
    const result = await importFromDialog("files");
    if (result.added) toast({ title: `${result.added} book(s) added`, tone: "success" });
  };

  return (
    <DropdownMenu
      active={open}
      onClose={() => setOpen(false)}
      position={align}
      fallbackPositions={align === "bottom-end" ? ["bottom-start", "top-end"] : ["bottom-end", "top-start"]}
      trapFocusMode="action-menu"
    >
      <DropdownMenu.Trigger>
        {(attributes) => (
          <button
            {...attributes}
            type="button"
            className={variant === "primary" ? "amp-add-primary" : "amp-chip"}
            onClick={() => setOpen((value) => !value)}
          >
            <FolderPlus size={variant === "primary" ? 16 : 14} />
            {label}
            <ChevronDown size={13} className="amp-add-caret" />
          </button>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        <DropdownMenu.Item icon={Disc3} onClick={() => void addFolder(true)}>
          {groupFolders ? (
            <span className="amp-menu-row">
              <span>Add folder - one audiobook</span>
              <Check size={13} />
            </span>
          ) : (
            "Add folder - one audiobook"
          )}
        </DropdownMenu.Item>
        <DropdownMenu.Item icon={ListMusic} onClick={() => void addFolder(false)}>
          {!groupFolders ? (
            <span className="amp-menu-row">
              <span>Add folder - separate books</span>
              <Check size={13} />
            </span>
          ) : (
            "Add folder - separate books"
          )}
        </DropdownMenu.Item>
        <Divider />
        <DropdownMenu.Item icon={FilePlus2} onClick={() => void addFiles()}>
          Add files
        </DropdownMenu.Item>
        <DropdownMenu.Item
          icon={RefreshCw}
          onClick={() => {
            setOpen(false);
            void rescan().then((result) => toast({ title: `${result.books.length} book(s) checked`, tone: "success" }));
          }}
        >
          Look for new files
        </DropdownMenu.Item>
        <Divider />
        <DropdownMenu.Item
          icon={FolderPlus}
          onClick={() => {
            setOpen(false);
            void importPaths;
            openDialog({ kind: "newFolder" });
          }}
        >
          New folder
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}
