/** Scrolls long titles on overflow (like the OS now-playing widgets). */

import { useEffect, useRef, useState } from "react";

export function MarqueeText({
  text,
  className,
  variant,
}: {
  text: string;
  className?: string;
  variant?: "body-2" | "caption-1";
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const check = () => setOverflow(element.scrollWidth > element.clientWidth + 4);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text]);

  return (
    <div className={`amp-marquee ${className ?? ""}`} data-overflow={overflow} title={text}>
      <span ref={ref} style={{ fontSize: variant === "caption-1" ? 12 : 14 }}>
        {text}
      </span>
    </div>
  );
}
