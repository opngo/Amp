/**
 * Folders: the shelves of the library.
 *
 * A folder is a label, not a place on disk - files are never moved. What this
 * page adds to that idea is shape: folders nest, so "Science fiction" can hold
 * "Becky Chambers" and "Ursula K. Le Guin" the way a shelf holds boxes, they
 * take a colour so a series is recognisable across the page, and they can be
 * locked, in which case they show their name and their colour and nothing else
 * until the PIN is given.
 */

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Lock,
  LockOpen,
  Pencil,
  Play,
  Trash2,
} from "lucide-react";
import {
  flattenTree,
  folderTree,
  formatBytes,
  formatDuration,
  isFinished,
  type Book,
  type Folder,
  type FolderNode,
} from "@amp/core";
import { useLibraryStore } from "../../store/useLibraryStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useUiStore } from "../../store/useUiStore";
import { CoverArt } from "../common/CoverArt";
import { EmptyState } from "../common/EmptyState";
import { AddMenu } from "./AddMenu";
import { FolderContextMenu } from "./FolderContextMenu";
import { colorHex } from "../layout/Sidebar";

export function FoldersView() {
  const folders = useLibraryStore((s) => s.state.folders);
  const books = useLibraryStore((s) => s.state.books);
  const removeFolder = useLibraryStore((s) => s.removeFolder);
  const setFilter = useLibraryStore((s) => s.setFilter);
  const moveToFolder = useLibraryStore((s) => s.moveToFolder);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const openDialog = useUiStore((s) => s.openDialog);
  const setRoute = useUiStore((s) => s.setRoute);
  const toast = useUiStore((s) => s.toast);
  const unlocked = useUiStore((s) => s.unlocked);
  const [collapsed, setCollapsed] = useState<string[]>([]);

  const tree = useMemo(() => folderTree(folders), [folders]);
  const loose = books.filter((book) => !book.folderId);

  const booksIn = (folder: Folder) => books.filter((book) => book.folderId === folder.id);
  const isOpen = (folder: Folder) => !folder.locked || unlocked.includes(folder.id);

  if (folders.length === 0) {
    return (
      <div className="amp-page">
        <EmptyState
          icon={FolderPlus}
          title="No folders yet"
          description="Folders group books without touching the files on disk: a series, a reading list, or the pile you keep meaning to get to. They can hold other folders, take a colour, and be locked."
          actionLabel="New folder"
          onAction={() => openDialog({ kind: "newFolder" })}
        />
        {loose.length > 0 && (
          <p className="amp-page-subtitle">
            {loose.length} book{loose.length === 1 ? "" : "s"} are not in a folder yet. Right-click any book to file it.
          </p>
        )}
      </div>
    );
  }

  const renderNode = (node: FolderNode) => {
    const { folder } = node;
    const open = isOpen(folder);
    const members = booksIn(folder);
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsed.includes(folder.id);
    return (
      <div key={folder.id} className="amp-folder-branch">
        <FolderCard
          folder={folder}
          depth={node.depth}
          books={open ? members : []}
          locked={!open}
          childCount={node.children.length}
          collapsed={isCollapsed}
          onToggleChildren={
            hasChildren ? () => setCollapsed((list) => (isCollapsed ? list.filter((id) => id !== folder.id) : [...list, folder.id])) : undefined
          }
          onOpen={() => {
            if (!open) {
              openDialog({ kind: "folderLock", folderId: folder.id, mode: "unlock" });
              return;
            }
            setFilter({ folderId: folder.id });
            setRoute("library");
          }}
          onPlay={() => void playQueue(members.map((book) => book.id), { shuffle: false })}
          onUnlock={() => openDialog({ kind: "folderLock", folderId: folder.id, mode: "unlock" })}
          onNewChild={() => openDialog({ kind: "newFolder", parentId: folder.id })}
          onDelete={() => {
            void removeFolder(folder.id).then(() => toast({ title: "Folder removed", tone: "info" }));
          }}
        />
        {hasChildren && !isCollapsed && (
          <div className="amp-folder-children">{node.children.map((child) => renderNode(child))}</div>
        )}
      </div>
    );
  };

  return (
    <div className="amp-page">
      <header className="amp-page-header">
        <div>
          <h1 className="amp-page-title">Folders</h1>
          <p className="amp-page-subtitle">
            {folders.length} folder{folders.length === 1 ? "" : "s"} - {books.length} books in the library
            {folders.some((folder) => folder.locked) ? ` - ${folders.filter((f) => f.locked).length} locked` : ""}
          </p>
        </div>
        <div className="amp-page-actions">
          <AddMenu />
          <button className="amp-chip" onClick={() => openDialog({ kind: "newFolder" })}>
            <FolderPlus size={14} />
            New folder
          </button>
        </div>
      </header>

      <div className="amp-folder-tree">
        {flattenTree(tree).length === 0 ? null : tree.map((node) => renderNode(node))}
      </div>

      {loose.length > 0 && (
        <div className="amp-folder-grid">
          <FolderCard
            folder={{ id: "loose", name: "Not in a folder", createdAt: 0 } as Folder}
            depth={0}
            books={loose}
            locked={false}
            childCount={0}
            onOpen={() => {
              setFilter({ folderId: "all" });
              setRoute("library");
            }}
            onPlay={() => void playQueue(loose.map((book) => book.id), { shuffle: false })}
            onFile={
              folders.length > 0
                ? () => {
                    for (const book of loose) void moveToFolder([book.id], folders[0].id);
                    toast({ title: `Filed into ${folders[0].name}`, tone: "success" });
                  }
                : undefined
            }
            fileLabel={folders.length > 0 ? `File into ${folders[0].name}` : undefined}
          />
        </div>
      )}

      <FolderContextMenu />
    </div>
  );
}

function FolderCard({
  folder,
  depth,
  books,
  locked,
  childCount,
  collapsed,
  onToggleChildren,
  onOpen,
  onPlay,
  onUnlock,
  onNewChild,
  onDelete,
  onFile,
  fileLabel,
}: {
  folder: Folder;
  depth: number;
  books: Book[];
  locked: boolean;
  childCount: number;
  collapsed?: boolean;
  onToggleChildren?: () => void;
  onOpen: () => void;
  onPlay: () => void;
  onUnlock?: () => void;
  onNewChild?: () => void;
  onDelete?: () => void;
  onFile?: () => void;
  fileLabel?: string;
}) {
  const seconds = books.reduce((acc, book) => acc + book.duration, 0);
  const bytes = books.reduce((acc, book) => acc + (book.sizeBytes ?? 0), 0);
  const remaining = books.filter((book) => !isFinished(book)).length;
  // The three most recent covers stand for the folder.
  const covers = [...books].sort((a, b) => b.addedAt - a.addedAt).slice(0, 3);
  const setContextMenu = useUiStore((s) => s.openFolderMenu);

  return (
    <article
      className="amp-folder-card"
      data-locked={locked}
      data-depth={depth > 0 ? 1 : 0}
      onContextMenu={(event) => {
        if (folder.id === "loose") return;
        event.preventDefault();
        event.stopPropagation();
        setContextMenu(folder.id, event.clientX, event.clientY);
      }}
    >
      <button
        type="button"
        className="amp-folder-art"
        onClick={onOpen}
        aria-label={locked ? `Unlock ${folder.name}` : `Open ${folder.name}`}
        style={{ boxShadow: folder.color ? `0 0 0 2px ${colorHex(folder.color)}` : undefined }}
      >
        {locked ? (
          <span className="amp-folder-locked" aria-hidden>
            <Lock size={22} />
          </span>
        ) : covers.length === 0 ? (
          <span className="amp-folder-empty" aria-hidden />
        ) : (
          covers.map((book, index) => (
            <span key={book.id} className="amp-folder-cover" data-slot={index}>
              <CoverArt book={book} />
            </span>
          ))
        )}
        <span className="amp-folder-dot" style={{ background: folder.color ? colorHex(folder.color) : colorHex("blue") }} aria-hidden />
      </button>

      <div className="amp-folder-meta">
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          {onToggleChildren ? (
            <button className="amp-folder-twisty" onClick={onToggleChildren} title={collapsed ? "Show what is inside" : "Hide what is inside"}>
              {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              {childCount}
            </button>
          ) : null}
          <button type="button" className="amp-folder-name" onClick={onOpen}>
            {folder.name}
          </button>
          {folder.locked && (
            <span className="amp-folder-lock" title={locked ? "Locked" : "Unlocked for this session"}>
              {locked ? <Lock size={12} /> : <LockOpen size={12} />}
            </span>
          )}
        </div>
        <span className="amp-folder-stats">
          {locked
            ? `Locked - ${childCount > 0 ? `${childCount} folder${childCount === 1 ? "" : "s"} inside` : "contents hidden"}`
            : `${books.length} book${books.length === 1 ? "" : "s"} - ${formatDuration(seconds)}${bytes > 0 ? ` - ${formatBytes(bytes)}` : ""}${remaining > 0 && books.length > 0 ? ` - ${remaining} to go` : ""}`}
        </span>
      </div>

      <div className="amp-folder-actions">
        {locked ? (
          <button className="amp-chip" onClick={onUnlock}>
            <LockOpen size={13} />
            Unlock
          </button>
        ) : (
          <button className="amp-chip" onClick={onPlay} disabled={books.length === 0}>
            <Play size={13} />
            Play
          </button>
        )}
        {onNewChild && (
          <button className="amp-chip" onClick={onNewChild} title="New folder inside this one">
            <FolderPlus size={13} />
            Inside
          </button>
        )}
        {onFile && fileLabel ? (
          <button className="amp-chip" onClick={onFile} title={fileLabel}>
            <Pencil size={13} />
            File
          </button>
        ) : null}
        {onDelete && (
          <button className="amp-chip amp-chip-danger" onClick={onDelete} title="Delete this folder">
            <Trash2 size={13} />
            Delete
          </button>
        )}
      </div>
    </article>
  );
}
