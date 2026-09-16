import { useState } from "react";
import { Button, FormControl, Modal, TextField } from "reshaped";
import { COLOR_TAGS } from "@amp/core";
import { useLibraryStore } from "../../store/useLibraryStore";
import { colorHex } from "../layout/Sidebar";

export function NewFolderDialog({
  parentId = null,
  onClose,
}: {
  parentId?: string | null;
  onClose: () => void;
}) {
  const addFolder = useLibraryStore((s) => s.addFolder);
  const folders = useLibraryStore((s) => s.state.folders);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const parent = folders.find((folder) => folder.id === parentId) ?? null;

  return (
    <Modal active onClose={onClose} size="440px" padding={6}>
      <Modal.Title>{parent ? `New folder inside ${parent.name}` : "New folder"}</Modal.Title>
      <Modal.Subtitle>
        Folders keep big libraries tidy - they are virtual, your files never move. A folder can hold other
        folders, take a colour, and be locked with a PIN.
      </Modal.Subtitle>
      <div style={{ display: "grid", gap: 14, marginTop: 16 }}>
        <FormControl>
          <FormControl.Label>Folder name</FormControl.Label>
          <TextField
            name="folder"
            value={name}
            placeholder="Science fiction"
            onChange={({ value }) => setName(value)}
            attributes={{ autoFocus: true }}
          />
        </FormControl>
        <FormControl>
          <FormControl.Label>Colour</FormControl.Label>
          <span className="amp-menu-swatches">
            {COLOR_TAGS.map((tag) => (
              <button
                key={tag.value}
                type="button"
                className="amp-swatch"
                data-active={color === tag.value}
                style={{ background: colorHex(tag.value) }}
                title={tag.label}
                aria-label={tag.label}
                onClick={() => setColor(color === tag.value ? null : tag.value)}
              />
            ))}
            <button
              type="button"
              className="amp-swatch amp-swatch-none"
              data-active={color === null}
              title="No colour"
              aria-label="No colour"
              onClick={() => setColor(null)}
            />
          </span>
        </FormControl>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            color="primary"
            disabled={!name.trim()}
            onClick={() => {
              void addFolder(name.trim(), parentId, { color: color ?? undefined });
              onClose();
            }}
          >
            Create folder
          </Button>
        </div>
      </div>
    </Modal>
  );
}
