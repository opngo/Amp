# Contributing to Amp

Thanks for taking the time. Amp is deliberately small, so the fastest way to get
a change merged is to keep it in that spirit: solve one thing, add a test, keep
the diff readable.

## Before you open a pull request

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run py:test
```

All four should pass. If your change touches the desktop package, run
`npm run build --workspace @amp/desktop` too, since the Electron build has its
own entry points.

## Where things go

- Pure logic, types and anything with an interesting edge case: `packages/core`,
  with a test next to it in `packages/core/src/__tests__`.
- React UI: `apps/renderer/src`. Components in `components/<area>/`, state in
  `store/`, browser-only glue in `platform/` and `audio/`.
- Operating-system work: `apps/desktop/src/main`, exposed to the UI through
  `apps/desktop/src/preload` and the `AmpBridge` interface in
  `packages/core/src/bridge.ts`. Add a method there first, then implement it.
- Anything both the app and the site need: `packages/ui`.
- Python: `python/amp_py` for logic, `gui.py` / `tui.py` / `server.py` for the
  entry points, `python/tests` for tests. Standard library only.

## Conventions

- No emojis in code, comments, docs or UI copy.
- Prefer plain CSS classes for the app and reshaped components for controls.
- Icons come from lucide-react.
- Every user-visible string is written for someone who just wants to listen to a
  book: short, concrete, no marketing voice.
- Tests are named for the behaviour they protect, not the function they call.

## Reporting bugs

Include the Amp version (About dialog), your platform, what you expected, what
happened, and - if it involves playback or imports - the file extension and how
the book was added. The About dialog has a "Copy diagnostics" button that
collects the app log tail and paths.
