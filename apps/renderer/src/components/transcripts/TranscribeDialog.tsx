/**
 * Transcription: runs a local Whisper binary (whisper.cpp, faster-whisper or
 * openai-whisper) over the selected chapters and streams progress.
 */

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Divider, Modal, ProgressBar, Select, Switch, Text } from "reshaped";
import { estimatedJobSeconds, formatDuration } from "@amp/core";
import type { TranscriberJob } from "@amp/core";
import { getBridge } from "../../platform/bridge";
import { useLibraryStore } from "../../store/useLibraryStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { useUiStore } from "../../store/useUiStore";

export function TranscribeDialog({ bookId, onClose }: { bookId: string; onClose: () => void }) {
  const book = useLibraryStore((s) => s.state.books.find((b) => b.id === bookId));
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.update);
  const setRoute = useUiStore((s) => s.setRoute);
  const toast = useUiStore((s) => s.toast);
  const [probe, setProbe] = useState<{ available: boolean; version?: string; detail?: string } | null>(null);
  const [job, setJob] = useState<TranscriberJob | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    void getBridge().then(async (host) => setProbe(await host.transcription.probe()));
    return () => {
      if (timer.current !== null) window.clearInterval(timer.current);
    };
  }, []);

  if (!book) return null;
  const config = settings.transcription;
  const chapters = book.chapters;
  const chosen = selected.length > 0 ? selected : chapters.map((c) => c.index - 1);
  const seconds = chosen.reduce((acc, index) => acc + (chapters[index]?.duration ?? 0), 0);

  const start = async () => {
    const host = await getBridge();
    const created = await host.transcription.start(book.id, chosen);
    setJob(created);
    timer.current = window.setInterval(async () => {
      const next = await host.transcription.status(created.id);
      if (!next) return;
      setJob({ ...next });
      if (next.status === "done" || next.status === "error" || next.status === "cancelled") {
        if (timer.current !== null) window.clearInterval(timer.current);
        if (next.status === "done") {
          toast({ title: "Transcript ready", tone: "success" });
          setRoute("transcript");
          onClose();
        }
      }
    }, 900);
  };

  return (
    <Modal active onClose={onClose} size="640px" padding={6}>
      <Modal.Title>Transcribe</Modal.Title>
      <Modal.Subtitle>{book.title}</Modal.Subtitle>

      <div style={{ display: "grid", gap: 14, marginTop: 16 }}>
        {probe && !probe.available && (
          <Alert color="warning">
            No Whisper binary found. Install whisper.cpp (or faster-whisper) and set the path in Settings, then run
            again. {probe.detail ?? ""}
          </Alert>
        )}
        {probe?.available && (
          <Text variant="caption-1" color="neutral-faded">
            Whisper ready: {probe.version ?? "detected"}
          </Text>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Select
            name="provider"
            value={config.provider}
            onChange={({ value }) => void updateSettings({ transcription: { provider: value as typeof config.provider } })}
          >
            <Select.Option value="whisper-cpp">whisper.cpp (local)</Select.Option>
            <Select.Option value="local-whisper">openai-whisper / faster-whisper (local)</Select.Option>
            <Select.Option value="openai">OpenAI API (needs a key in env)</Select.Option>
          </Select>
          <Select
            name="model"
            value={config.model}
            onChange={({ value }) => void updateSettings({ transcription: { model: value } })}
          >
            {["tiny", "base", "small", "medium", "large-v3-turbo", "large-v3"].map((model) => (
              <Select.Option key={model} value={model}>
                {model}
              </Select.Option>
            ))}
          </Select>
        </div>

        <Switch
          name="translate"
          checked={config.translate}
          onChange={({ checked }) => void updateSettings({ transcription: { translate: checked } })}
        >
          Translate to English while transcribing
        </Switch>

        <Divider />
        <Text variant="caption-1" color="neutral-faded">
          Chapters ({selected.length === 0 ? "all" : selected.length} selected) - about{" "}
          {formatDuration(estimatedJobSeconds(seconds, config.model))} of processing on this machine
        </Text>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 150, overflowY: "auto" }}>
          {chapters.map((chapter, index) => {
            const active = selected.includes(index);
            return (
              <Button
                key={chapter.id}
                size="small"
                variant={active ? "solid" : "outline"}
                color={active ? "primary" : "neutral"}
                onClick={() =>
                  setSelected((list) => (list.includes(index) ? list.filter((i) => i !== index) : [...list, index]))
                }
              >
                {chapter.index}. {chapter.title.slice(0, 24)}
              </Button>
            );
          })}
        </div>

        {job && (
          <div style={{ display: "grid", gap: 8 }}>
            <ProgressBar value={Math.round((job.progress / Math.max(1, chosen.length)) * 100)} />
            <Text variant="caption-1" color="neutral-faded">
              {job.status} - {job.progress}/{chosen.length} chapters
            </Text>
            <div
              style={{
                maxHeight: 120,
                overflowY: "auto",
                fontFamily: "ui-monospace, monospace",
                fontSize: 11,
                background: "rgba(0,0,0,0.3)",
                padding: 8,
              }}
            >
              {job.log.slice(-12).map((line, index) => (
                <div key={index}>{line}</div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <div style={{ display: "flex", gap: 8 }}>
            {job && job.status === "running" && (
              <Button
                variant="outline"
                color="critical"
                onClick={() => void getBridge().then((host) => host.transcription.cancel(job.id))}
              >
                Cancel
              </Button>
            )}
            <Button color="primary" disabled={!probe?.available || job?.status === "running"} onClick={() => void start()}>
              Start transcription
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
