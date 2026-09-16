/**
 * The interface store: routing, menus and the immersive player.
 *
 * Two of these are regressions with a story behind them. The context menu used
 * to set `selectedBookId`, which meant a right click opened the book as well as
 * the menu - and the book page stayed open afterwards. The player's fullscreen
 * flag has to be independent of the route, so leaving the immersive player does
 * not move the page underneath it.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "../store/useUiStore";

function reset() {
  useUiStore.setState({
    route: "home",
    previousRoute: "home",
    selectedBookId: null,
    playerFullscreen: false,
    playerVisible: true,
    selection: [],
    contextMenu: null,
    dialog: { kind: "none" },
    mini: false,
    soundPanelOpen: false,
  });
}

describe("useUiStore", () => {
  beforeEach(reset);

  it("opens the immersive player without touching the route", () => {
    useUiStore.getState().setRoute("library");
    useUiStore.getState().setPlayerFullscreen(true);
    expect(useUiStore.getState().playerFullscreen).toBe(true);
    // The page under the overlay stays where it was.
    expect(useUiStore.getState().route).toBe("library");
  });

  it("closes the immersive player without navigating", () => {
    useUiStore.getState().setPlayerFullscreen(true);
    useUiStore.getState().setRoute("nowplaying");
    useUiStore.getState().setPlayerFullscreen(false);
    expect(useUiStore.getState().playerFullscreen).toBe(false);
    expect(useUiStore.getState().route).toBe("nowplaying");
  });

  it("leaves the book alone when a context menu opens", () => {
    useUiStore.getState().select("book-1");
    useUiStore.getState().openContextMenu("book-2", 40, 80);
    expect(useUiStore.getState().contextMenu).toEqual({ kind: "book", bookId: "book-2", x: 40, y: 80 });
    // Right click belongs to the menu: it must not open the book as well.
    expect(useUiStore.getState().selectedBookId).toBe("book-1");
    useUiStore.getState().closeContextMenu();
    expect(useUiStore.getState().contextMenu).toBeNull();
    expect(useUiStore.getState().selectedBookId).toBe("book-1");
  });

  it("folds the corner panel away when the player closes", () => {
    useUiStore.getState().setPlayerFullscreen(true);
    useUiStore.getState().setSoundPanelOpen(true);
    expect(useUiStore.getState().soundPanelOpen).toBe(true);
    useUiStore.getState().setPlayerFullscreen(false);
    // A panel left open behind a player that is gone would sit over the library.
    expect(useUiStore.getState().soundPanelOpen).toBe(false);
  });

  it("keeps one card per message when the same warning repeats", () => {
    const toast = useUiStore.getState().toast;
    toast({ title: "Audio adjusted", tone: "info" });
    toast({ title: "Audio adjusted", tone: "info" });
    toast({ title: "Something else", tone: "info" });
    expect(useUiStore.getState().toasts.map((item) => item.title)).toEqual([
      "Audio adjusted",
      "Something else",
    ]);
  });

  it("remembers where it came from when it navigates", () => {
    useUiStore.getState().setRoute("library");
    useUiStore.getState().setRoute("settings");
    expect(useUiStore.getState().previousRoute).toBe("library");
    useUiStore.getState().back();
    expect(useUiStore.getState().route).toBe("library");
  });
});
