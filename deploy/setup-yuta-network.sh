#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer with sudo." >&2
  exit 1
fi

SERVICE_USER="${1:-}"
WIFI_INTERFACE="${2:-wlan0}"
if [[ ! "$SERVICE_USER" =~ ^[a-z_][a-z0-9_-]*[$]?$ ]]; then
  echo "Usage: sudo $0 <gateway-service-user> [wifi-interface]" >&2
  exit 2
fi
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  echo "Invalid gateway service account name." >&2
  exit 2
fi
if [[ ! "$WIFI_INTERFACE" =~ ^[a-zA-Z0-9_.:-]+$ ]]; then
  echo "Invalid Wi-Fi interface name." >&2
  exit 2
fi
if ! command -v nmcli >/dev/null 2>&1; then
  echo "NetworkManager (nmcli) is required. This installer targets Raspberry Pi OS Trixie." >&2
  exit 1
fi
if ! command -v dnsmasq >/dev/null 2>&1; then
  echo "NetworkManager shared hotspot mode needs dnsmasq-base; install it with: sudo apt install dnsmasq-base" >&2
  exit 1
fi

DEVICE_TYPE="$(nmcli -g GENERAL.TYPE device show "$WIFI_INTERFACE" 2>/dev/null || true)"
if [[ "$DEVICE_TYPE" != "wifi" ]]; then
  echo "Wi-Fi interface '$WIFI_INTERFACE' was not found. Check 'nmcli device status'." >&2
  exit 1
fi

read -r -s -p "Choose a YUTA-Setup hotspot password (8-63 characters): " HOTSPOT_PASSWORD
printf '\n'
read -r -s -p "Confirm the hotspot password: " HOTSPOT_PASSWORD_CONFIRM
printf '\n'
HOTSPOT_PASSWORD_BYTES="$(printf '%s' "$HOTSPOT_PASSWORD" | wc -c)"
if [[ "$HOTSPOT_PASSWORD" != "$HOTSPOT_PASSWORD_CONFIRM" ]] \
  || (( HOTSPOT_PASSWORD_BYTES < 8 || HOTSPOT_PASSWORD_BYTES > 63 )); then
  echo "Hotspot passwords must match and be between 8 and 63 bytes." >&2
  exit 1
fi
unset HOTSPOT_PASSWORD_CONFIRM

if ! nmcli -t -f NAME connection show | grep -Fxq "YUTA-Setup"; then
  nmcli connection add \
    type wifi \
    ifname "$WIFI_INTERFACE" \
    con-name YUTA-Setup \
    ssid YUTA-Setup
fi
nmcli connection modify YUTA-Setup \
  connection.interface-name "$WIFI_INTERFACE" \
  connection.autoconnect yes \
  connection.autoconnect-priority -10 \
  802-11-wireless.ssid YUTA-Setup \
  802-11-wireless.mode ap \
  wifi-sec.key-mgmt wpa-psk \
  wifi-sec.psk "$HOTSPOT_PASSWORD" \
  ipv4.method shared \
  ipv6.method disabled

install -o root -g root -m 0755 \
  "$(dirname "$0")/yuta-configure-wifi" \
  /usr/local/sbin/yuta-configure-wifi
printf '%s\n' "$WIFI_INTERFACE" > /etc/yuta-network-interface
chmod 0644 /etc/yuta-network-interface
printf '%s ALL=(root) NOPASSWD: /usr/local/sbin/yuta-configure-wifi\n' "$SERVICE_USER" \
  > /etc/sudoers.d/yuta-network
chmod 0440 /etc/sudoers.d/yuta-network
visudo -cf /etc/sudoers.d/yuta-network

nmcli radio wifi on
nmcli connection up YUTA-Setup ifname "$WIFI_INTERFACE"

printf '\nYUTA recovery hotspot is ready.\n'
printf 'Wi-Fi name: YUTA-Setup\n'
printf 'Hotspot password: %s\n' "$HOTSPOT_PASSWORD"
printf 'Open http://10.42.0.1:8080/ on a connected phone while the OCR gateway is running.\n'
printf 'Record the hotspot password for service; do not leave it visible on the box.\n'
