#!/usr/bin/env bash
# Periplus · 行纪 树莓派一键安装（服务名、数据库名沿用 mapweb，已部署的机器不受影响）（Raspberry Pi OS / Debian 12，64 位）
# 在项目目录下用普通用户运行：bash deploy/setup-pi.sh
# 可重复执行：已有的数据库和 .env 不会被覆盖。
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_USER="${SUDO_USER:-$USER}"
DB_NAME=mapweb
DB_USER=mapweb
PORT=8080

echo "==> 安装 PostgreSQL + PostGIS"
sudo apt-get update
sudo apt-get install -y postgresql postgis curl ca-certificates openssl

echo "==> 检查 Node.js（需要 20 以上）"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi
node --version

echo "==> 创建数据库"
if [ ! -f "$APP_DIR/.env" ]; then
    DB_PASS="$(openssl rand -hex 16)"
    sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DB_USER') THEN
        CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS';
    ELSE
        ALTER ROLE $DB_USER PASSWORD '$DB_PASS';
    END IF;
END
\$\$;
SQL
    if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1; then
        sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
    fi

    cat > "$APP_DIR/.env" <<ENV
HOST=0.0.0.0
PORT=$PORT
DATABASE_URL=postgres://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME
UPLOAD_DIR=./data/uploads
MAPTILER_KEY=
ENV
    chmod 600 "$APP_DIR/.env"
    chown "$APP_USER" "$APP_DIR/.env"
    echo "已生成 $APP_DIR/.env（数据库密码为随机生成）"
else
    echo ".env 已存在，跳过"
fi
# PostGIS 扩展需要超级用户创建
sudo -u postgres psql -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS postgis;"

echo "==> 安装 npm 依赖并建表"
cd "$APP_DIR"
sudo -u "$APP_USER" npm ci --omit=dev --no-fund --no-audit
sudo -u "$APP_USER" npm run db:init

echo "==> 注册 systemd 服务"
sed -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__APP_USER__|$APP_USER|g" "$APP_DIR/deploy/mapweb.service" \
    | sudo tee /etc/systemd/system/mapweb.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable mapweb
sudo systemctl restart mapweb

IP="$(hostname -I | awk '{print $1}')"
echo
echo "完成！在局域网内打开：http://$IP:$PORT  或  http://$(hostname).local:$PORT"
echo "查看日志：journalctl -u mapweb -f"
echo "导入历史疆域（一次即可）：npm run import:history -- /路径/cliopatria_polities_only.geojson"
