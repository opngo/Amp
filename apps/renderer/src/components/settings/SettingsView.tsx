/**
 * Settings, grouped the way the app is built: look, sound, library, network,
 * speech, data. Everything is persisted through the bridge (electron-store on
 * the desktop, localStorage in the browser).
 */

import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Divider,
  Select,
  Slider,
  Switch,
  Tabs,
  Text,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from "reshaped";
import {
  AudioLines,
  BookOpen,
  Database,
  Download,
  FileCog,
  HardDriveDownload,
  Keyboard,
  Layout,
  Palette,
  RotateCcw,
  Server,
  SlidersHorizontal,
  Speech,
  Trash2,
  Waves,
} from "lucide-react";
import {
  THEME_OPTIONS,
  defaultSettings,
  presetById,
  type ChapterRule,
  type Settings,
  type ThemeMode,
} from "@amp/core";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { bridgeIfReady } from "../../platform/bridge";
import { useUiStore } from "../../store/useUiStore";
import { getBridge } from "../../platform/bridge";
import { DEFAULT_VISUALIZER, VISUALIZER_MODES, VisualizerState, drawFrame } from "../../audio/visualizer";
import { Kbd } from "../common/Kbd";
import { applyEqualizer } from "../../audio/equalizerGraph";
import { engine } from "../../audio/audioEngine";

type Section = "look" | "player" | "sound" | "library" | "downloads" | "speech" | "server" | "data";

export function SettingsView() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const replace = useSettingsStore((s) => s.replace);
  const toast = useUiStore((s) => s.toast);
  const openDialog = useUiStore((s) => s.openDialog);
  const [section, setSection] = useState<Section>("look");
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [probe, setProbe] = useState<{ available: boolean; version?: string; detail?: string } | null>(null);
  const [serverStatus, setServerStatus] = useState<{ running: boolean; url?: string } | null>(null);
  const [dataInfo, setDataInfo] = useState<{ dataDir: string; diskBytes: number } | null>(null);

  // Probe once on open: devices, Whisper, the remote server and the data
  // folder. The equalizer is applied from the latest settings through a ref, so
  // this effect does not re-run every time a setting changes.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    void (async () => {
      try {
        const devices = await navigator.mediaDevices?.enumerateDevices?.();
        setOutputs((devices ?? []).filter((device) => device.kind === "audiooutput"));
      } catch {
        setOutputs([]);
      }
      const host = await getBridge();
      setProbe(await host.transcription.probe());
      setServerStatus(await host.server.status());
      const stats = await host.library.stats();
      setDataInfo({ dataDir: stats.dataDir, diskBytes: stats.diskBytes });
      applyEqualizer(settingsRef.current);
    })();
  }, []);

  const updateRules = (rules: ChapterRule[]) => void update({ library: { chapterRules: rules } });

  return (
    <div style={{ display: "grid", gap: 16, paddingBottom: 24 }}>
      <div>
        <Text variant="headline-3" weight="bold">
          Settings
        </Text>
        <Text variant="caption-1" color="neutral-faded">
          Kept as JSON at {dataInfo?.dataDir ?? "the app data folder"}, so it can travel with a git repo, your
          dotfiles or a Tailscale share.
        </Text>
      </div>

      <Tabs value={section} onChange={({ value }) => setSection(value as Section)}>
        <Tabs.List>
          <Tabs.Item value="look" icon={Palette}>
            Looks
          </Tabs.Item>
          <Tabs.Item value="player" icon={Layout}>
            Player
          </Tabs.Item>
          <Tabs.Item value="sound" icon={SlidersHorizontal}>
            Sound
          </Tabs.Item>
          <Tabs.Item value="library" icon={BookOpen}>
            Library
          </Tabs.Item>
          <Tabs.Item value="downloads" icon={Download}>
            Downloads
          </Tabs.Item>
          <Tabs.Item value="speech" icon={Speech}>
            Transcription
          </Tabs.Item>
          <Tabs.Item value="server" icon={Server}>
            Server
          </Tabs.Item>
          <Tabs.Item value="data" icon={Database}>
            Data
          </Tabs.Item>
        </Tabs.List>

        {/* ---------------------------------------------------------------- */}
        <Tabs.Panel value="look">
          <div style={{ display: "grid", gap: 18, maxWidth: 760 }}>
            <Field
              label="Theme"
              hint="Light is the default look. Adaptive keeps it light and takes the accent colour from the current book's cover; Dark is the same layout in graphite."
            >
              <Select
                name="theme"
                value={settings.theme}
                onChange={({ value }) => void update({ theme: value as ThemeMode })}
              >
                {THEME_OPTIONS.map((option) => (
                  <Select.Option key={option.value} value={option.value}>
                    {option.label}
                  </Select.Option>
                ))}
              </Select>
            </Field>

            <Field
              label="Adaptive colours"
              hint="Palette, gradients and glows follow the cover art of what is playing."
            >
              <Switch
                name="adaptive"
                checked={settings.adaptiveColors}
                onChange={({ checked }) => void update({ adaptiveColors: checked })}
              >
                {settings.adaptiveColors
                  ? "On - colours come from the cover"
                  : "Off - use the accent colour below"}
              </Switch>
            </Field>

            <Field label="Accent colour">
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input
                  type="color"
                  value={settings.accent}
                  onChange={(event) => void update({ accent: event.target.value })}
                  style={{
                    width: 44,
                    height: 32,
                    background: "none",
                    border: "1px solid var(--amp-hairline)",
                  }}
                />
                <TextField
                  name="accent"
                  value={settings.accent}
                  onChange={({ value }) => void update({ accent: value })}
                  attributes={{ style: { width: 160 } }}
                />
                <Text variant="caption-1" color="neutral-faded">
                  used for buttons, scrubbers and the waveform
                </Text>
              </div>
            </Field>

            <Divider />

            <Field
              label="Ambient tint"
              hint="A soft wash of colour from the current cover, behind a white background. It stays subtle on purpose - the accent colour and the slow drift are the effect."
            >
              <Switch
                name="bgTint"
                checked={settings.background.mode !== "off"}
                onChange={({ checked }) =>
                  void update({ background: { mode: checked ? "ambient" : "off", animated: checked } })
                }
              >
                {settings.background.mode === "off"
                  ? "Off - plain white background"
                  : "On - accent colour plus a drifting radial gradient"}
              </Switch>
            </Field>

            <Divider />

            <Field label="Corner radius" hint="0 is the default square look. Everything else follows it.">
              <Slider
                name="radius"
                min={0}
                max={2}
                step={0.125}
                value={settings.corners.radius}
                onChange={({ value }) => void update({ corners: { radius: value } })}
              />
            </Field>
            <Field label="Player surface radius">
              <Slider
                name="playerRadius"
                min={0}
                max={3}
                step={0.125}
                value={settings.corners.playerRadius}
                onChange={({ value }) => void update({ corners: { playerRadius: value } })}
              />
            </Field>
            <Field label="Corner shape" hint="Smooth draws continuous corners, the way system apps do.">
              <ToggleButtonGroup
                value={[settings.corners.style]}
                selectionMode="single"
                onChange={({ value }) =>
                  void update({ corners: { style: (value[0] as Settings["corners"]["style"]) ?? "round" } })
                }
              >
                <ToggleButton value="smooth">Smooth</ToggleButton>
                <ToggleButton value="round">Round</ToggleButton>
              </ToggleButtonGroup>
            </Field>

            <Divider />

            <Field label="Cover shape">
              <ToggleButtonGroup
                value={[settings.cover.shape]}
                selectionMode="single"
                onChange={({ value }) =>
                  void update({ cover: { shape: (value[0] as Settings["cover"]["shape"]) ?? "square" } })
                }
              >
                <ToggleButton value="square">Square</ToggleButton>
                <ToggleButton value="rounded">Rounded</ToggleButton>
                <ToggleButton value="circle">Circle</ToggleButton>
              </ToggleButtonGroup>
            </Field>
            <Field label="Cover glow">
              <Slider
                name="coverGlow"
                min={0}
                max={1}
                step={0.05}
                value={settings.cover.glow}
                onChange={({ value }) => void update({ cover: { glow: value } })}
              />
            </Field>
            <Field label="Cover drop shadow">
              <Slider
                name="coverShadow"
                min={0}
                max={1}
                step={0.05}
                value={settings.cover.shadow}
                onChange={({ value }) => void update({ cover: { shadow: value } })}
              />
            </Field>
            <Switch
              name="parallax"
              checked={settings.cover.parallax}
              onChange={({ checked }) => void update({ cover: { parallax: checked } })}
            >
              Tilt the cover with the mouse
            </Switch>

            <Divider />

            <Field
              label="Visualizer"
              hint="Wave, bars and aurora move with the sound. Around the cover and orbit wrap it around the artwork itself."
            >
              <ToggleButtonGroup
                value={[settings.visualizer.mode]}
                selectionMode="single"
                onChange={({ value }) =>
                  void update({
                    visualizer: { mode: (value[0] as Settings["visualizer"]["mode"]) ?? "wave" },
                  })
                }
              >
                {VISUALIZER_MODES.map((mode) => (
                  <ToggleButton key={mode.value} value={mode.value} attributes={{ title: mode.hint }}>
                    {mode.label}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Field>

            {/* Live preview: the same code path the player uses, driven by a
                synthetic spectrum so the shape is visible without playing. */}
            <VisualizerPreview settings={settings} />
            <Grid2>
              <SliderField
                label={`Lines (${settings.visualizer.lines})`}
                value={settings.visualizer.lines}
                min={1}
                max={4}
                step={1}
                onChange={(value) => void update({ visualizer: { lines: value } })}
              />
              <SliderField
                label={`Thickness (${settings.visualizer.thickness}px)`}
                value={settings.visualizer.thickness}
                min={1}
                max={6}
                step={0.5}
                onChange={(value) => void update({ visualizer: { thickness: value } })}
              />
              <SliderField
                label={`Offset from cover (${settings.visualizer.spacing}px)`}
                value={settings.visualizer.spacing}
                min={0}
                max={40}
                step={1}
                onChange={(value) => void update({ visualizer: { spacing: value } })}
              />
              <SliderField
                label={`Sensitivity (${settings.visualizer.sensitivity.toFixed(2)}x)`}
                value={settings.visualizer.sensitivity}
                min={0.2}
                max={3}
                step={0.05}
                onChange={(value) => void update({ visualizer: { sensitivity: value } })}
              />
              <SliderField
                label={`Smoothing (${settings.visualizer.smooth.toFixed(2)})`}
                value={settings.visualizer.smooth}
                min={0}
                max={0.95}
                step={0.01}
                onChange={(value) => void update({ visualizer: { smooth: value } })}
              />
              <SliderField
                label={`Opacity (${settings.visualizer.opacity}%)`}
                value={settings.visualizer.opacity}
                min={10}
                max={100}
                step={5}
                onChange={(value) => void update({ visualizer: { opacity: value } })}
              />
            </Grid2>
            <Grid2>
              <SliderField
                label={`Glow strength (${settings.visualizer.bloom}%)`}
                value={settings.visualizer.bloom}
                min={0}
                max={100}
                step={5}
                onChange={(value) => void update({ visualizer: { bloom: value } })}
              />
              <SliderField
                label={`Fade away from the cover (${settings.visualizer.decay}%)`}
                value={settings.visualizer.decay}
                min={20}
                max={100}
                step={2}
                hint="Higher fades the outer rings out faster."
                onChange={(value) => void update({ visualizer: { decay: value } })}
              />
              <SliderField
                label={`Halo turn (${settings.visualizer.rotation}%)`}
                value={settings.visualizer.rotation}
                min={0}
                max={100}
                step={2}
                hint="Orbit turns; the ring highlight travels either way."
                onChange={(value) => void update({ visualizer: { rotation: value } })}
              />
            </Grid2>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <Switch
                name="vzGlow"
                checked={settings.visualizer.glow}
                onChange={({ checked }) => void update({ visualizer: { glow: checked } })}
              >
                Glow
              </Switch>
              <Switch
                name="vzMirror"
                checked={settings.visualizer.mirror}
                onChange={({ checked }) => void update({ visualizer: { mirror: checked } })}
              >
                Mirrored (symmetric wave, mirrored bars)
              </Switch>
              <Switch
                name="vzFill"
                checked={settings.visualizer.fill}
                onChange={({ checked }) => void update({ visualizer: { fill: checked } })}
              >
                Soft fill under the line
              </Switch>
              <Switch
                name="vzPeaks"
                checked={settings.visualizer.peaks}
                onChange={({ checked }) => void update({ visualizer: { peaks: checked } })}
              >
                Peak caps on the bars
              </Switch>
              <Switch
                name="vzReflection"
                checked={settings.visualizer.reflection}
                onChange={({ checked }) => void update({ visualizer: { reflection: checked } })}
              >
                Reflection under the bars
              </Switch>
            </div>
          </div>
        </Tabs.Panel>

        {/* ---------------------------------------------------------------- */}
        <Tabs.Panel value="player">
          <div style={{ display: "grid", gap: 18, maxWidth: 760 }}>
            <Field label="Layout">
              <ToggleButtonGroup
                value={[settings.player.layout]}
                selectionMode="single"
                onChange={({ value }) =>
                  void update({ player: { layout: (value[0] as Settings["player"]["layout"]) ?? "bar" } })
                }
              >
                <ToggleButton value="bar">Bottom bar</ToggleButton>
                <ToggleButton value="widget">Widget</ToggleButton>
                <ToggleButton value="full">Full screen</ToggleButton>
              </ToggleButtonGroup>
            </Field>
            <SliderField
              label={`Panel blur (${settings.player.blur}px)`}
              value={settings.player.blur}
              min={0}
              max={40}
              step={1}
              onChange={(value) => void update({ player: { blur: value } })}
            />
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <Switch
                name="aot"
                checked={settings.window.widgetAlwaysOnTop}
                onChange={({ checked }) => {
                  void update({ window: { widgetAlwaysOnTop: checked } });
                  void getBridge().then((host) => host.player.setAlwaysOnTop(checked));
                }}
              >
                Mini widget always on top
              </Switch>
              <Button variant="outline" onClick={() => useUiStore.getState().setMini(true)}>
                Try the mini widget
              </Button>
            </div>
            <Divider />
            <Grid2>
              <Field label={`Skip forward (${settings.playback.skipSeconds}s)`}>
                <Slider
                  name="skipForward"
                  min={5}
                  max={120}
                  step={5}
                  value={settings.playback.skipSeconds}
                  onChange={({ value }) => void update({ playback: { skipSeconds: value } })}
                />
              </Field>
              <Field label={`Skip back (${settings.playback.skipBackSeconds}s)`}>
                <Slider
                  name="skipBack"
                  min={5}
                  max={120}
                  step={5}
                  value={settings.playback.skipBackSeconds}
                  onChange={({ value }) => void update({ playback: { skipBackSeconds: value } })}
                />
              </Field>
              <Field label={`Sleep fade out (${settings.playback.sleepFade}s)`}>
                <Slider
                  name="sleepFade"
                  min={0}
                  max={120}
                  step={5}
                  value={settings.playback.sleepFade}
                  onChange={({ value }) => void update({ playback: { sleepFade: value } })}
                />
              </Field>
              <Field label="Default speed">
                <Slider
                  name="defaultSpeed"
                  min={0.5}
                  max={3}
                  step={0.05}
                  value={settings.playback.speed}
                  onChange={({ value }) => void update({ playback: { speed: value } })}
                />
              </Field>
            </Grid2>
            <Switch
              name="resume"
              checked={settings.playback.resume}
              onChange={({ checked }) => void update({ playback: { resume: checked } })}
            >
              Remember the position in every book
            </Switch>
            <Grid2>
              <SliderField
                label={`Rewind on resume (${settings.playback.resumeRewind}s)`}
                value={settings.playback.resumeRewind}
                min={0}
                max={30}
                step={1}
                onChange={(value) => void update({ playback: { resumeRewind: value } })}
              />
              <Field label="Open Amp on" hint="Which page the window shows when it starts.">
                <ToggleButtonGroup
                  value={[settings.startRoute]}
                  selectionMode="single"
                  onChange={({ value }) =>
                    void update({ startRoute: (value[0] as Settings["startRoute"]) ?? "home" })
                  }
                >
                  <ToggleButton value="home">Home</ToggleButton>
                  <ToggleButton value="library">Library</ToggleButton>
                  <ToggleButton value="nowplaying">Player</ToggleButton>
                </ToggleButtonGroup>
              </Field>
            </Grid2>
            <Switch
              name="autoNext"
              checked={settings.playback.autoNext}
              onChange={({ checked }) => void update({ playback: { autoNext: checked } })}
            >
              Start the next queued book when one finishes
            </Switch>
            <Switch
              name="rememberChapters"
              checked={settings.playback.rememberChapters}
              onChange={({ checked }) => void update({ playback: { rememberChapters: checked } })}
            >
              Remember where each chapter was left, and continue with the remaining
            </Switch>
            <DesktopStartupCard />
            <Divider />
            <Field label="Shortcuts">
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <Button variant="outline" icon={Keyboard} onClick={() => openDialog({ kind: "shortcuts" })}>
                  Edit {Object.keys(settings.shortcuts).length} shortcuts
                </Button>
                <Text variant="caption-1" color="neutral-faded">
                  <Kbd accelerator="Space" /> play/pause - <Kbd accelerator="Ctrl+Shift+M" /> mini widget -{" "}
                  <Kbd accelerator="Alt+Shift+A" /> wake from the tray
                </Text>
              </div>
            </Field>
          </div>
        </Tabs.Panel>

        {/* ---------------------------------------------------------------- */}
        <Tabs.Panel value="sound">
          <div style={{ display: "grid", gap: 18, maxWidth: 760 }}>
            <AudioEffectsCard />
            <Divider />

            <Field label="Equalizer" hint="Ten bands with automatic headroom, plus presets for narration.">
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <Switch
                  name="eqOn"
                  checked={settings.equalizer.enabled}
                  onChange={({ checked }) => void update({ equalizer: { enabled: checked } })}
                >
                  {settings.equalizer.enabled ? "Enabled" : "Disabled"}
                </Switch>
                <Select
                  name="eqPreset"
                  size="small"
                  value={settings.equalizer.preset}
                  onChange={({ value }) => {
                    if (value === "custom") return;
                    const preset = presetById(value);
                    void update({
                      equalizer: {
                        preset: value,
                        gains: preset.gains,
                        preamp: preset.preamp ?? 0,
                        enabled: true,
                      },
                    });
                  }}
                >
                  <Select.Option value="custom">Custom</Select.Option>
                  {[
                    "flat",
                    "spoken",
                    "podcast",
                    "loudness",
                    "bass",
                    "basscut",
                    "treble",
                    "vocal",
                    "cinema",
                    "sleep",
                    "walk",
                  ].map((id) => (
                    <Select.Option key={id} value={id}>
                      {presetById(id).name}
                    </Select.Option>
                  ))}
                </Select>
                <Button
                  size="small"
                  variant="outline"
                  icon={SlidersHorizontal}
                  onClick={() => openDialog({ kind: "eq" })}
                >
                  Open the curve editor
                </Button>
              </div>
            </Field>

            <Divider />

            <Field label="Output device" hint="Uses the browser/Electron setSinkId API.">
              <Select
                name="output"
                value={settings.audio.outputDevice}
                onChange={({ value }) => {
                  void update({ audio: { outputDevice: value } });
                  void import("../../audio/audioEngine").then(({ engine }) => engine.setOutputDevice(value));
                }}
              >
                <Select.Option value="">System default</Select.Option>
                {outputs.map((device, index) => (
                  <Select.Option key={device.deviceId || index} value={device.deviceId}>
                    {device.label || `Output ${index + 1}`}
                  </Select.Option>
                ))}
              </Select>
            </Field>
            <Field label="Channels">
              <ToggleButtonGroup
                value={[settings.audio.channelMode]}
                selectionMode="single"
                onChange={({ value }) =>
                  void update({
                    audio: { channelMode: (value[0] as Settings["audio"]["channelMode"]) ?? "stereo" },
                  })
                }
              >
                <ToggleButton value="stereo">Stereo</ToggleButton>
                <ToggleButton value="mono">Mono (single ear)</ToggleButton>
                <ToggleButton value="swap">Swap left/right</ToggleButton>
              </ToggleButtonGroup>
            </Field>
            <Switch
              name="normalize"
              checked={settings.audio.normalize}
              onChange={({ checked }) => void update({ audio: { normalize: checked } })}
            >
              Level quiet recordings and hot masters
            </Switch>
            <Field label={`Crossfade between chapter files (${settings.audio.crossfade}s)`}>
              <Slider
                name="crossfade"
                min={0}
                max={10}
                step={0.5}
                value={settings.audio.crossfade}
                onChange={({ value }) => void update({ audio: { crossfade: value } })}
              />
            </Field>
            <Switch
              name="trim"
              checked={settings.audio.trimSilence}
              onChange={({ checked }) => void update({ audio: { trimSilence: checked } })}
            >
              Trim leading silence on chapter changes
            </Switch>
          </div>
        </Tabs.Panel>

        {/* ---------------------------------------------------------------- */}
        <Tabs.Panel value="library">
          <div style={{ display: "grid", gap: 18, maxWidth: 820 }}>
            <Switch
              name="groupFolders"
              checked={settings.library.groupFolders}
              onChange={({ checked }) => void update({ library: { groupFolders: checked } })}
            >
              {settings.library.groupFolders
                ? "Group sibling tracks in a folder into one book with chapters"
                : "Import every audio file as its own book"}
            </Switch>
            <Switch
              name="watch"
              checked={settings.library.watchFolders}
              onChange={({ checked }) => void update({ library: { watchFolders: checked } })}
            >
              Watch imported folders and pick up new files automatically
            </Switch>
            <Switch
              name="scanOnStart"
              checked={settings.library.scanOnStart}
              onChange={({ checked }) => void update({ library: { scanOnStart: checked } })}
            >
              Rescan the library on launch
            </Switch>

            <Divider />

            <Field
              label="Chapter detection rules"
              hint="Applied to file names when a folder is imported. {n} is the captured number, {name} the rest of the name."
            >
              <div style={{ display: "grid", gap: 8 }}>
                {settings.library.chapterRules.map((rule, index) => (
                  <div key={index} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <TextField
                      name={`pattern-${index}`}
                      value={rule.pattern}
                      onChange={({ value }) =>
                        updateRules(
                          settings.library.chapterRules.map((item, i) =>
                            i === index ? { ...item, pattern: value } : item,
                          ),
                        )
                      }
                      attributes={{ style: { flex: "1 1 320px" } }}
                    />
                    <TextField
                      name={`template-${index}`}
                      value={rule.template}
                      onChange={({ value }) =>
                        updateRules(
                          settings.library.chapterRules.map((item, i) =>
                            i === index ? { ...item, template: value } : item,
                          ),
                        )
                      }
                      attributes={{ style: { flex: "0 1 220px" } }}
                    />
                    <Button
                      variant="ghost"
                      color="critical"
                      icon={Trash2}
                      onClick={() => updateRules(settings.library.chapterRules.filter((_, i) => i !== index))}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  onClick={() =>
                    updateRules([
                      ...settings.library.chapterRules,
                      { pattern: "^(\\d+)", template: "Chapter {n}" },
                    ])
                  }
                >
                  Add rule
                </Button>
              </div>
            </Field>

            <Divider />

            <Field label="Cover search provider">
              <Select
                name="coverProvider"
                value={settings.library.coverSearchProvider}
                onChange={({ value }) =>
                  void update({
                    library: { coverSearchProvider: value as Settings["library"]["coverSearchProvider"] },
                  })
                }
              >
                <Select.Option value="openlibrary">Open Library</Select.Option>
                <Select.Option value="googlebooks">Google Books</Select.Option>
                <Select.Option value="itunes">Apple Books / iTunes</Select.Option>
              </Select>
            </Field>

            <Field label="Default sorting">
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Select
                  name="defaultSort"
                  size="small"
                  value={settings.library.sort.key}
                  onChange={({ value }) =>
                    void update({
                      library: {
                        sort: { ...settings.library.sort, key: value as Settings["library"]["sort"]["key"] },
                      },
                    })
                  }
                >
                  {[
                    "manual",
                    "added",
                    "lastPlayed",
                    "title",
                    "author",
                    "series",
                    "duration",
                    "progress",
                    "year",
                  ].map((key) => (
                    <Select.Option key={key} value={key}>
                      {key}
                    </Select.Option>
                  ))}
                </Select>
                <Select
                  name="defaultDirection"
                  size="small"
                  value={settings.library.sort.direction}
                  onChange={({ value }) =>
                    void update({
                      library: {
                        sort: { ...settings.library.sort, direction: value as "asc" | "desc" },
                      },
                    })
                  }
                >
                  <Select.Option value="asc">Ascending</Select.Option>
                  <Select.Option value="desc">Descending</Select.Option>
                </Select>
              </div>
            </Field>
          </div>
        </Tabs.Panel>

        {/* ---------------------------------------------------------------- */}
        <Tabs.Panel value="downloads">
          <div style={{ display: "grid", gap: 18, maxWidth: 820 }}>
            <Alert color="neutral">
              Amp talks to qBittorrent over its Web API. Enable the Web UI in qBittorrent (Tools, Options, Web
              UI), then fill in the details below. Sequential downloading is recommended so new audiobooks
              stream while they finish.
            </Alert>
            <Grid2>
              <Field label="qBittorrent URL">
                <TextField
                  name="qbUrl"
                  value={settings.torrents.qbittorrent.url}
                  onChange={({ value }) =>
                    void update({
                      torrents: { qbittorrent: { ...settings.torrents.qbittorrent, url: value } },
                    })
                  }
                />
              </Field>
              <Field label="Category">
                <TextField
                  name="qbCategory"
                  value={settings.torrents.qbittorrent.category}
                  onChange={({ value }) =>
                    void update({
                      torrents: { qbittorrent: { ...settings.torrents.qbittorrent, category: value } },
                    })
                  }
                />
              </Field>
              <Field label="Username">
                <TextField
                  name="qbUser"
                  value={settings.torrents.qbittorrent.username}
                  onChange={({ value }) =>
                    void update({
                      torrents: { qbittorrent: { ...settings.torrents.qbittorrent, username: value } },
                    })
                  }
                />
              </Field>
              <Field label="Password">
                <TextField
                  name="qbPass"
                  value={settings.torrents.qbittorrent.password}
                  onChange={({ value }) =>
                    void update({
                      torrents: { qbittorrent: { ...settings.torrents.qbittorrent, password: value } },
                    })
                  }
                />
              </Field>
              <Field label="Save path (optional)">
                <TextField
                  name="qbPath"
                  value={settings.torrents.qbittorrent.savePath ?? ""}
                  onChange={({ value }) =>
                    void update({
                      torrents: { qbittorrent: { ...settings.torrents.qbittorrent, savePath: value } },
                    })
                  }
                />
              </Field>
              <Field label={`Minimum seeders (${settings.torrents.minSeeders})`}>
                <Slider
                  name="minSeeders"
                  min={0}
                  max={100}
                  step={1}
                  value={settings.torrents.minSeeders}
                  onChange={({ value }) => void update({ torrents: { minSeeders: value } })}
                />
              </Field>
            </Grid2>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <Switch
                name="qbSequential"
                checked={settings.torrents.qbittorrent.sequential}
                onChange={({ checked }) =>
                  void update({
                    torrents: { qbittorrent: { ...settings.torrents.qbittorrent, sequential: checked } },
                  })
                }
              >
                Sequential download (listen while it downloads)
              </Switch>
              <Switch
                name="autoImport"
                checked={settings.torrents.autoImport}
                onChange={({ checked }) => void update({ torrents: { autoImport: checked } })}
              >
                Import finished downloads into the library
              </Switch>
            </div>
            <Field label="Indexers">
              <div style={{ display: "grid", gap: 8 }}>
                {settings.torrents.sources.map((source) => (
                  <div
                    key={source.id}
                    style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}
                  >
                    <Switch
                      name={`source-${source.id}`}
                      checked={source.enabled}
                      onChange={({ checked }) =>
                        void update({
                          torrents: {
                            sources: settings.torrents.sources.map((item) =>
                              item.id === source.id ? { ...item, enabled: checked } : item,
                            ),
                          },
                        })
                      }
                    >
                      {source.name}
                    </Switch>
                    <TextField
                      name={`url-${source.id}`}
                      value={source.baseUrl}
                      onChange={({ value }) =>
                        void update({
                          torrents: {
                            sources: settings.torrents.sources.map((item) =>
                              item.id === source.id ? { ...item, baseUrl: value } : item,
                            ),
                          },
                        })
                      }
                      attributes={{ style: { flex: "1 1 240px" } }}
                    />
                  </div>
                ))}
                <Button
                  variant="outline"
                  icon={HardDriveDownload}
                  onClick={() =>
                    void update({
                      torrents: {
                        sources: [
                          ...settings.torrents.sources,
                          {
                            id: `custom-${Date.now()}`,
                            name: "Custom indexer",
                            kind: "scraper",
                            enabled: true,
                            baseUrl: "",
                          },
                        ],
                      },
                    })
                  }
                >
                  Add indexer
                </Button>
              </div>
            </Field>
          </div>
        </Tabs.Panel>

        {/* ---------------------------------------------------------------- */}
        <Tabs.Panel value="speech">
          <div style={{ display: "grid", gap: 18, maxWidth: 820 }}>
            <Alert color={probe?.available ? "positive" : "warning"}>
              {probe?.available
                ? `Whisper found: ${probe.version ?? "detected"}. Amp transcribes one chapter at a time and can rebuild chapter lists from the speech itself.`
                : `No Whisper binary detected yet. ${probe?.detail ?? ""} Install whisper.cpp or faster-whisper, then point Amp at the binary below.`}
            </Alert>
            <Switch
              name="transcribeEnabled"
              checked={settings.transcription.enabled}
              onChange={({ checked }) => void update({ transcription: { enabled: checked } })}
            >
              Enable transcription features
            </Switch>
            <Grid2>
              <Field label="Provider">
                <Select
                  name="provider"
                  value={settings.transcription.provider}
                  onChange={({ value }) =>
                    void update({
                      transcription: { provider: value as Settings["transcription"]["provider"] },
                    })
                  }
                >
                  <Select.Option value="whisper-cpp">whisper.cpp (fastest locally)</Select.Option>
                  <Select.Option value="local-whisper">openai-whisper / faster-whisper</Select.Option>
                  <Select.Option value="openai">OpenAI API</Select.Option>
                </Select>
              </Field>
              <Field label="Model">
                <Select
                  name="model"
                  value={settings.transcription.model}
                  onChange={({ value }) => void update({ transcription: { model: value } })}
                >
                  {["tiny", "base", "small", "medium", "large-v3-turbo", "large-v3"].map((model) => (
                    <Select.Option key={model} value={model}>
                      {model}
                    </Select.Option>
                  ))}
                </Select>
              </Field>
              <Field label="Binary / command">
                <TextField
                  name="binary"
                  value={settings.transcription.binaryPath}
                  onChange={({ value }) => void update({ transcription: { binaryPath: value } })}
                />
              </Field>
              <Field label="Language">
                <TextField
                  name="language"
                  value={settings.transcription.language}
                  onChange={({ value }) => void update({ transcription: { language: value } })}
                />
              </Field>
            </Grid2>
            <Switch
              name="translate"
              checked={settings.transcription.translate}
              onChange={({ checked }) => void update({ transcription: { translate: checked } })}
            >
              Translate to English
            </Switch>
            <div style={{ display: "flex", gap: 10 }}>
              <Button
                variant="outline"
                onClick={() =>
                  void getBridge().then(async (host) => setProbe(await host.transcription.probe()))
                }
              >
                Re-check for Whisper
              </Button>
              <Button variant="outline" onClick={() => openDialog({ kind: "transcribe", bookId: "" })}>
                Transcribe a book
              </Button>
            </div>
          </div>
        </Tabs.Panel>

        {/* ---------------------------------------------------------------- */}
        <Tabs.Panel value="server">
          <div style={{ display: "grid", gap: 18, maxWidth: 820 }}>
            <Alert color="neutral">
              The optional server serves this same UI and streams your audio over your Tailscale network, so a
              phone or laptop on the tailnet can listen without copying files. Python users can run the same
              thing with <code>python server.py</code>.
            </Alert>
            <Switch
              name="serverEnabled"
              checked={settings.server.enabled}
              onChange={({ checked }) => void update({ server: { enabled: checked } })}
            >
              Enable the streaming server
            </Switch>
            <Grid2>
              <Field label="Bind address">
                <TextField
                  name="host"
                  value={settings.server.host}
                  onChange={({ value }) => void update({ server: { host: value } })}
                />
              </Field>
              <Field label="Port">
                <TextField
                  name="port"
                  value={String(settings.server.port)}
                  onChange={({ value }) =>
                    void update({ server: { port: Number(value.replace(/[^0-9]/g, "")) || 7777 } })
                  }
                />
              </Field>
              <Field label="Access token (optional)">
                <TextField
                  name="token"
                  value={settings.server.token}
                  onChange={({ value }) => void update({ server: { token: value } })}
                />
              </Field>
              <Field label={`Max bitrate for transcoding (${settings.server.maxBitrate} kbps)`}>
                <Slider
                  name="maxBitrate"
                  min={32}
                  max={320}
                  step={8}
                  value={settings.server.maxBitrate}
                  onChange={({ value }) => void update({ server: { maxBitrate: value } })}
                />
              </Field>
            </Grid2>
            <Switch
              name="transcode"
              checked={settings.server.transcode}
              onChange={({ checked }) => void update({ server: { transcode: checked } })}
            >
              Transcode on the fly (smaller bandwidth, more CPU)
            </Switch>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <Button
                color="primary"
                onClick={() =>
                  void getBridge()
                    .then((host) => host.server.start())
                    .then((status) => {
                      setServerStatus(status);
                      toast({
                        title: status.running ? `Server listening on ${status.url}` : "Server did not start",
                        tone: status.running ? "success" : "danger",
                      });
                    })
                }
              >
                Start server
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  void getBridge()
                    .then((host) => host.server.stop())
                    .then(setServerStatus)
                }
              >
                Stop
              </Button>
              {serverStatus && (
                <Badge color={serverStatus.running ? "positive" : "neutral"} size="small">
                  {serverStatus.running ? `Running at ${serverStatus.url}` : "Stopped"}
                </Badge>
              )}
            </div>
          </div>
        </Tabs.Panel>

        {/* ---------------------------------------------------------------- */}
        <Tabs.Panel value="data">
          <div style={{ display: "grid", gap: 18, maxWidth: 820 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <Badge size="small" variant="faded">
                <FileCog size={11} /> library.json
              </Badge>
              <Text
                variant="caption-1"
                color="neutral-faded"
                attributes={{ style: { wordBreak: "break-all" } }}
              >
                {dataInfo?.dataDir ?? "…"}
              </Text>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Button
                variant="outline"
                onClick={() =>
                  void getBridge()
                    .then((host) => host.settings.export())
                    .then((json) => {
                      const blob = new Blob([json], { type: "application/json" });
                      const url = URL.createObjectURL(blob);
                      const anchor = document.createElement("a");
                      anchor.href = url;
                      anchor.download = "amp-settings.json";
                      anchor.click();
                      URL.revokeObjectURL(url);
                    })
                }
              >
                Export settings
              </Button>
              <label className="amp-nav-item" style={{ width: "auto", cursor: "pointer" }}>
                <AudioLines size={15} /> Import settings
                <input
                  type="file"
                  accept="application/json"
                  style={{ display: "none" }}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () =>
                      void getBridge()
                        .then((host) => host.settings.import(String(reader.result)))
                        .then((next) => replace(next))
                        .then(() => toast({ title: "Settings imported", tone: "success" }));
                    reader.readAsText(file);
                  }}
                />
              </label>
              <Button variant="outline" icon={Waves} onClick={() => void rescanLibraryNow()}>
                Rescan the library
              </Button>
              <Button
                variant="ghost"
                color="critical"
                icon={RotateCcw}
                onClick={() =>
                  void replace(defaultSettings).then(() =>
                    toast({ title: "Settings reset to defaults", tone: "info" }),
                  )
                }
              >
                Reset settings
              </Button>
            </div>
            <Divider />
            <Text variant="caption-1" color="neutral-faded">
              Amp never renames or moves your audio files. The library index, covers, transcripts and settings
              live beside your user data folder and can be backed up, synced or version controlled.
            </Text>
          </div>
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}

/** Rescan runs from the store, which knows the current import settings. */
async function rescanLibraryNow(): Promise<void> {
  const { useLibraryStore } = await import("../../store/useLibraryStore");
  await useLibraryStore.getState().rescan();
}

/**
 * Visualizer preview.
 *
 * Draws with the very same `drawFrame` the player uses, fed a synthetic
 * spectrum that pulses like speech, so changing a slider shows the result
 * immediately - no playing book required.
 */
/**
 * The state of the Web Audio graph.
 *
 * Amp plays without the equalizer and the visualizer when a system refuses to
 * open an audio context, and the notice it raises says Settings can try again -
 * this is where that happens. The retry builds the graph on a fresh element, so
 * it also fixes the case where an earlier attempt left the sound captured.
 */
/**
 * Start on startup.
 *
 * The checkbox is only offered where it can actually work: a browser has no
 * login items, and on Linux the answer depends on the desktop environment. What
 * it shows is what the operating system reports back, not what was asked for.
 */
function DesktopStartupCard() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const [state, setState] = useState<{ supported: boolean; openAtLogin: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    void bridgeIfReady()
      ?.library.startup?.()
      .then((answer) => live && setState(answer))
      .catch(() => live && setState({ supported: false, openAtLogin: false }));
    return () => {
      live = false;
    };
  }, [settings.desktop.launchOnStartup]);

  const supported = state?.supported ?? false;

  return (
    <Field
      label="Starting up"
      hint={
        supported
          ? "Amp can start with the operating system and wait in the tray."
          : "Starting with the system is a desktop feature - the app registers a login item with Windows or macOS. In the browser this row is informational."
      }
    >
      <div style={{ display: "grid", gap: 10 }}>
        <Switch
          name="launchOnStartup"
          checked={settings.desktop.launchOnStartup}
          disabled={!supported}
          onChange={({ checked }) => void update({ desktop: { launchOnStartup: checked } })}
        >
          Start Amp when I sign in
        </Switch>
        <Switch
          name="startHidden"
          checked={settings.desktop.startHidden}
          disabled={!supported || !settings.desktop.launchOnStartup}
          onChange={({ checked }) => void update({ desktop: { startHidden: checked } })}
        >
          Start into the tray, without opening the window
        </Switch>
        <Text variant="caption-1" color="neutral-faded">
          {supported
            ? state?.openAtLogin
              ? "Registered with the system. Closing the window keeps Amp in the tray."
              : "Not registered yet - turn the first switch on and Amp will write the login item."
            : "Apps opened from a browser cannot register themselves with the system."}
        </Text>
      </div>
    </Field>
  );
}

function AudioEffectsCard() {
  const graphRefused = usePlayerStore((s) => s.graphRefused);
  const graphPending = usePlayerStore((s) => s.graphPending);
  const retryEffects = usePlayerStore((s) => s.retryEffects);
  const toast = useUiStore((s) => s.toast);
  const [busy, setBusy] = useState(false);
  /*
   * The visualizer keeps its own analyser for machines that will not build the
   * graph: the audio element hands out a stream of its own output without being
   * captured. So "the effects are off" and "nothing is being drawn" are not the
   * same sentence any more, and reporting the second when only the first is
   * true is how a working visualizer gets called broken.
   */
  const drawing = engine.hasAnalyser();

  return (
    <Field
      label="Audio effects"
      hint="The equalizer and the visualizer run inside one Web Audio graph. A browser only lets that graph start once the page has been touched, and a few machines will not start one at all - neither case stops the sound."
    >
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <Text variant="body-3" color={graphRefused ? "warning" : "neutral-faded"}>
          {graphRefused
            ? drawing
              ? "Equalizer off - Amp could not open an effects graph on this machine - and the visualizer is reading the audio element's own output instead."
              : "The equalizer and the visualizer need an effects graph, and Amp could not open one here. The book is playing normally."
            : graphPending
              ? "Waiting for your first click. The graph is ready and starts with the next click or key press - the equalizer and the visualizer come up with it."
              : "Running. The equalizer and the visualizer are live."}
        </Text>
        <Button
          size="small"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void retryEffects()
              .then((ok) =>
                toast({
                  title: ok ? "Audio effects are back" : "No effects graph here",
                  description: ok
                    ? "The equalizer and the visualizer are running again, and the book kept playing."
                    : "This machine will not open one for Amp. Playback is unaffected, and it is retried on the next click.",
                  tone: ok ? "success" : "info",
                }),
              )
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Trying..." : graphRefused ? "Try the effects again" : "Rebuild the effects graph"}
        </Button>
      </div>
    </Field>
  );
}

function VisualizerPreview({ settings }: { settings: Settings }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    let frame = 0;
    const state = new VisualizerState(160);
    const render = () => {
      frame = window.requestAnimationFrame(render);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const bounds = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.floor(bounds.width * dpr));
      const height = Math.max(1, Math.floor(bounds.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const current = settingsRef.current;
      const time = performance.now() / 1000;
      // A voice-like spectrum: a moving formant pair over a soft floor.
      for (let i = 0; i < state.levels.length; i += 1) {
        const position = i / state.levels.length;
        const formant =
          Math.exp(-Math.pow((position - (0.24 + 0.08 * Math.sin(time * 0.7))) * 6, 2)) * 0.9 +
          Math.exp(-Math.pow((position - (0.46 + 0.1 * Math.sin(time * 0.53 + 1.2))) * 7, 2)) * 0.6;
        const floor = 0.08 + 0.05 * Math.sin(time * 2 + i * 0.3);
        const target = Math.min(1, formant + floor);
        state.levels[i] = (state.levels[i] ?? 0) + (target - (state.levels[i] ?? 0)) * 0.18;
      }

      const rect = {
        x: bounds.width / 2 - 62,
        y: bounds.height / 2 - 62,
        width: 124,
        height: 124,
        radius: 10,
      };
      drawFrame(
        ctx,
        state,
        {
          ...DEFAULT_VISUALIZER,
          ...current.visualizer,
          color: current.accent && current.adaptiveColors ? current.accent : "#6c8cff",
          colorAlt: "#b06cff",
        },
        current.visualizer.mode === "cover" ? rect : null,
      );
    };
    frame = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="amp-vz-preview">
      <span className="amp-vz-preview-cover" aria-hidden />
      <canvas ref={canvasRef} className="amp-visualizer" aria-hidden />
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <Text variant="body-2" weight="semibold">
        {label}
      </Text>
      {hint && (
        <Text variant="caption-2" color="neutral-faded">
          {hint}
        </Text>
      )}
      {children}
    </div>
  );
}

function Grid2({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
      {children}
    </div>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  hint?: string;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <Slider
        name={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={({ value: next }) => onChange(next)}
      />
    </Field>
  );
}

export const settingsMeta = { BookOpen };
