#!/usr/bin/env bash
# Dedicated donghaeng-review-app VM only. Never place provider credentials in metadata.
set -euo pipefail
exec 9>/run/donghaeng-review-startup.lock
flock -n 9 || exit 0

metadata() { curl --fail --silent --show-error --connect-timeout 3 --max-time 10 -H 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/$1"; }
[[ "$(metadata instance/name)" == "donghaeng-review-app" ]] || exit 1
[[ "$(metadata project/project-id)" == "abis-web-platform" ]] || exit 1
image="$(metadata instance/attributes/donghaeng-image)"
[[ "$image" =~ ^asia-northeast3-docker.pkg.dev/abis-web-platform/donghaeng/app:([a-f0-9-]{36})$ ]] || exit 1

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq docker.io curl python3
systemctl enable --now docker

# This exact separately-created disk is retained across container/VM replacement.
# Refuse to format anything with signatures, partitions, an unexpected size or type.
disk=/dev/disk/by-id/google-donghaeng-review-data
[[ -b "$disk" ]] || exit 1
disk_real="$(readlink -f "$disk")"
filesystem="$(blkid -s TYPE -o value "$disk" || true)"
if [[ -z "$filesystem" ]]; then
  [[ "$(lsblk -dn -o TYPE "$disk_real")" == "disk" ]] || exit 1
  [[ "$(blockdev --getsize64 "$disk_real")" == "10737418240" ]] || exit 1
  [[ "$(lsblk -n -o NAME "$disk_real" | wc -l)" -eq 1 ]] || exit 1
  [[ -z "$(wipefs --no-act --noheadings "$disk_real")" ]] || exit 1
  mkfs.ext4 -L donghaeng-review-data "$disk"
elif [[ "$filesystem" != "ext4" ]]; then
  echo 'Unexpected data filesystem; refusing startup.' >&2
  exit 1
fi
mountpoint_path=/mnt/disks/donghaeng-review-data
mkdir -p "$mountpoint_path"
disk_uuid="$(blkid -s UUID -o value "$disk")"
if ! grep -qF "UUID=$disk_uuid " /etc/fstab; then
  printf 'UUID=%s %s ext4 defaults,noatime,nofail 0 2\n' "$disk_uuid" "$mountpoint_path" >> /etc/fstab
fi
if ! mountpoint -q "$mountpoint_path"; then mount "$mountpoint_path"; fi
[[ "$(findmnt -n -o UUID --target "$mountpoint_path")" == "$disk_uuid" ]] || exit 1
install -d -m 750 -o 1000 -g 1000 "$mountpoint_path/database" "$mountpoint_path/cache"

# Short-lived workload identity token is piped; never echoed or put in argv.
docker_config="$(mktemp -d /run/donghaeng-review-docker.XXXXXX)"
trap 'rm -f "$docker_config/config.json"; rmdir "$docker_config"' EXIT
metadata instance/service-accounts/default/token | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])' | docker --config "$docker_config" login -u oauth2accesstoken --password-stdin https://asia-northeast3-docker.pkg.dev >/dev/null
docker --config "$docker_config" pull "$image"

install -d -m 750 /etc/donghaeng-review
cat > /etc/donghaeng-review/runtime.env <<'ENVIRONMENT'
DONGHAENG_GCP_PROJECT_ID=abis-web-platform
DONGHAENG_AUTH_MODE=public-review
DONGHAENG_REVIEW_ISOLATED=1
DONGHAENG_DB_PATH=/data/review.db
DONGHAENG_REVIEW_CLOSES_AT=2026-09-11T15:00:00.000Z
DONGHAENG_ORCHESTRATOR_PROVIDER=anthropic
DONGHAENG_ANTHROPIC_MODEL=claude-sonnet-5
DONGHAENG_STT_PROVIDER=openai-compatible
DONGHAENG_STT_ENDPOINT=https://api.openai.com/v1/audio/transcriptions
DONGHAENG_STT_MODEL=gpt-transcribe
DONGHAENG_TTS_ENDPOINT=https://api.openai.com/v1/audio/speech
DONGHAENG_TTS_MODEL=gpt-4o-mini-tts
DONGHAENG_TTS_VOICE=marin
ENVIRONMENT
origin="$(metadata instance/attributes/donghaeng-review-origin)"
[[ "$origin" =~ ^https://donghaeng-finance-review-[a-z0-9.-]+\.run\.app$ ]] || exit 1
printf 'DONGHAENG_APP_ORIGIN=%s\n' "$origin" >> /etc/donghaeng-review/runtime.env
chmod 640 /etc/donghaeng-review/runtime.env

cat > /etc/systemd/system/donghaeng-review.service <<UNIT
[Unit]
Description=Donghaeng authenticated interview application
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target
RequiresMountsFor=$mountpoint_path
ConditionPathIsMountPoint=$mountpoint_path
StartLimitIntervalSec=0

[Service]
Restart=always
RestartSec=10
TimeoutStartSec=60
TimeoutStopSec=40
ExecStart=/usr/bin/docker run --rm --name donghaeng-review-app --cap-drop ALL --security-opt no-new-privileges --memory 1200m --cpus 2 --log-opt max-size=10m --log-opt max-file=3 --publish 10.80.0.40:3000:3000 --env-file /etc/donghaeng-review/runtime.env --mount type=bind,source=$mountpoint_path/database,target=/data --mount type=bind,source=$mountpoint_path/cache,target=/app/data $image
ExecStop=/usr/bin/docker stop --time 30 donghaeng-review-app

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable donghaeng-review.service
systemctl restart donghaeng-review.service
echo 'Donghaeng service started with dedicated disk and workload identity.'
