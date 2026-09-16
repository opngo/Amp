/** Renders an accelerator string as key caps ("Ctrl + Shift + M"). */

import { prettyAccelerator } from "@amp/core";

export function Kbd({ accelerator, faded = false }: { accelerator: string; faded?: boolean }) {
  const parts = prettyAccelerator(accelerator)
    .split(" + ")
    .flatMap((part, index, all) => [part, ...(index < all.length - 1 ? [] : [])]);

  return (
    <span style={{ display: "inline-flex", gap: 4, opacity: faded ? 0.6 : 1 }}>
      {parts.map((part, index) => (
        <kbd className="amp-kbd" key={`${part}-${index}`}>
          {part}
        </kbd>
      ))}
    </span>
  );
}
