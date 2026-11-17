include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-wundr
PKG_VERSION:=0.3.1
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Wundr contributors
LUCI_PKGARCH:=all
LUCI_TITLE:=Wundr OpenWrt UI (Dashboard, Wi-Fi, VLANs, Family, Map)
LUCI_DEPENDS:=+luci-theme-wundr +luci-base +rpcd +jsonfilter

# Same rationale as the theme: keep committed JS/CSS byte-for-byte.
LUCI_MINIFY_CSS:=0
LUCI_MINIFY_JS:=0
CONFIG_LUCI_CSSTIDY:=
CONFIG_LUCI_JSMIN:=

define Package/luci-app-wundr/conffiles
/etc/config/wundr
endef

# On removal (never on upgrade), delete every Wundr-derived firewall rule
# (device pause / family bedtime) so a paused device is never left blocked
# after the app is gone.
define Package/luci-app-wundr/prerm
#!/bin/sh
case "$$1" in *upgrade*) exit 0 ;; esac
[ "$${PKG_UPGRADE:-}" = 1 ] && exit 0
[ -n "$$IPKG_INSTROOT" ] && exit 0
uci -q show firewall >/dev/null 2>&1 || exit 0
CHANGED=0
for sid in $$(uci -q show firewall | sed -n 's/^firewall\.\([^.=]*\)=rule$$/\1/p'); do
	name=$$(uci -q get "firewall.$$sid.name")
	case "$$name" in
		wundr_pause_*|wundr_bedtime_*|wundr_block_*)
			uci -q delete "firewall.$$sid" && CHANGED=1
			;;
	esac
done
[ "$$CHANGED" = 1 ] && uci -q commit firewall
exit 0
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
