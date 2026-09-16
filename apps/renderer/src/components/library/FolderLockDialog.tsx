/**
 * The folder PIN: set it, or give it.
 *
 * A lock here hides a shelf - a gift being saved, a book being read for a
 * surprise - so it asks for four digits and says plainly what it does and does
 * not do: the contents stay on disk, the library file keeps a hash rather than
 * the PIN, and the audio is not encrypted.
 */

import { useState } from "react";
import { Button, FormControl, Modal, TextField } from "reshaped";
import { Lock, LockOpen } from "lucide-react";
import { verifyPin } from "@amp/core";
import { useLibraryStore } from "../../store/useLibraryStore";
import { useUiStore } from "../../store/useUiStore";

export function FolderLockDialog({
  folderId,
  mode,
  onClose,
}: {
  folderId: string;
  mode: "set" | "unlock";
  onClose: () => void;
}) {
  const folders = useLibraryStore((s) => s.state.folders);
  const setFolderLock = useLibraryStore((s) => s.setFolderLock);
  const markUnlocked = useUiStore((s) => s.markUnlocked);
  const toast = useUiStore((s) => s.toast);
  const folder = folders.find((item) => item.id === folderId);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const value = pin.trim();
    if (value.length < 4) {
      setError("A PIN is at least four characters. Digits are the usual choice.");
      return;
    }
    if (mode === "set") {
      await setFolderLock(folderId, value);
      markUnlocked(folderId);
      toast({ title: `${folder?.name ?? "Folder"} locked`, tone: "success" });
      onClose();
      return;
    }
    const ok = await verifyPin(value, folder?.lockHash);
    if (!ok) {
      setError("That is not the PIN for this folder.");
      return;
    }
    markUnlocked(folderId);
    toast({ title: `${folder?.name ?? "Folder"} unlocked for this session`, tone: "success" });
    onClose();
  };

  return (
    <Modal active onClose={onClose} size="420px" padding={6}>
      <Modal.Title>{mode === "set" ? "Lock this folder" : `Unlock ${folder?.name ?? "the folder"}`}</Modal.Title>
      <Modal.Subtitle>
        {mode === "set"
          ? "A locked folder shows its name and its colour and nothing else until the PIN is given."
          : "The PIN is not stored anywhere in Amp - what is kept is a hash of it."}
      </Modal.Subtitle>
      <div style={{ display: "grid", gap: 14, marginTop: 16 }}>
        <FormControl>
          <FormControl.Label>{mode === "set" ? "Choose a PIN" : "Folder PIN"}</FormControl.Label>
          <TextField
            name="pin"
            value={pin}
            placeholder="••••"
            inputAttributes={{ type: "password", autoFocus: true }}
            onChange={({ value }) => {
              setPin(value);
              setError(null);
            }}
          />
          {error && (
            <span style={{ fontSize: 12, color: "var(--amp-danger, #c0392b)" }}>{error}</span>
          )}
        </FormControl>
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--amp-text-2)" }}>
          The lock hides a shelf from the library; it does not encrypt the files. The audio is exactly where it
          always was, and the lock can be removed from the folder's right-click menu at any time.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button color="primary" onClick={() => void submit()}>
            {mode === "set" ? "Lock it" : "Unlock"}
          </Button>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--amp-text-2)" }}>
          {mode === "set" ? <Lock size={13} /> : <LockOpen size={13} />}
          {mode === "set" ? "Hashes with SHA-256" : "Checked against the stored hash"}
        </span>
      </div>
    </Modal>
  );
}
