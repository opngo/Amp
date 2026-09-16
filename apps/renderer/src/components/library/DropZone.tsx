export function DropZone({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="amp-drop-zone">
      <div style={{ textAlign: "center", display: "grid", gap: 6 }}>
        <span style={{ fontSize: 20, fontWeight: 700 }}>{label}</span>
        {hint && <span style={{ fontSize: 13, opacity: 0.75 }}>{hint}</span>}
      </div>
    </div>
  );
}
