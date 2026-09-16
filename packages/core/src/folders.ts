/**
 * Folders: nesting, colour and the lock.
 *
 * A folder in Amp is a label, not a place on disk. This module is the part of
 * the label that has rules: how a flat list of folders becomes a tree, how deep
 * a folder sits, which folders an opened folder should include, and what a lock
 * means.
 *
 * About the lock. It hides a shelf from the library until a PIN is given, and
 * the PIN is not stored - only a hash of it, so a library file that is read by
 * somebody else does not hand it over in plain sight. A four-digit PIN is not a
 * secret worth more ceremony than that: the lock keeps a shelf out of sight, it
 * does not encrypt a single byte of audio. Saying so is part of the design.
 */

import type { Folder, ID } from "./types";

/** Salt for the PIN hash. Fixed: it only has to stop casual reuse. */
export const PIN_SALT = "amp.folder.lock.v1:";

/** A folder with its children, for the tree view. */
export interface FolderNode {
  folder: Folder;
  depth: number;
  children: FolderNode[];
}

/**
 * Hash a PIN.
 *
 * SHA-256 where the environment has it (the app and any secure page do), and a
 * plain 64-bit FNV-1a where it does not, so the feature never has to be missing
 * because a page was served over plain HTTP. The hash is only ever compared
 * against another hash; nothing is derived from the PIN itself.
 */
export async function hashPin(pin: string): Promise<string> {
  const payload = `${PIN_SALT}${pin.trim()}`;
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const bytes = new TextEncoder().encode(payload);
    const digest = await subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const byte of new TextEncoder().encode(payload)) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

export async function verifyPin(pin: string, hash: string | undefined): Promise<boolean> {
  if (!hash) return false;
  return (await hashPin(pin)) === hash;
}

/** The tree a flat folder list describes, parents before children. */
export function folderTree(folders: Folder[]): FolderNode[] {
  const byParent = new Map<ID | null, Folder[]>();
  for (const folder of folders) {
    const key = folder.parentId ?? null;
    byParent.set(key, [...(byParent.get(key) ?? []), folder]);
  }
  const build = (parentId: ID | null, depth: number, seen: Set<ID>): FolderNode[] =>
    (byParent.get(parentId) ?? [])
      .filter((folder) => !seen.has(folder.id))
      .map((folder) => {
        const next = new Set(seen);
        next.add(folder.id);
        return { folder, depth, children: build(folder.id, depth + 1, next) };
      });
  return build(null, 0, new Set());
}

/** Flatten a tree back into draw order, so a list can be rendered with indents. */
export function flattenTree(nodes: FolderNode[]): FolderNode[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
}

/** How deep a folder sits; 0 for a top-level folder. */
export function folderDepth(folders: Folder[], id: ID): number {
  let depth = 0;
  let current = folders.find((folder) => folder.id === id);
  const seen = new Set<ID>();
  while (current?.parentId && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    current = folders.find((folder) => folder.id === current?.parentId);
    depth += 1;
    if (depth > 32) break;
  }
  return depth;
}

/**
 * A folder cannot be moved inside itself.
 *
 * Without this check a drag or a menu choice turns two folders into an island
 * that appears nowhere: every folder keeps its parent, so nothing is at the top
 * level and the tree is empty.
 */
export function canNestFolder(folders: Folder[], folderId: ID, parentId: ID | null): boolean {
  if (parentId === null) return true;
  if (parentId === folderId) return false;
  let current: Folder | undefined = folders.find((folder) => folder.id === parentId);
  const seen = new Set<ID>();
  while (current) {
    if (current.id === folderId) return false;
    if (!current.parentId || seen.has(current.parentId)) return true;
    seen.add(current.parentId);
    current = folders.find((folder) => folder.id === current?.parentId);
  }
  return true;
}

/** The folders a book could be filed into without creating a loop. */
export function nestableInto(folders: Folder[], folderId: ID): Folder[] {
  return folders.filter((folder) => canNestFolder(folders, folderId, folder.id));
}
