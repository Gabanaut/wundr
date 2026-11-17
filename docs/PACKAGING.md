# Building & Deploying Wundr (opkg / apk)

How to turn `luci-theme-wundr` + `luci-app-wundr` into installable
packages for OpenWrt 23.05 / 24.10 / 25.x, and how to deploy them.

## Recommended: GitHub Actions (the UniWRT-proven method)

`.github/workflows/build.yml` in this repo builds both packages with
[`openwrt/gh-action-sdk@main`](https://github.com/openwrt/gh-action-sdk) —
the same pipeline UniWRT uses in production. It:

1. Runs `smoke/qa-static.sh` as a gate (plain Ubuntu, no SDK needed).
2. Builds a **3-release matrix**:

   | SDK arch tag     | OpenWrt   | Package format |
   |------------------|-----------|----------------|
   | `x86_64-23.05.6` | 23.05.x   | `.ipk` (opkg)  |
   | `x86_64-24.10.6` | 24.10.x   | `.ipk` (opkg)  |
   | `x86_64-25.12.4` | 25.12.x+  | `.apk` (apk)   |

3. Publishes a GitHub Release with `SHA256SUMS` and a version→asset table.
   Tag pushes (`v*`) become stable releases; every other push updates a
   rolling `nightly` prerelease.

**Why x86_64 only?** Both packages are architecture-independent
(`LUCI_PKGARCH:=all` — pure htdocs/ucode/shell, no compiled binaries), so
one SDK arch per release produces the universal package. Pick by OpenWrt
version, not router CPU.

**Why `@main` and not a version tag?** `gh-action-sdk@v6` mishandled the
SDK image layout and aborted with `sed: can't read feeds.conf.default`
before registering the repo as a feed. `@main` is the working entrypoint.

**Repo-as-feed:** the workflow checks out this repo and registers it as a
custom feed (`FEEDNAME: wundr`); package dirs live at the repo root, which
is exactly the layout gh-action-sdk expects.

## Manual build (local SDK)

If you'd rather build by hand — Linux host or WSL2, ~20 GB disk, ~4 GB RAM:

1. Download the OpenWrt SDK matching your router's **firmware version**
   (major.minor must match exactly). For 24.10:
   <https://downloads.openwrt.org/releases/24.10.x/targets/> — any target
   works since the packages are arch-independent; `x86_64` is smallest.
2. Copy both package dirs into the SDK, or add this repo as a feed:

   ```
   SDK/package/
   ├── luci-theme-wundr/
   └── luci-app-wundr/
   ```

3. Both Makefiles `include $(TOPDIR)/feeds/luci/luci.mk`, so the LuCI feed
   must be resolvable (it is, in stock SDKs):

   ```sh
   ./scripts/feeds update luci
   ./scripts/feeds install -a -p luci
   make defconfig
   make package/luci-theme-wundr/compile V=s
   make package/luci-app-wundr/compile V=s
   ls bin/packages/*/luci*wundr*.ipk   # or *.apk on 25.x
   ```

No Makefile changes are needed between opkg and apk targets — the 25.x
buildroot produces `.apk` from the same metadata.

### Minification is intentionally disabled

Both Makefiles set `LUCI_MINIFY_CSS:=0`, `LUCI_MINIFY_JS:=0`,
`CONFIG_LUCI_CSSTIDY:=`, and `CONFIG_LUCI_JSMIN:=`. `luci.mk` defaults both
minifiers **on** (via `luci-base`'s config symbols), and `csstidy` is a
CSS2-era tool that mangles modern CSS (`color-mix()`, `backdrop-filter`,
`:is()`, `:has()`, multi-stop gradients) while `jsmin` predates modern JS.
Committed CSS/JS ships byte-for-byte (~40.5 KB gzipped total for the entire
Studio Triad shell + icons + charts + QR encoder + SVG topology engine).

### What lands where

`luci.mk` handles install paths automatically:

| Source dir            | Lands at                          |
|-----------------------|-----------------------------------|
| `ucode/template/**`   | `/usr/share/ucode/luci/**`        |
| `htdocs/**`           | `/www/**`                         |
| `root/**`             | `/` (menu.d, acl.d, libexec/rpcd) |

The rpcd plugin ships executable via git mode bits — verify after clone:
`git ls-files -s luci-app-wundr/root/usr/libexec/rpcd/wundr` → mode `100755`.

## Install on the router

```sh
# copy
scp bin/packages/*/*/luci-*wundr*.ipk root@192.168.0.1:/tmp/

# on device (23.05 / 24.10 / opkg)
opkg install /tmp/luci-theme-wundr_*.ipk
opkg install /tmp/luci-app-wundr_*.ipk
/etc/init.d/rpcd restart        # picks up the new exec plugin
rm -f /tmp/luci-indexcache.*    # rebuild menu cache (postinst does this too)
```

For 25.x replace `opkg install` with
`apk add --allow-untrusted /tmp/…apk`.

Theme activation is automatic on fresh installs (uci-defaults + postinst set
`luci.main.mediaurlbase=/luci-static/wundr` and register
`luci.themes.Wundr`). If it doesn't switch:

```sh
uci set luci.main.mediaurlbase=/luci-static/wundr
uci commit luci && rm -f /tmp/luci-indexcache.*
```

## Uninstall / rollback

```sh
opkg remove luci-app-wundr
opkg remove luci-theme-wundr   # prerm restores previous theme
/etc/init.d/rpcd restart
```

## Sanity checks on device

```sh
ubus list | grep wundr          # → "wundr" object registered
ubus -v list wundr              # shows the single "diagnostic" method
ubus call wundr diagnostic '{"kind":"ping","target":"1.1.1.1","count":"2"}'
cat /etc/config/wundr | head    # 'config global' present means menu will show
```

If `ubus list` shows nothing: check `/usr/libexec/rpcd/wundr` exists,
is executable, and run `/etc/init.d/rpcd restart`. If config writes from the
Wundr screens fail, confirm `/usr/share/rpcd/acl.d/luci-app-wundr.json` exists
and re-login (ACLs bind at session creation). Root is granted every ACL group
automatically via OpenWrt's default login (`read`/`write` = `*`), so as root
the screens behave exactly like native LuCI.

## Known limits

- No signed feed yet — users install with `--allow-untrusted` (apk) or accept
  the opkg unsigned prompt until a feed key is provisioned.
- The vendor LTC image runs LuCI on port 8080 alongside the vendor SPA on 80;
  nothing here touches port 80 or vendor files.
