import { Text } from "reshaped";
import type { LucideIcon } from "lucide-react";

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="amp-stat">
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--amp-accent)" }}>
        <Icon size={15} />
        <Text variant="caption-1" color="neutral-faded">
          {label}
        </Text>
      </div>
      <Text variant="featured-4" weight="semibold">
        {value}
      </Text>
      {hint && (
        <Text variant="caption-2" color="neutral-faded">
          {hint}
        </Text>
      )}
    </div>
  );
}
