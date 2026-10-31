# Zeta

Desktop app (macOS + Windows) for bulk-provisioning Aruba access points from one Excel file. You preview the
changes against the live controller, apply them as a job, and Zeta checks that each AP comes back with the new values.

Download the latest installer from [Releases](https://github.com/pluemsuthiwat/zeta/releases/latest). Zeta tells
you in the app when a newer version is published.

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
npm run dist:mac     # -> dist/Zeta-<version>-mac-arm64.dmg and dist/Zeta-<version>-mac-x64.dmg
npm run dist:win     # -> dist/Zeta-<version>-win-x64-setup.exe (NSIS installer)
```

There is no native module, so `dist:win` also runs on a Mac (the 1.1.x installers were made that way), or on Windows
with Node 22.13+ and no Visual Studio build tools.

The macOS app is ad-hoc signed as `com.suthiwat.zeta`. It needs that identity for the Local Network permission to
apply. Without it, connections to the controller fail with EHOSTUNREACH. Nothing is signed with an Apple Developer
ID or a Windows certificate, so on first run macOS needs right-click → Open, and Windows SmartScreen warns.

Each build also writes `third-party-licenses.json` (every npm package that ships in the app, with its license text),
which the About dialog lists.

The logo source is `build/icon.svg`. After editing it, run `npx electron scripts/render-icons.cjs` to regenerate
`build/icon.png` (electron-builder turns it into `.icns` / `.ico`), the macOS tray template images, and the header
logo at `src/renderer/src/assets/logo.svg`.

## Releasing

1. Bump `version` in `package.json` (`npm version x.y.z --no-git-tag-version`), commit and push.
2. Build both platforms (above).
3. Publish a GitHub release tagged `vx.y.z` with the three installers, keeping the file names electron-builder gives
   them.

Zeta checks `releases/latest` on GitHub when it starts and every 6 hours, then shows a bar with **Download**. After
the bar is closed, an **Update to x.y.z** button stays in the header. Drafts and pre-releases are never offered, so
you can stage a release as a draft before publishing it. The **Download** button picks the asset whose name ends in
`-mac-<arch>.dmg` or `-win-<arch>-setup.exe`, and otherwise opens the release page. To try the bar without
publishing, point the app at a stub with `ZETA_UPDATE_API=http://127.0.0.1:<port>/latest`.

## Desktop behavior vs. the web version

- Single user, so there are no admin/staff roles. Per-action rate limits stay because they protect the controllers.
- Only one Zeta instance can run at a time, so one job runner works against one database.
- Closing the window during a job hides Zeta to the tray and the job keeps running. Quitting asks first.
  Jobs cut off by a quit or crash are marked failed on the next start, and their APs say to check the controller.
- Apply re-reads the same file bytes and redoes the live preview in the main process. It never trusts the
  preview the window showed.

## Tested on real controllers

Verified with real AP reboots on standalone ArubaOS 8.x controllers (payload fields checked on AOS 8.13.3.1):
rename, AP group, static IP / DNS, static ↔ DHCP, IP and name swaps and chains, moving an AP to another Master
(ends as "Sent"; the AP shows up on the new controller after a few minutes), and several APs sent back to back.

Commands address APs by wired MAC, IP or serial, never by name: `read_bootinfo` by wired MAC,
`copy_provisioning_params` by IP, `ap_reprovision` by serial, and `show ap details wired-mac` for the current
values. AOS has no `show ap details serial-num`, and a name can belong to two APs in the middle of a swap.

Not tested yet:

- Managed by Mobility Master mode, and Config Node Path.
- Controllers with thousands of APs (requests time out after 8 s), and jobs of hundreds of APs at once.
- A Wi-Fi reconnect on the source interface in the middle of a job (covered by tests, not yet on the lab).
- Windows: the installer, the title-bar overlay, source-interface binding and notifications have not been checked on
  real Windows hardware.

## License

MIT. See [LICENSE](LICENSE).
