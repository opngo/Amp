/** Single mount point for every modal; keeps the tree flat and predictable. */

import { useUiStore } from "../../store/useUiStore";
import { EditBookDialog } from "../library/EditBookDialog";
import { ChapterEditorDialog } from "../library/ChapterEditorDialog";
import { CoverPickerDialog } from "../library/CoverPickerDialog";
import { BookmarksDialog } from "../library/BookmarksDialog";
import { NewFolderDialog } from "../library/NewFolderDialog";
import { FolderLockDialog } from "../library/FolderLockDialog";
import { NewPlaylistDialog } from "../playlists/NewPlaylistDialog";
import { SleepTimerDialog } from "../player/SleepTimerDialog";
import { OutputDeviceDialog } from "../player/OutputDeviceDialog";
import { EqDialog } from "../player/EqDialog";
import { ShortcutsDialog } from "../settings/ShortcutsDialog";
import { AboutDialog } from "../settings/AboutDialog";
import { TranscribeDialog } from "../transcripts/TranscribeDialog";
import { HostImportDialog } from "../library/HostImportDialog";

export function DialogHost() {
  const dialog = useUiStore((s) => s.dialog);
  const close = useUiStore((s) => s.closeDialog);

  switch (dialog.kind) {
    case "editBook":
      return <EditBookDialog bookId={dialog.bookId} onClose={close} />;
    case "chapters":
      return <ChapterEditorDialog bookId={dialog.bookId} onClose={close} />;
    case "coverSearch":
      return <CoverPickerDialog bookId={dialog.bookId} target={dialog.target} onClose={close} />;
    case "bookmarks":
      return <BookmarksDialog bookId={dialog.bookId} onClose={close} />;
    case "newFolder":
      return <NewFolderDialog parentId={dialog.parentId ?? null} onClose={close} />;
    case "folderLock":
      return <FolderLockDialog folderId={dialog.folderId} mode={dialog.mode} onClose={close} />;
    case "newPlaylist":
      return <NewPlaylistDialog bookIds={dialog.bookIds ?? []} onClose={close} />;
    case "sleep":
      return <SleepTimerDialog onClose={close} />;
    case "eq":
      return <EqDialog onClose={close} />;
    case "shortcuts":
      return <ShortcutsDialog onClose={close} />;
    case "about":
      return <AboutDialog onClose={close} />;
    case "transcribe":
      return <TranscribeDialog bookId={dialog.bookId} onClose={close} />;
    case "output":
      return <OutputDeviceDialog />;
    case "hostImport":
      return <HostImportDialog target={dialog.target} onClose={close} />;
    default:
      return null;
  }
}
