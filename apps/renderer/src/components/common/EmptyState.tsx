/**
 * The quiet empty state: an icon in a soft tile, a short line, one action.
 * Used whenever a screen has nothing to show, so the app never shows a blank
 * pane or invented content.
 */

import { Button, Text } from "reshaped";
import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  return (
    <div className="amp-empty">
      {Icon && (
        <span className="amp-empty-icon">
          <Icon size={26} />
        </span>
      )}
      <Text variant="featured-5" weight="semibold">
        {title}
      </Text>
      <Text variant="body-2" color="neutral-faded" align="center" attributes={{ style: { maxWidth: 520 } }}>
        {description}
      </Text>
      {(actionLabel || secondaryLabel) && (
        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          {actionLabel && onAction && (
            <Button color="primary" onClick={onAction}>
              {actionLabel}
            </Button>
          )}
          {secondaryLabel && onSecondary && (
            <Button variant="outline" onClick={onSecondary}>
              {secondaryLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
