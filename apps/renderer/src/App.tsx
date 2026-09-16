/**
 * Application shell.
 *
 * One window, one sidebar, one content column, and the player pinned to the
 * bottom. There is no second navigation bar: every destination in Amp is a row
 * in the sidebar, and the window frame itself belongs to the operating system
 * (Amp draws no title bar of its own).
 *
 * The shell knows nothing about where it runs. It asks the bridge which parts
 * it can support - importing, torrents, transcripts - and shows the matching
 * rows, so the same code is the desktop app, a browser against a server, and a
 * plain page with nothing connected.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Theme } from "reshaped";
import { useLibraryStore } from "./store/useLibraryStore";
import { usePlayerStore } from "./store/usePlayerStore";
import { useSettingsStore } from "./store/useSettingsStore";
import { useUiStore } from "./store/useUiStore";
import { useActiveBookPalette } from "./hooks/usePalette";
import { useHostCommands, useShortcuts } from "./hooks/useShortcuts";
import { useIsNarrow } from "./hooks/useMediaQuery";
import { Sidebar } from "./components/layout/Sidebar";
import { HomeView } from "./components/home/HomeView";
import { BrowseView } from "./components/library/BrowseView";
import { LibraryView } from "./components/library/LibraryView";
import { BookDetailView } from "./components/library/BookDetailView";
import { FullPlayer } from "./components/player/FullPlayer";
import { PlayerBar } from "./components/player/PlayerBar";
import { MiniWidget } from "./components/player/MiniWidget";
import { SearchView } from "./components/downloads/SearchView";
import { DownloadsView } from "./components/downloads/DownloadsView";
import { PlaylistsView } from "./components/playlists/PlaylistsView";
import { QueueView } from "./components/playlists/QueueView";
import { FoldersView } from "./components/library/FoldersView";
import { StatsView } from "./components/stats/StatsView";
import { TranscriptView } from "./components/transcripts/TranscriptView";
import { SettingsView } from "./components/settings/SettingsView";
import { DialogHost } from "./components/common/DialogHost";
import { LibraryContextMenu } from "./components/library/LibraryContextMenu";
import { ToastHost } from "./components/common/ToastHost";
import { DropZone } from "./components/library/DropZone";
import { ConnectScreen } from "./components/layout/ConnectScreen";
import { resolveTheme } from "./store/theme";
import { exposeDebugHandles } from "./platform/debug";

export function App() {
  // Reachable from DevTools as window.__amp (and used by the visual smoke test).
  exposeDebugHandles();
  useShortcuts();
  useHostCommands();
  const route = useUiStore((s) => s.route);
  const dialog = useUiStore((s) => s.dialog);
  const mini = useUiStore((s) => s.mini);
  const ready = useUiStore((s) => s.ready);
  const connected = useUiStore((s) => s.connected);
  const playerVisible = useUiStore((s) => s.playerVisible);
  const playerFullscreen = useUiStore((s) => s.playerFullscreen);
  const toast = useUiStore((s) => s.toast);
  const selectedBookId = useUiStore((s) => s.selectedBookId);
  const narrow = useIsNarrow();
  const [dragging, setDragging] = useState(false);

  const book = usePlayerStore((s) => s.book);
  const notice = usePlayerStore((s) => s.notice);
  const importPaths = useLibraryStore((s) => s.importPaths);
  const settings = useSettingsStore((s) => s.settings);

  // The active book drives the adaptive tint for the whole window.
  useActiveBookPalette(
    book?.coverDataUrl ?? book?.coverUrl ?? book?.coverPath ?? undefined,
    book?.title ?? "amp",
  );

  // If the audio engine had to work around a broken output pipeline, say so
  // once and then leave the listener alone.
  useEffect(() => {
    if (!notice) return;
    const player = usePlayerStore.getState();
    toast({ title: "Audio adjusted", description: notice, tone: "info" });
    player.clearNotice();
  }, [notice, toast]);

  // A load that could not even start (a format this Chromium cannot decode)
  // deserves a reason, not a player that silently does nothing. The message
  // stays in the store so the player bar can repeat it; the toast is raised
  // once per distinct message instead of being cleared to keep it quiet.
  const playbackError = usePlayerStore((s) => s.error);
  const notifiedError = useRef<string | null>(null);
  useEffect(() => {
    if (!playbackError || notifiedError.current === playbackError) return;
    notifiedError.current = playbackError;
    toast({ title: "Cannot play this book", description: playbackError, tone: "danger" });
  }, [playbackError, toast]);

  // Where the window opens comes from Settings. It is applied on the first
  // render after the saved settings arrive, and never again - switching pages
  // afterwards belongs to the person using the app, not to a setting.
  const startRoute = useSettingsStore((s) => s.settings.startRoute);
  const settingsReady = useSettingsStore((s) => s.ready);
  const appliedStart = useRef(false);
  useEffect(() => {
    if (appliedStart.current || !settingsReady) return;
    appliedStart.current = true;
    useUiStore.getState().setRoute(startRoute ?? "home");
  }, [settingsReady, startRoute]);

  // Native drag & drop of files/folders (Electron gives us real paths).
  useEffect(() => {
    const onDrop = async (event: DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      const paths = files
        .map((file) => (file as File & { path?: string }).path)
        .filter((path): path is string => Boolean(path));
      if (paths.length === 0) {
        toast({ title: "Dropping files needs the desktop app", tone: "info" });
        return;
      }
      const result = await importPaths(paths);
      toast({
        title: `Imported ${result.added} book${result.added === 1 ? "" : "s"}`,
        description: result.errors.slice(0, 2).join(" "),
        tone: result.errors.length ? "danger" : "success",
      });
    };
    const onDragOver = (event: DragEvent) => {
      event.preventDefault();
      setDragging(true);
    };
    const onDragLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) setDragging(false);
    };
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    return () => {
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
    };
  }, [importPaths, toast]);

  // Window state from the main process (mini player toggled from the tray).
  useEffect(() => {
    const host = window.amp;
    if (!host) return;
    return host.player.onWindowState((state) => {
      useUiStore.getState().setMini(state.mini);
    });
  }, []);

  const renderRoute = useCallback(() => {
    switch (route) {
      case "home":
        return <HomeView />;
      case "nowplaying":
        // The page form of the immersive player. It is the same surface the
        // overlay shows, so there is one player to keep beautiful instead of two.
        return <FullPlayer variant="page" />;
      case "browse":
        return <BrowseView />;
      case "search":
        return <SearchView />;
      case "downloads":
        return <DownloadsView />;
      case "playlists":
        return <PlaylistsView />;
      case "queue":
        return <QueueView />;
      case "folders":
        return <FoldersView />;
      case "stats":
        return <StatsView />;
      case "transcript":
        return <TranscriptView />;
      case "settings":
        return <SettingsView />;
      case "library":
      default:
        return selectedBookId && dialog.kind !== "editBook" ? (
          <BookDetailView bookId={selectedBookId} />
        ) : (
          <LibraryView />
        );
    }
  }, [route, selectedBookId, dialog.kind]);

  const isDark = resolveTheme(settings, true);

  if (mini) {
    return (
      <Theme colorMode={isDark ? "dark" : "light"}>
        <div className="amp-app" data-mini="true">
          <div className="amp-bg" />
          <MiniWidget onExpand={() => useUiStore.getState().setMini(false)} />
          <ToastHost />
        </div>
      </Theme>
    );
  }

  return (
    <Theme colorMode={isDark ? "dark" : "light"}>
      <div className="amp-app">
        <div className="amp-bg" />
        <div className="amp-body">
          {!narrow && <Sidebar />}
          <div className="amp-main">
            <div className="amp-scroll" id="amp-scroll">
              {renderRoute()}
            </div>
            {/* The bottom bar steps aside for the player: on the now playing
                route it would be a second transport under the first, and while
                the immersive player is open the bar is underneath it. */}
            {playerVisible && book && route !== "nowplaying" && !playerFullscreen && <PlayerBar />}
          </div>
        </div>

        {playerFullscreen && <FullPlayer variant="overlay" />}

        {/* One menu for every book in the app, mounted at the top so a right
            click in any view opens it. When it lived inside the library views it
            was only there once that view had been visited, which is exactly the
            "the menu only shows up after I go to Playlists" it was. */}
        <LibraryContextMenu />

        {ready && !connected && <ConnectScreen />}
        {dragging && (
          <DropZone
            label="Drop audiobook files or a folder"
            hint={
              settings.library.groupFolders
                ? "Sibling tracks are grouped into one book with chapters"
                : "Each file becomes its own book"
            }
          />
        )}
        <DialogHost />
        <ToastHost />
      </div>
    </Theme>
  );
}
