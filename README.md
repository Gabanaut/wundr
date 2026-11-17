# Wundr

**A calm, studio-crafted interface and LuCI theme for OpenWrt.**

`OpenWrt 23.05 · 24.10 · 25.12+` · `opkg & apk` · `Zero CDNs · 100% Offline` · `WCAG AA` · `Apache-2.0`

---

OpenWrt is rock-solid underneath, yet everyday tasks—sharing a guest Wi-Fi QR code, pausing a tablet at bedtime, isolating smart-home gadgets onto their own VLAN, or checking which firewall segments can talk to each other—usually mean clicking through half a dozen dense forms.

**Wundr** brings daily router management onto a clean, responsive surface while keeping the full power of OpenWrt intact. Every setting writes through LuCI's native UCI validation and 90-second rollback safety net, and every unmodified LuCI page inherits the active theme automatically. You can install both packages for the complete Wundr experience, or install `luci-theme-wundr` on its own as a standalone skin for stock LuCI.

---

## The Studio Triad

Open the palette menu in the top bar at any time to switch between **three distinct architectural finishes**, **Light and Dark polarity**, and **eight WCAG AA–verified accent palettes**. Preferences save locally in your browser and apply before first paint with zero flash.

| Studio Finish | Character & Materiality | Default Palette |
| :--- | :--- | :--- |
| **Nordic Glass** *(Default)* | Translucent frosted acrylic plates, atmospheric Fjord mesh, concentric `18px` geometry, and a detached floating sidebar island on desktop. | Fjord Cobalt & Glacier Sky |
| **Kyoto Sumi** | Warm unbleached *washi* paper in daylight and deep *sumi* charcoal at night. Replaces nested sub-boxes with quiet horizontal ledger lines. | *Ai-iro* Indigo Ink |
| **Classic Wundr** | Crisp neutral slate surfaces with tactile card elevation and high-visibility status accents. | Warm Ember & Graphite |

Every surface, pill, muted caption, and accent pairing across all three finishes is tested continuously against a `≥ 4.5:1` WCAG AA contrast floor.

---

## Complete OpenWrt Feature Coverage

Nothing in Wundr is a mock toggle or custom shell-script shortcut. Screens read live router state over `ubus` and commit changes through stock LuCI `form.Map` and `uci` transactions.

### Overview & Live Telemetry
- **Dashboard** — Live WAN state, 1-second download and upload area sparklines seeded from router interface counters, CPU and memory health bars, active Wi-Fi radio chips, connected client counts, and one-tap Wi-Fi QR sharing.
- **Top-Bar Health Rail & Instant Search (`Ctrl + K`)** — Live WAN connectivity, load average, and RAM usage chips alongside a keyboard-navigable command search that indexes both Wundr screens and every installed LuCI page.

### Internet, LAN & VLAN Segmentation
- **Internet (WAN)** — Live IPv4/IPv6 addresses, gateway, DNS resolvers, and uptime, paired with a native editor for **DHCP**, **PPPoE**, and **Static IP**, custom DNS overrides, **MAC address cloning**, custom **MTU**, and IPv6 prefix delegation.
- **Network Overview** — Live physical switch-port link state and negotiated speed, bridge topology summary, and a complete table of logical interfaces mapped to firewall zones.
- **LAN & DHCP Settings** — Full compatibility with both OpenWrt 24.10/25.12+ CIDR `list ipaddr` notation and classic `ipaddr` + `netmask`, DHCP pool range and lease time, friendly Primary/Secondary DNS fields (`dhcp_option 6`), **IPv6 Router Advertisements (SLAAC) & DHCPv6**, and a full **Static DHCP Leases** table with connected-host suggestions.
- **VLANs & Segments (`Flat / VLAN Mode`)** — Switch cleanly between a flat home LAN and `802.1Q` bridge-VLAN segmentation. A guided segment builder creates the `bridge-vlan`, `br-lan.<vid>` interface, DHCP pool, and isolated firewall zone in one atomic, rollback-protected apply, complete with per-port untagged (`PVID`) and tagged (`t`) matrix controls.

### Wi-Fi, QR Sharing & Connected Devices
- **Wi-Fi Overview** — Groups multi-band networks (`2.4 GHz`, `5 GHz`, `6 GHz` / **Wi-Fi 7**) into clean per-SSID cards with live client counts, instant enable/disable, a one-tap **Guest Network Wizard** (with client isolation and VLAN attachment), per-radio status cards, and an offline **ISO/IEC 18004 QR code generator** (`qr.js`).
- **Wi-Fi Settings** — Full radio and SSID configuration: `HT` / `VHT` / `HE` (Wi-Fi 6) / `EHT` (Wi-Fi 7 up to `320 MHz`) channel widths, channel & transmit power, regulatory country code, `WPA2` / `WPA3-SAE` / `OWE` encryption, hidden SSIDs, client isolation, and VLAN bridge binding.
- **Devices** — Live table merging DHCP leases, ARP/host hints, and active Wi-Fi station associations (`dBm` signal bars). Rename devices, pin or remove a **Static IP** reservation in place, or **Pause internet** for a single device with one toggle.

### Policy-Verified Network Map
- **Interactive SVG Topology (`map-graph.js`)** — Draws your real `/etc/config/firewall` zones, active client leases, inter-zone forwardings, and active pause/bedtime blocks—never guessed or inferred. Features a symmetric `1..N` segment layout solver, tangent-trimmed Bézier arrows, connected-path hover focus, client click inspection, `+ / − / 1:1` zoom HUD, and mobile-safe scroll handling. Tested up to 512 concurrent client nodes in under 25 ms.

### Security, Family Profiles & QoS
- **Security Posture & Port Forwards** — Audits your running firewall configuration (WAN input drop policy, SYN-flood protection, loose WAN accepts, UPnP pinholes, active port forwards, and local DNS enforcement) into a clear posture score. Includes a **Quick Port Forward** modal with connected-device autofill, inline enable/disable toggles, and one-click removal.
- **Family Controls** — Group a household member's phones, tablets, and consoles into a single profile. Toggle an instant **Internet Pause** or set recurring **Bedtime Schedules** compiled directly into `fw4` nftables time rules (`weekdays`, `start_time`, `stop_time`)—enforced by the router kernel itself with zero background daemons or cloud accounts.
- **Quality of Service (QoS)** — Detects `sqm-scripts` automatically and provides a clean `cake` / `fq_codel` upload and download shaper to keep video calls and gaming latency flat under heavy load.

### Apps, Diagnostics, System & Native LuCI
- **Apps & Services** — Discovers installed init services (`AdGuard Home`, `Tailscale`, `WireGuard`, `ZeroTier`, `Cloudflare Tunnel`, `banIP`, `Adblock`, `SQM`, `Samba 4`, `ksmbd`, `MiniDLNA`, `DDNS`, `ACME`, `mwan3`, `Docker`, `ttyd`, and more) with live Start / Restart / Stop, boot-enable toggles, and verified deep-links to each app's configuration view.
- **Diagnostics** — Bounded, explicit `ping` and `traceroute` probes via a minimal read-only `rpcd` exec plugin (`12s` timeout, strict character whitelist, zero passive background traffic).
- **System & Maintenance** — Live CPU/memory gauges, hostname, timezone and NTP sync editor, auto-refreshing system log reader, and direct shortcuts to Backup/Flash, Software Packages (`apk` on 25.12+, `opkg` on 23.05/24.10), SSH Keys, Mount Points, Cron, and Reboot.
- **Advanced LuCI Drawer & Standalone Mode** — A slide-out drawer exposes the complete, unmodified LuCI menu tree at any time. Every native LuCI table, tab bar, modal, `cbi-dropdown`, and `cbi-dynlist` is styled by `cascade.css` and stacks cleanly on `375px` mobile screens.

---

## Installation

Both packages are architecture-independent (`all`), so the same package installs on **x86_64**, **MediaTek Filogic**, **Qualcomm IPQ**, **Rockchip**, **Broadcom**, and **Raspberry Pi** routers. Choose the package format matching your OpenWrt release from [**GitHub Releases**](https://github.com/Gabanaut/wundr/releases).

### OpenWrt 24.10 & 23.05 (`opkg` / `.ipk`)

```sh
scp luci-theme-wundr_*_all.ipk luci-app-wundr_*_all.ipk root@192.168.1.1:/tmp/

ssh root@192.168.1.1 '
  opkg install /tmp/luci-theme-wundr_*_all.ipk &&
  opkg install /tmp/luci-app-wundr_*_all.ipk &&
  /etc/init.d/rpcd restart
'
```

### OpenWrt 25.12+ (`apk` / `.apk`)

```sh
scp luci-theme-wundr-*.apk luci-app-wundr-*.apk root@192.168.1.1:/tmp/

ssh root@192.168.1.1 '
  apk add --allow-untrusted /tmp/luci-theme-wundr-*.apk /tmp/luci-app-wundr-*.apk &&
  /etc/init.d/rpcd restart
'
```

> **Theme-only install:** Want the Studio Triad look on stock LuCI without the Wundr screens? Install `luci-theme-wundr` by itself—the sidebar automatically populates with OpenWrt's standard `Status / System / Services / Network` navigation.

### Clean Uninstall

Removing Wundr leaves nothing behind: `luci-app-wundr` cleans up any `wundr_*` pause or bedtime firewall rules so no device is left blocked, and `luci-theme-wundr` restores your previous LuCI theme automatically.

```sh
# OpenWrt 23.05 / 24.10
opkg remove luci-app-wundr luci-theme-wundr && /etc/init.d/rpcd restart

# OpenWrt 25.12+
apk del luci-app-wundr luci-theme-wundr && /etc/init.d/rpcd restart
```

---

## Architecture & Design Principles

```text
.
├── luci-theme-wundr/          # ucode templates (header, footer, sysauth), Studio Triad CSS,
│                              # shell controller, SVG icons, canvas charts, QR & map engines
├── luci-app-wundr/            # 15 LuCI client views, menu.d routes, rpcd ACLs & ping/trace probe
├── smoke/                     # Routerless QA gate: JS/sh syntax, ucode AST, WCAG AA contrast,
│                              # QR round-trip decode, map geometry & OpenWrt 24/25 view harness
├── docs/PACKAGING.md          # OpenWrt SDK manual build steps & on-device verification guide
└── .github/workflows/build.yml# Automated OpenWrt SDK matrix (23.05 .ipk, 24.10 .ipk, 25.12+ .apk)
```

- **Zero external dependencies:** No Google Fonts, no external CDNs, no analytics, and no internet connection required to render—critical when configuring a router whose WAN link is down.
- **Tiny embedded footprint:** The entire theme shell—including all three Studio Triad finishes, the native LuCI compatibility layer, vector icons, canvas sparklines, QR encoder, and SVG topology engine—ships in **~40.5 KB gzipped**.
- **Safe coexistence:** Installs cleanly into standard LuCI paths (`/www/luci-static/wundr` and `/usr/share/ucode/luci/template/themes/wundr`) without touching firmware partitions or vendor web panels running on separate ports.

---

## Building & Verifying from Source

Run the full static and functional verification suite locally (requires Node.js and POSIX `sh`, no router hardware needed):

```sh
sh smoke/qa-static.sh
```

This gate validates JavaScript and POSIX shell syntax, `menu.d` and `acl.d` JSON contracts, `rpcd` plugin naming, gzip payload budgets, **89 WCAG AA contrast pairings**, pre-paint theme boot parity, **ISO/IEC 18004 QR round-trip decoding**, **686 SVG topology geometry checks**, and **1,300+ OpenWrt 24.10 / 25.12 conformance assertions**.

Pushing to `main`/`master` or tagging `v*` triggers [.github/workflows/build.yml](.github/workflows/build.yml), which compiles universal `.ipk` and `.apk` packages against the official OpenWrt `23.05`, `24.10`, and `25.12` SDK containers and publishes `SHA256SUMS` to GitHub Releases. For local WSL2/Linux SDK builds, see [docs/PACKAGING.md](docs/PACKAGING.md).

---

## License

Licensed under the **Apache License 2.0** ([LICENSE](LICENSE)). Commercial use, modification, and redistribution are welcome; derivative distributions must retain [LICENSE](LICENSE), [NOTICE](NOTICE), and the *"Powered by Wundr"* footer attribution.

