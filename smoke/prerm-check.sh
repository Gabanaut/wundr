#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
sed -n '/^define Package\/luci-app-wundr\/prerm$/,/^endef$/p' "$root/luci-app-wundr/Makefile" | sed '1d;$d;s/\$\$/\$/g;s|-x /etc/init.d/firewall|-x /bin/sh|;s|/etc/init.d/firewall reload|firewall_reload|' > "$work/hook"
uci() {
    [ "$1" = -q ] && shift
    stable=0
    if [ "$1" = -X ]; then stable=1; shift; fi
    case "$1" in
        show) awk -v stable="$stable" '{print "firewall." (stable ? $1 : "@rule[" NR-1 "]") "=rule"}' "$work/rules" ;;
        get) id=${2#firewall.}; id=${id%.name}; awk -v id="$id" '$1==id {print $2}' "$work/rules" ;;
        delete) id=${2#firewall.}; awk -v id="$id" '$1!=id' "$work/rules" > "$work/next"; mv "$work/next" "$work/rules" ;;
        commit) printf 'commit\n' >> "$work/events" ;;
        *) return 1 ;;
    esac
}
firewall_reload() { printf 'reload\n' >> "$work/events"; }
printf '%s\n' 'cfg10 wundr_pause_family' 'cfg11 wundr_bedtime_family' 'cfg12 wundr_block_device' 'cfg13 Keep' > "$work/rules"
run_hook() ( . "$work/hook" )
PKG_UPGRADE=1 run_hook remove
run_hook upgrade
IPKG_INSTROOT="$work" run_hook remove
[ "$(wc -l < "$work/rules")" -eq 4 ] && [ ! -f "$work/events" ] || exit 1
run_hook remove
[ "$(cat "$work/rules")" = 'cfg13 Keep' ] || exit 1
run_hook remove
[ "$(tr '\n' ' ' < "$work/events")" = 'commit reload ' ] || exit 1
printf '%s\n' 'prerm: adjacent anonymous rules removed, unrelated rule retained, one commit/reload; upgrade and offline install preserved'