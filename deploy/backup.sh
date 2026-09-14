#!/usr/bin/env bash
# 备份标注数据和照片，默认保留最近 30 份
# 用法：bash deploy/backup.sh [备份目录，默认 ~/mapweb-backups]
# 定时备份（每天凌晨 3 点）：crontab -e 加一行
#   0 3 * * * bash /home/pi/mapweb-pi/deploy/backup.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-$HOME/mapweb-backups}"
KEEP=30
STAMP="$(date +%F_%H%M)"

set -a
. "$APP_DIR/.env"
set +a

UPLOADS="$(cd "$APP_DIR" && realpath -m "${UPLOAD_DIR:-./data/uploads}")"
mkdir -p "$DEST" "$UPLOADS"

# 只备份个人标注表；历史疆域可以随时从 GeoJSON 重新导入
pg_dump "$DATABASE_URL" --table=points --format=custom --file="$DEST/points_$STAMP.dump"
tar -czf "$DEST/uploads_$STAMP.tar.gz" -C "$(dirname "$UPLOADS")" "$(basename "$UPLOADS")"

# 清理旧备份
ls -1t "$DEST"/points_*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm --
ls -1t "$DEST"/uploads_*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm --

echo "备份完成：$DEST/points_$STAMP.dump, uploads_$STAMP.tar.gz"
