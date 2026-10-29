# Zeta

Desktop app (macOS + Windows) for bulk-provisioning Aruba access points from one Excel file.

## Stack

| Part | Choice |
| --- | --- |
| Shell | Electron 45 + electron-vite, packaged with electron-builder |
| UI | React 19 + Tailwind 4 (`src/renderer`) |
| Backend | Electron main process (`src/main`): Aruba client, import checks, job runner |
| Window ↔ main | IPC through `src/preload` (`window.zeta.*`), context isolation + sandbox |
| Database | SQLite via built-in `node:sqlite` (no native module to rebuild) |
| Secrets | Electron `safeStorage`: Keychain on macOS, DPAPI on Windows |

## Where data lives

| | macOS | Windows |
| --- | --- | --- |
| Packaged app | `~/Library/Application Support/Zeta/zeta.db` | `%APPDATA%\Zeta\zeta.db` |
| `npm run dev` | `~/Library/Application Support/Zeta Dev/` | `%APPDATA%\Zeta Dev\` |

Controller passwords are stored encrypted by the OS keystore. A copied `zeta.db` cannot be decrypted on
another computer or user account; Zeta then asks you to re-enter the password in Edit.

## Develop

```bash
npm install
npm run dev          # app with hot reload
npm test             # unit + mock-controller tests
```

No controller at hand? Run the fake one and add `127.0.0.1`, port `4343`, `admin` / `admin` in Zeta:

```bash
node scripts/mock-controller.mjs --aps 60 --reboot 15
```

## Build installers

```bash
npm run dist:mac     # on a Mac   -> dist/Zeta-<version>-arm64.dmg / x64.dmg
npm run dist:win     # on Windows -> dist/Zeta Setup <version>.exe (NSIS installer)
```

On Windows: install Node 22.13+ (or 24) and run `npm install`, then `npm run dist:win`. There is no native module, so
there are no Visual Studio build tools to install.

Builds are unsigned: Windows SmartScreen warns on first run, and on macOS you right-click → Open the first time.
Add code-signing certificates before distributing widely.

The logo source is `build/icon.svg`. After editing it, run `npx electron scripts/render-icons.cjs` to regenerate
`build/icon.png` (electron-builder turns it into `.icns` / `.ico`), the macOS tray template images, and the header
logo at `src/renderer/src/assets/logo.svg`.

## Desktop behavior vs. the web version

- Single user, so there are no admin/staff roles. Per-action rate limits stay because they protect the controllers.
- Only one Zeta instance can run at a time, so one job runner works against one database.
- Closing the window during a job hides Zeta to the tray and the job keeps running. Quitting asks first.
  Jobs cut off by a quit or crash are marked failed on the next start, and their APs say to check the controller.
- Apply re-reads the same file bytes and redoes the live preview in the main process. It never trusts the
  preview the window showed.

## Not yet verified on real hardware

Everything has been tested against `scripts/mock-controller.mjs`, which mirrors what Zeta sends. Before you use
Zeta on production APs, compare these two pieces in `src/main/lib/arubaClient.js` with the web version's
`lib/arubaClient.js` (built from a HAR of ArubaOS 8.12):

1. `buildProvisionPayload()`: the JSON for `clear_provisioning_ap_list`, `read_bootinfo`,
   `copy_provisioning_params`, `ap_prov` and `ap_reprovision`.
2. `parseProvisioning()`: how `show ap details ap-name <name>` is read. When it can't find the provisioning
   section, every network value is treated as a change, which is safe but may reboot APs unnecessarily.
