/**
 * Search: AudioBookBay, from inside the app.
 *
 * Type a title, author or narrator and Amp queries AudioBookBay (and its
 * mirrors), parses each release name into author, format, bitrate, year and
 * narrator, then hands the magnet to qBittorrent. Results are real: nothing is
 * cached or invented, and each row can be opened on the source page.
 */

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Select, TextField } from "reshaped";
import { Download, ExternalLink, Filter, Search, Server } from "lucide-react";
import { parseTitle, sortResults, type TorrentResult } from "@amp/core";
import { useDownloadsStore } from "../../store/useDownloadsStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { useUiStore } from "../../store/useUiStore";
import { getBridge } from "../../platform/bridge";
import { EmptyState } from "../common/EmptyState";

const SUGGESTIONS = ["Project Hail Mary", "Ursula K. Le Guin", "Dune", "Ray Porter"];

export function SearchView() {
  const query = useDownloadsStore((s) => s.query);
  const setQuery = useDownloadsStore((s) => s.setQuery);
  const results = useDownloadsStore((s) => s.results);
  const searching = useDownloadsStore((s) => s.searching);
  const sort = useDownloadsStore((s) => s.sort);
  const setSort = useDownloadsStore((s) => s.setSort);
  const search = useDownloadsStore((s) => s.search);
  const download = useDownloadsStore((s) => s.download);
  const connected = useDownloadsStore((s) => s.connected);
  const connectionDetail = useDownloadsStore((s) => s.connectionDetail);
  const testConnection = useDownloadsStore((s) => s.testConnection);
  const error = useDownloadsStore((s) => s.error);
  const searched = useDownloadsStore((s) => s.searched);
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const toast = useUiStore((s) => s.toast);
  const [minSeeders, setMinSeeders] = useState(Number(settings.torrents.minSeeders ?? 0));
  // "Any format" to start with: the preferred format ranks results, it should
  // not hide everything else before the first search.
  const [format, setFormat] = useState("any");
  const reportsSeeders = results.some((result) => result.seeders !== undefined);
  // The connection banner already explains an unreachable client: do not say it
  // twice when a failed download repeats the same reason.
  const showsError = Boolean(error) && error !== connectionDetail;
  const booted = useRef(false);

  useEffect(() => {
    void testConnection();
    // Opening the tab shows what is new on AudioBookBay: one real request, once.
    if (!booted.current && results.length === 0) {
      booted.current = true;
      void search("");
    }
  }, [testConnection, search, results.length]);

  const filtered = results
    // AudioBookBay does not publish seeder counts, so the filter only applies
    // where the source actually reported one.
    .filter((result) => (result.seeders === undefined ? true : result.seeders >= minSeeders))
    .filter((result) => (format === "any" ? true : parseTitle(result.title).format === format))
    .sort((a, b) => {
      if (sort === "size") return (a.size ?? 0) - (b.size ?? 0);
      if (sort === "seeders") return (b.seeders ?? 0) - (a.seeders ?? 0);
      if (sort === "date") return (b.postedAt ?? 0) - (a.postedAt ?? 0);
      return (b.score ?? 0) - (a.score ?? 0);
    });

  const sources = settings.torrents.sources ?? [];
  const canSearch = sources.length === 0 || sources.some((source) => source.enabled);

  return (
    <div style={{ display: "grid", gap: 18, paddingBottom: 8 }}>
      <div className="amp-content-header">
        <div style={{ display: "grid", gap: 3 }}>
          <h1 className="amp-page-title">Search</h1>
          <span className="amp-page-subtitle">
            {query
              ? `AudioBookBay${settings.torrents.sources.length > 1 ? " and mirrors" : ""} - downloads go to qBittorrent`
              : "New releases on AudioBookBay - downloads go to qBittorrent"}
          </span>
        </div>
        <div className="amp-toolbar amp-toolbar-end">
          <span
            className="amp-chip"
            title={connectionDetail ?? ""}
            style={{
              cursor: "default",
              color: connected ? "var(--amp-tint)" : connected === null ? "var(--amp-text-3)" : "var(--amp-text-2)",
            }}
          >
            <Server size={13} />
            qBittorrent {connected ? "connected" : connected === null ? "checking" : "offline"}
          </span>
          <button type="button" className="amp-chip" onClick={() => void testConnection()}>
            Test
          </button>
        </div>
      </div>

      <div className="amp-toolbar">
        <TextField
          name="torrent-query"
          placeholder="Title, author or narrator"
          icon={Search}
          value={query}
          onChange={({ value }) => setQuery(value)}
          attributes={{
            style: { flex: "1 1 320px" },
            onKeyDown: (event: React.KeyboardEvent) => {
              if (event.key === "Enter") void search();
            },
          }}
        />
        <Button color="primary" icon={Search} loading={searching} onClick={() => void search()}>
          Search
        </Button>
        <Select name="sort" size="small" value={sort} onChange={({ value }) => setSort(value as typeof sort)}>
          <Select.Option value="relevance">Best match</Select.Option>
          <Select.Option value="seeders">Most seeders</Select.Option>
          <Select.Option value="size">Smallest first</Select.Option>
          <Select.Option value="date">Newest</Select.Option>
        </Select>
        <Select name="format" size="small" value={format} onChange={({ value }) => setFormat(value)}>
          <Select.Option value="any">Any format</Select.Option>
          <Select.Option value="m4b">M4B (chapters)</Select.Option>
          <Select.Option value="m4a">M4A</Select.Option>
          <Select.Option value="mp3">MP3</Select.Option>
          <Select.Option value="flac">FLAC</Select.Option>
        </Select>
        <Select
          name="seeders"
          size="small"
          disabled={!reportsSeeders}
          value={String(minSeeders)}
          onChange={({ value }) => {
            setMinSeeders(Number(value));
            void update({ torrents: { minSeeders: Number(value) } });
          }}
          icon={Filter}
          attributes={{ title: reportsSeeders ? "Filter by seeder count" : "This source does not report seeders" }}
        >
          {[0, 1, 5, 10, 25, 50].map((value) => (
            <Select.Option key={value} value={String(value)}>
              {value === 0 ? "Any seeders" : `${value}+ seeders`}
            </Select.Option>
          ))}
        </Select>
      </div>

      {!canSearch && (
        <Alert color="neutral">
          No indexers are enabled. The built-in AudioBookBay source can be switched back on under Settings, Downloads.
        </Alert>
      )}
      {connectionDetail && !connected && canSearch && (
        <Alert color="warning">
          {connectionDetail} - the search itself still works; downloading needs qBittorrent running with its Web UI
          enabled. Set the address, user and password under Settings, Downloads.
        </Alert>
      )}
      {showsError && <Alert color="critical">{error}</Alert>}

      {results.length === 0 ? (
        <div style={{ display: "grid", gap: 14, justifyItems: "center" }}>
          <EmptyState
            icon={Search}
            title={
              searching
                ? "Looking through AudioBookBay"
                : searched && query.trim()
                  ? `Nothing on AudioBookBay for "${query.trim()}"`
                  : searched
                    ? "AudioBookBay returned nothing"
                    : "Search AudioBookBay"
            }
            // A search that came back empty is a result too, and saying so is
            // the difference between "no matches" and "the button is broken".
            description={
              searched && !searching
                ? "The site answered with no releases for that text. Mirrors can lag behind the main site, so try the author's name alone, or a shorter title."
                : "Results show the release name, size, format, bitrate and date, and the magnet goes straight to your queue. Nothing is downloaded by Amp itself: qBittorrent does the work, with your settings."
            }
            actionLabel="New releases"
            onAction={() => void search("")}
          />
          <div className="amp-toolbar" style={{ justifyContent: "center" }}>
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="amp-chip"
                onClick={() => {
                  setQuery(suggestion);
                  void search(suggestion);
                }}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          <span className="amp-page-subtitle">
            {query ? `Results for "${query}"` : "New releases"} - {filtered.length} of {results.length} shown
          </span>
          <div className="amp-list">
            {filtered.map((result) => (
              <ResultRow
                key={result.id}
                result={result}
                onDownload={async () => {
                  const outcome = await download(result);
                  if (outcome.ok) {
                    toast({
                      title: "Sent to qBittorrent",
                      description: result.title,
                      tone: "success",
                      action: {
                        label: "Open downloads",
                        run: () => useUiStore.getState().setRoute("downloads"),
                      },
                    });
                  } else {
                    toast({
                      title: "Could not send that to qBittorrent",
                      description: outcome.detail,
                      tone: "danger",
                      action: {
                        label: "Download settings",
                        run: () => useUiStore.getState().setRoute("settings"),
                      },
                    });
                  }
                }}
                onOpen={() => void getBridge().then((host) => host.player.openExternal(result.url ?? ""))}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ResultRow({
  result,
  onDownload,
  onOpen,
}: {
  result: TorrentResult;
  onDownload: () => void;
  onOpen: () => void;
}) {
  const parsed = result.parsed ?? parseTitle(result.title);
  // AudioBookBay results carry a page URL rather than a magnet; the host
  // resolves the info hash from that page when Download is pressed.
  const canDownload = Boolean(result.magnet || result.url || result.infoHash);
  const meta = [
    parsed.format && parsed.format !== "unknown" ? parsed.format.toUpperCase() : null,
    parsed.bitrate ?? null,
    result.sizeText ?? null,
    parsed.year ? String(parsed.year) : null,
    typeof result.seeders === "number" && result.seeders > 0 ? `${result.seeders} seeders` : null,
    result.postedText ?? null,
  ].filter(Boolean) as string[];

  return (
    <div className="amp-row-line" style={{ alignItems: "flex-start", gap: 14, padding: "12px 12px" }}>
      {result.coverUrl ? (
        <img
          src={result.coverUrl}
          alt=""
          width={56}
          height={56}
          style={{ width: 56, height: 56, objectFit: "cover", flex: "0 0 auto", borderRadius: 8 }}
          onError={(event) => {
            (event.target as HTMLImageElement).style.visibility = "hidden";
          }}
        />
      ) : (
        <div
          style={{
            width: 56,
            height: 56,
            flex: "0 0 auto",
            borderRadius: 8,
            background: "var(--amp-fill)",
          }}
        />
      )}

      <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 3 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35 }}>{result.title}</span>
        <span style={{ fontSize: 12.5, color: "var(--amp-text-2)" }}>
          {parsed.author ?? result.category ?? result.source ?? "AudioBookBay"}
          {parsed.narrator ? ` - read by ${parsed.narrator}` : ""}
        </span>
        <span className="amp-book-meta">{meta.join(" - ")}</span>
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "center", flex: "0 0 auto" }}>
        {canDownload ? (
          <button
            type="button"
            className="amp-chip"
            data-active
            onClick={onDownload}
            title={
              result.magnet
                ? "Send this magnet to qBittorrent"
                : "Amp reads the release page for its info hash, then sends the magnet to qBittorrent"
            }
          >
            <Download size={14} />
            Download
          </button>
        ) : null}
        <button type="button" className="amp-chip" onClick={onOpen} title="Open the release page on AudioBookBay">
          <ExternalLink size={14} />
          Open page
        </button>
      </div>
    </div>
  );
}

export const downloadSortOptions = sortResults;
