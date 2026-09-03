# Wundr — an elegant LuCI theme + app for OpenWrt

**Grandma-simple on the surface, pro-grade underneath, fast on OpenWrt 23.05 / 24.10 / 25.x.**

Wundr replaces the stock LuCI front-end with a single, polished UI aimed at
consumers and home/lab users: a living dashboard, one-tap
Wi-Fi and parental controls, real traffic shaping, VLAN segmentation, and a
firewall posture audit — for both **flat networks** and **VLAN-based**
segmented networks. It coexists with a vendor web panel and never replaces
firmware.

```
luci-theme-wundr/   the theme shell (templates, CSS design system, JS chrome)
                    + a complete native-LuCI compatibility layer (cbi.css)
luci-app-wundr/     the screens + rpcd ACLs + menu config
docs/PACKAGING.md   build, install, CI matrix
smoke/qa-static.sh  static QA gate (JS syntax, JSON, size budget, RPC contract)
```

Both packages are architecture-independent (`all`). Everything is shipped
source, no webfonts, no CDNs, no telemetry.

## Screens

Every screen reads live router state and, where applicable, writes through
LuCI's own **validated UCI + rollback-capable apply** path (the exact same
machinery native LuCI uses). There are no write stubs, and controls do not
pretend — an action either works or the button is not shown.

- **Dashboard** — internet/traffic/health/Wi-Fi/devices overview with sparklines drawn from the router's counters.
- **Internet** — live WAN + an editor for connection type (DHCP / static / PPPoE), DNS, IPv6 and MAC clone.
- **Network** — LAN addressing, DHCP pool, VLAN segments, switch-port link state, logical interfaces, firewall zones.
- **Wi-Fi** — per-name cards across bands (2.4/5/6 GHz), live clients, QR sharing, instant enable/disable, network wizard, per-band radio tuning.
- **Wi-Fi Settings** — the full native editor: mode, channel, width, power, country, security, SSIDs with band selection.
- **Devices** — the live client list; pause/resume internet for a single device; static lease.
- **Families** — profiles that group devices and apply **Pause** or **Bedtime** schedules (these are real firewall rules enforced by the router itself; no backend is required).
- **Security** — posture score with pass/fix checks (WAN input rules, forwardings, UPnP opens, DNS forcing, SYN-flood) and a deep-link to every firewall page.
- **QoS** — SQM shaping form when `sqm-scripts` is present; otherwise it tells you honestly, with an action.
- **Apps** — the set of installed init scripts and enable/start/stop controls (via native `rc`).
- **System** — device info, hostname/timezone editor, live log reader, and the maintenance links (backup, packages, boot scripts, password, reboot) that reuse native LuCI's flow.
- **Native** escape hatch — a slide-out of every unmodified LuCI page, so no feature is ever out of reach.

## Design

- A **token-based CSS system** (`cascade.css`) covers both the shell and all
  native widgets, so any stock LuCI page inherits the look and stays legible.
- Light / dark (`data-theme`) plus **8 palettes**, all tuned to pass WCAG AA
  (≥4.5:1 for body text). Persisted in `localStorage`.
- **Mobile-first**: 375px works, no horizontal overflow; full-page
  tables stack on phones.
- Motion respects `prefers-reduced-motion`, touch targets ≥44px. Zero
  emoji-only affordances (SVG icon font with text fallback).

## Build

```sh
sh smoke/qa-static.sh          # static gate, no router needed
```

`.github/workflows/build.yml` builds and releases for 23.05 (ipk),
24.10 (ipk), 25.12+ (apk) from the root as a feed. See
[docs/PACKAGING.md](docs/PACKAGING.md) for the manual SDK steps and on-router
sanity checks (ubus, ACL, apply).

### Install both, theme before app

```sh
scp .../luci-theme-wundr_*.ipk root@ROUTER:/tmp/ && ssh ... 'opkg install /tmp/luci-theme-wundr_*.ipk'
scp .../luci-app-wundr_*.ipk   root@ROUTER:/tmp/ && ssh ... 'opkg install /tmp/luci-app-wundr_*.ipk && /etc/init.d/rpcd restart'
```

The theme postinst selects Wundr only if LuCI is still on bootstrap, remembers
the previous theme, and restores it on removal (`prerm`). The vendor UI remains
untouched. If the theme is uninstalled without the app, the `depends:
uci:wundr` rule in `menu.d` hides every custom menu from the stock LuCI shell.

## License

Apache-2.0 (`LICENSE`). Commercial use permitted; vendors keep the `NOTICE` and
the theme footer's "Powered by Wundr" credit, and must not present derivatives as
unmodified upstream.

*Internal prototypes, samples and vendored reference sources live under
`extras/` (gitignored) and ship nothing.*
