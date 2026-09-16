/** Compact route switcher shown when the window is narrow (or on phones). */

import { Button } from "reshaped";
import { Download, FileText, Library, ListOrdered, Search, Settings, Waves } from "lucide-react";
import type { Route } from "../../store/useUiStore";
import { useUiStore } from "../../store/useUiStore";

export function MobileNav({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const route = useUiStore((s) => s.route);
  const items: { route: Route; icon: typeof Library; label: string }[] = [
    { route: "library", icon: Library, label: "Library" },
    { route: "nowplaying", icon: Waves, label: "Playing" },
    { route: "search", icon: Search, label: "Find" },
    { route: "downloads", icon: Download, label: "Downloads" },
    { route: "queue", icon: ListOrdered, label: "Queue" },
    { route: "transcript", icon: FileText, label: "Transcript" },
    { route: "settings", icon: Settings, label: "Settings" },
  ];

  return (
    <div style={{ display: "flex", gap: 4, padding: "8px 10px", overflowX: "auto" }}>
      {items.map((item) => (
        <Button
          key={item.route}
          size="small"
          variant={route === item.route ? "solid" : "ghost"}
          color={route === item.route ? "primary" : "neutral"}
          icon={item.icon}
          onClick={() => onNavigate(item.route)}
        >
          {item.label}
        </Button>
      ))}
    </div>
  );
}
