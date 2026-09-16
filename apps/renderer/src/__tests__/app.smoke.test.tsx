/**
 * @vitest-environment jsdom
 *
 * Boots the real App against a stubbed bridge that behaves like the desktop
 * host (there is no demo library in Amp), then drives it the way a user would:
 * render, search, open a book, walk the sidebar, use the context menu, play.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Reshaped } from "reshaped";
import "reshaped/bundle.css";
import { App } from "../App";
import { getBridge } from "../platform/bridge";
import { useDownloadsStore } from "../store/useDownloadsStore";
import { useLibraryStore } from "../store/useLibraryStore";
import { usePlayerStore } from "../store/usePlayerStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { useUiStore } from "../store/useUiStore";
import { stubHost } from "./stubHost";

async function bootApp() {
  await getBridge();
  await useSettingsStore.getState().load();
  await usePlayerStore.getState().bind();
  await useLibraryStore.getState().load();
  return render(
    <Reshaped theme="slate" defaultColorMode="light">
      <App />
    </Reshaped>,
  );
}

/** Click through the sidebar to the library, the way a listener would. */
async function openLibrary(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByText("All books")[0]);
  await waitFor(() => expect(document.querySelector(".amp-grid, .amp-list")).toBeTruthy());
}

describe("Amp app", () => {
  beforeEach(() => {
    localStorage.clear();
    stubHost();
    useLibraryStore.setState({
      filter: {
        text: "",
        folderId: "all",
        tag: null,
        favorite: false,
        inProgress: false,
        author: null,
        narrator: null,
        series: null,
        genre: null,
        color: null,
      },
      sort: { key: "added", direction: "desc" },
      view: "grid",
    });
    useUiStore.setState({
      ready: true,
      connected: true,
      route: "library",
      selectedBookId: null,
      selection: [],
      mini: false,
      dialog: { kind: "none" },
      contextMenu: null,
      toasts: [],
      playerVisible: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens on Home with the sidebar counts and no title bar", async () => {
    useUiStore.setState({ route: "home" });
    await bootApp();
    await waitFor(() => expect(screen.getAllByText("Home").length).toBeGreaterThan(0));
    // The whole shell is the sidebar: there is no separate top bar any more.
    expect(document.querySelector(".amp-titlebar")).toBeNull();
    expect(document.querySelector(".amp-tabbar")).toBeNull();
    expect(document.querySelector(".amp-sidebar")).toBeTruthy();
    expect(screen.getAllByText("All books").length).toBeGreaterThan(0);
    expect(useLibraryStore.getState().state.books.length).toBeGreaterThan(3);
  });

  it("filters the library from the sidebar search field", async () => {
    const user = userEvent.setup();
    await bootApp();
    await screen.findAllByText("Home");
    await openLibrary(user);
    const search = document.getElementById("amp-search-input") as HTMLInputElement;
    expect(search).toBeTruthy();
    await user.type(search, "Neuromancer");
    await waitFor(() => {
      expect(screen.getAllByText("Neuromancer").length).toBeGreaterThan(0);
      expect(screen.queryByText("Piranesi")).toBeNull();
    });
  });

  it("finds a book by its narrator, not only its title", async () => {
    const user = userEvent.setup();
    await bootApp();
    await screen.findAllByText("Home");
    await openLibrary(user);
    const search = document.getElementById("amp-search-input") as HTMLInputElement;
    // "Peter" is in the metadata, never in the titles on the shelf.
    await user.type(search, "Peter Watts");
    await waitFor(() => expect(screen.getAllByText("Blindsight").length).toBeGreaterThan(0));
    expect(screen.queryByText("Dune")).toBeNull();
  });

  it("opens a book and lists its chapters", async () => {
    const user = userEvent.setup();
    await bootApp();
    await screen.findAllByText("Home");
    await openLibrary(user);
    await waitFor(() => expect(screen.getAllByText("Dune").length).toBeGreaterThan(0));
    const card = screen.getAllByText("Dune")[0].closest(".amp-book-card") as HTMLElement;
    await user.click(card);
    await waitFor(() => expect(screen.getAllByText(/Chapters/).length).toBeGreaterThan(0));
    expect(useUiStore.getState().selectedBookId).toBeTruthy();
  });

  it("queues a book from the right-click context menu", async () => {
    const user = userEvent.setup();
    await bootApp();
    await screen.findAllByText("Home");
    await openLibrary(user);
    const card = screen.getAllByText("Piranesi")[0].closest(".amp-book-card") as HTMLElement;
    expect(card).toBeTruthy();
    await user.pointer({ keys: "[MouseRight]", target: card });
    const item = (await screen.findAllByText("Add to queue"))[0];
    await user.click(item);
    await waitFor(() =>
      expect(useLibraryStore.getState().state.queue.some((entry) => entry.bookId.length > 0)).toBe(true),
    );
  });

  it("tags a book with a colour from the context menu", async () => {
    const user = userEvent.setup();
    await bootApp();
    await screen.findAllByText("Home");
    await openLibrary(user);
    const card = screen.getAllByText("Piranesi")[0].closest(".amp-book-card") as HTMLElement;
    await user.pointer({ keys: "[MouseRight]", target: card });
    // The menu labels the row and offers the colours as swatches; a swatch is a
    // button whose accessible name is the colour it paints.
    expect(await screen.findAllByText("Colour")).not.toHaveLength(0);
    await user.click((await screen.findAllByRole("button", { name: "Blue" }))[0]);
    await waitFor(() => {
      const book = useLibraryStore.getState().state.books.find((entry) => entry.title === "Piranesi");
      expect(book?.color).toBe("blue");
    });
  });

  it("walks the sidebar: New, then Settings", async () => {
    const user = userEvent.setup();
    await bootApp();
    await screen.findAllByText("Home");

    await user.click(screen.getAllByText("New")[0]);
    await waitFor(() => expect(screen.getAllByText(/AudioBookBay/i).length).toBeGreaterThan(0));

    await user.click(screen.getAllByText("Settings")[0]);
    await waitFor(() => expect(screen.getAllByText("Looks").length).toBeGreaterThan(0));
  });

  it("searches AudioBookBay through the bridge and ranks the results", async () => {
    const user = userEvent.setup();
    await bootApp();
    await screen.findAllByText("Continue listening");
    await user.click(screen.getAllByText("New")[0]);
    const input = await screen.findByPlaceholderText(/Title, author or narrator/i);
    // Enter submits the search box, which is how the field is meant to be used.
    await user.type(input, "Dune{Enter}");
    await waitFor(() => expect(useDownloadsStore.getState().results.length).toBeGreaterThan(0));
    expect(useDownloadsStore.getState().results[0].title).toContain("Dune");
  });

  it("drives playback through the store and the transport", async () => {
    await bootApp();
    await screen.findAllByText("Home");
    const book = useLibraryStore.getState().state.books[0];
    await usePlayerStore.getState().loadBook(book, { autoplay: false });
    await waitFor(() => expect(usePlayerStore.getState().state.bookId).toBe(book.id));
    usePlayerStore.getState().skip(30);
    expect(usePlayerStore.getState().state.position).toBeGreaterThanOrEqual(30);
    await usePlayerStore.getState().nextChapter();
    expect(usePlayerStore.getState().state.chapterIndex).toBeGreaterThanOrEqual(0);
    await usePlayerStore.getState().addBookmark("test");
    expect(useLibraryStore.getState().state.bookmarks.some((mark) => mark.label === "test")).toBe(true);
  });

  it("keeps shortcuts wired to playback state", async () => {
    const user = userEvent.setup();
    await bootApp();
    await screen.findAllByText("Home");
    const book = useLibraryStore.getState().state.books[1];
    await usePlayerStore.getState().loadBook(book, { autoplay: true });
    await waitFor(() => expect(screen.getAllByLabelText("Pause").length).toBeGreaterThan(0));
    await user.keyboard(" ");
    await waitFor(() => expect(screen.getAllByLabelText("Play").length).toBeGreaterThan(0));
  });

  it("renders every route without crashing", async () => {
    await bootApp();
    await screen.findAllByText("Home");
    for (const route of ["playlists", "queue", "downloads", "nowplaying", "stats"] as const) {
      useUiStore.getState().setRoute(route);
      await waitFor(() => expect(document.querySelector(".amp-app")).toBeTruthy());
    }
    expect(useUiStore.getState().route).toBe("stats");
  });
});
