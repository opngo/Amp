/**
 * The right-click menu for a folder.
 *
 * Same panel as the book menu, different job: a folder is a shelf, so what it
 * can do is be renamed, coloured, nested, locked, and deleted. Nesting is done
 * from here rather than by dragging, because the list is a list: "Move inside >"
 * is one click and it works with the keyboard.
 */

import { useEffect, useRef } from "react";
import {
  Check,
  FolderInput,
  FolderPlus,
  Lock,
  LockOpen,
  Pencil,
  Play,
  Trash2,
  ArrowUpFromLine,
} from "lucide-react";
import { COLOR_TAGS } from "@amp/core";
import { useLibraryStore } from "../../store/useLibraryStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useUiStore } from "../../store/useUiStore";
import { colorHex } from "../layout/Sidebar";
import { nestableInto } from "@amp/core";

export function FolderContextMenu() {
  const contextMenu = useUiStore((s) => s.contextMenu);
  const close = useUiStore((s) => s.closeContextMenu);
  const openDialog = useUiStore((s) => s.openDialog);
  const toast = useUiStore((s) => s.toast);
  const unlocked = useUiStore((s) => s.unlocked);
  const folders = useLibraryStore((s) => s.state.folders);
  const books = useLibraryStore((s) => s.state.books);
  const renameFolder = useLibraryStore((s) => s.renameFolder);
  const setFolderColor = useLibraryStore((s) => s.setFolderColor);
  const setFolderLock = useLibraryStore((s) => s.setFolderLock);
  const moveFolder = useLibraryStore((s) => s.moveFolder);
  const removeFolder = useLibraryStore((s) => s.removeFolder);
  const playQueue = usePlayerStore((s) => s.playQueue);

  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!contextMenu || contextMenu.kind !== "folder") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (panel.current && !panel.current.contains(event.target as Node)) close();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [contextMenu, close]);

  if (!contextMenu || contextMenu.kind !== "folder") return null;
  const folder = folders.find((item) => item.id === contextMenu.folderId);
  if (!folder) return null;

  const run = (fn: () => void | Promise<unknown>) => {
    void Promise.resolve(fn()).finally(close);
  };
  const members = books.filter((book) => book.folderId === folder.id);
  const isUnlocked = !folder.locked || unlocked.includes(folder.id);
  const left = Math.max(8, Math.min(contextMenu.x, window.innerWidth - 308));
  const top = Math.max(8, Math.min(contextMenu.y, window.innerHeight - 460));

  return (
    <div className="amp-menu-scrim" role="presentation" onContextMenu={(event) => event.preventDefault()}>
      <div
        ref={panel}
        className="amp-menu"
        role="menu"
        aria-label={`Actions for the folder ${folder.name}`}
        style={{ left, top }}
      >
        <div className="amp-menu-head">
          <span className="amp-menu-head-title">
            {folder.name}
            {folder.locked ? " (locked)" : ""}
          </span>
          <span className="amp-menu-head-sub">
            {isUnlocked
              ? `${members.length} book${members.length === 1 ? "" : "s"} in this folder`
              : "Contents hidden until the folder is unlocked"}
          </span>
        </div>

        <button className="amp-menu-item" role="menuitem" onClick={() => run(() => renameFolder(folder.id, window.prompt("Folder name", folder.name) ?? folder.name))}>
          <Pencil size={15} />
          Rename
        </button>
        <button
          className="amp-menu-item"
          role="menuitem"
          disabled={members.length === 0}
          onClick={() => run(() => playQueue(members.map((book) => book.id), { shuffle: false }))}
        >
          <Play size={15} />
          Play this folder
        </button>
        <button className="amp-menu-item" role="menuitem" onClick={() => run(() => openDialog({ kind: "newFolder", parentId: folder.id }))}>
          <FolderPlus size={15} />
          New folder inside
        </button>

        <p className="amp-menu-group">Colour</p>
        <div className="amp-menu-row">
          <span className="amp-menu-swatches">
            {COLOR_TAGS.map((tag) => (
              <button
                key={tag.value}
                className="amp-swatch"
                data-active={folder.color === tag.value}
                style={{ background: colorHex(tag.value) }}
                title={tag.label}
                aria-label={tag.label}
                onClick={() => run(() => setFolderColor(folder.id, folder.color === tag.value ? null : tag.value))}
              />
            ))}
            <button
              className="amp-swatch amp-swatch-none"
              data-active={!folder.color}
              title="No colour"
              aria-label="No colour"
              onClick={() => run(() => setFolderColor(folder.id, null))}
            />
          </span>
        </div>

        <p className="amp-menu-group">Lock</p>
        {folder.locked ? (
          <>
            {isUnlocked && (
              <button className="amp-menu-item" role="menuitem" onClick={() => run(() => useUiStore.getState().lockAgain(folder.id))}>
                <Lock size={15} />
                Lock again now
              </button>
            )}
            <button className="amp-menu-item" role="menuitem" onClick={() => run(() => openDialog({ kind: "folderLock", folderId: folder.id, mode: "unlock" }))}>
              <LockOpen size={15} />
              {isUnlocked ? "Check the PIN" : "Unlock with the PIN"}
            </button>
            <button className="amp-menu-item" role="menuitem" onClick={() => run(() => setFolderLock(folder.id, null))}>
              <LockOpen size={15} />
              Remove the lock
            </button>
          </>
        ) : (
          <button className="amp-menu-item" role="menuitem" onClick={() => run(() => openDialog({ kind: "folderLock", folderId: folder.id, mode: "set" }))}>
            <Lock size={15} />
            Lock with a PIN…
          </button>
        )}

        <p className="amp-menu-group">Nesting</p>
        <div className="amp-menu-scroll amp-menu-scroll-short">
          <button
            className="amp-menu-item"
            role="menuitem"
            disabled={!folder.parentId}
            onClick={() => run(() => moveFolder(folder.id, null))}
          >
            <ArrowUpFromLine size={15} />
            Move to the top level
            {!folder.parentId && <Check size={14} className="amp-menu-check" />}
          </button>
          {nestableInto(folders, folder.id).map((parent) => (
            <button
              key={parent.id}
              className="amp-menu-item"
              role="menuitem"
              data-active={folder.parentId === parent.id}
              onClick={() => run(() => moveFolder(folder.id, parent.id))}
            >
              <FolderInput size={15} />
              {parent.name}
              {folder.parentId === parent.id && <Check size={14} className="amp-menu-check" />}
            </button>
          ))}
        </div>

        <p className="amp-menu-group">Remove</p>
        <button
          className="amp-menu-item"
          role="menuitem"
          onClick={() =>
            run(async () => {
              await removeFolder(folder.id, true);
              toast({ title: `${folder.name} removed - the books are still in the library`, tone: "info" });
            })
          }
        >
          <Trash2 size={15} />
          Delete the folder, keep the books
        </button>
      </div>
    </div>
  );
}
