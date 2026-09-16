/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { AmpLogo, CoverArt, VisualizerCanvas, type VisualizerSettings } from "../index";

const settings: VisualizerSettings = {
  mode: "bars",
  lines: 2,
  sensitivity: 1,
  thickness: 2,
  spacing: 10,
  smooth: 0.7,
  glow: true,
  mirror: false,
  color: "#6c8cff",
  colorAlt: "#ff9ecb",
};

describe("@amp/ui", () => {
  it("draws the Amp mark with the brand gradient by default", () => {
    const { container, getByLabelText } = render(<AmpLogo size={20} />);
    expect(getByLabelText("Amp")).toBeTruthy();
    expect(container.querySelector("linearGradient")).toBeTruthy();
    // Two rectangles: the tile, and the white cover square inside it.
    expect(container.querySelectorAll("rect")).toHaveLength(2);
  });

  it("rides the circles around the cover at icon sizes", () => {
    const { container } = render(<AmpLogo size={64} />);
    expect(container.querySelectorAll("circle")).toHaveLength(3);
    expect(container.querySelectorAll("circle")[0].getAttribute("r")).toBe("105");
  });

  it("can render the mark monochrome for buttons", () => {
    const { container } = render(<AmpLogo mono />);
    expect(container.querySelector("linearGradient")).toBeNull();
  });

  it("falls back to a gradient placeholder when there is no cover", () => {
    const { getByLabelText } = render(<CoverArt alt="Dune by Frank Herbert" />);
    const node = getByLabelText("Dune by Frank Herbert");
    expect(node.getAttribute("style")).toContain("linear-gradient");
  });

  it("keeps covers square", () => {
    const { getByAltText } = render(<CoverArt src="data:image/png;base64,AA" alt="Neuromancer" size={64} />);
    const img = getByAltText("Neuromancer");
    expect(img.getAttribute("style")).toContain("object-fit");
    expect(img.parentElement?.getAttribute("style")).toContain("aspect-ratio: 1 / 1");
  });

  it("renders a canvas for the visualizer and stays silent when off", () => {
    const { container, rerender } = render(
      <VisualizerCanvas data={Array.from({ length: 32 }, (_, i) => i * 4)} settings={settings} width={320} height={180} />,
    );
    expect(container.querySelector("canvas")).toBeTruthy();
    rerender(
      <VisualizerCanvas data={[]} settings={{ ...settings, mode: "off" }} width={320} height={180} />,
    );
    expect(container.querySelector("canvas")).toBeTruthy();
  });
});
