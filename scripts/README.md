# Scripts

Repository scripts, all runnable with plain Node or Python - no extra tooling.

| Script | What it does |
| --- | --- |
| `make-icons.mjs` | Draws the Amp mark and writes every icon: app (1024 px), tray (32 and 64 px), website and repository icons, plus `assets/logo.svg`. PNG encoding is done in the script, so there are no image dependencies |
| `check-env.mjs` | The doctor: checks Node, the workspace dependencies and the Electron binary, reports missing optional tools, and with `--fix` reruns Electron's installer when its download did not finish. Runs automatically after `npm install` and before `npm run dev:desktop` |

```bash
npm run doctor                      # check the environment
npm run doctor -- --fix             # repair a missing Electron binary
npm run icons                       # regenerate every icon from the source drawing
npm run icons -- --sizes 512,256    # only some sizes
```

The icon script is deterministic: same input, same bytes out, so brand changes
show up as readable diffs rather than as binary noise.

## Why the doctor exists

`electron-vite` reports a missing Electron binary as `Error: Electron uninstall`,
and on Windows the launch attempt surfaces as "Unable to find Electron app at
...\install". Neither mentions the cause: `node_modules/electron/path.txt` is
missing because Electron's postinstall did not download the binary. `check-env.mjs`
detects exactly that state and reruns Electron's own installer, which uses the
cached download when there is one.

## Notes

- `make-icons.mjs` keeps the mark in one place: a rounded square in the Amp
  gradient with five bars, the same picture as `AmpLogo` in `packages/ui`. Change
  the constants at the top of the file, not the PNGs.
  can run with `node` directly, without a TypeScript loader. If the `Book` type
  commit.
