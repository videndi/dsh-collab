#!/usr/bin/env bash
# dsh-collab relay 一键部署（Ubuntu / Debian，需 root 或 sudo）
#
#   bash install-relay.sh                # 从 GitHub 拉最新 relay
#   bash install-relay.sh --port 8790    # 换端口（默认 8790）
#   bash install-relay.sh --from-zip /root/dsh-collab-relay.zip
#
# 装完会打印团队要填的 relay 地址。之后 systemd 负责开机自启与崩溃重启。
set -euo pipefail

PORT=8790
FROM_ZIP=""
# 下载源：国内优先 jsDelivr，其次 GitHub raw（后者在部分网络不可达）
REPO_SOURCES=(
  "https://cdn.jsdelivr.net/gh/videndi/dsh-collab@main/scripts"
  "https://raw.githubusercontent.com/videndi/dsh-collab/main/scripts"
)
DEST="/opt/dsh-collab-relay"
DATA="/var/lib/dsh-collab"

while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --from-zip) FROM_ZIP="$2"; shift 2 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  echo "请用 root 运行：sudo bash $0"
  exit 1
fi

echo "==> 1/6 检查 Node"
if ! command -v node >/dev/null 2>&1; then
  echo "    未找到 node，安装 Node 20 …"
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  else
    echo "    请先安装 Node 18+（https://nodejs.org），然后重跑本脚本"
    exit 1
  fi
fi
echo "    node $(node -v)"

echo "==> 2/6 准备目录 $DEST"
mkdir -p "$DEST/scripts" "$DATA"

echo "==> 3/6 取 relay 文件"
if [ -n "$FROM_ZIP" ]; then
  TMP=$(mktemp -d)
  unzip -q "$FROM_ZIP" -d "$TMP"
  SRC=$(find "$TMP" -name relay-server.mjs -printf '%h\n' | head -n1)
  cp "$SRC"/relay-server.mjs "$SRC"/watch-page.mjs "$SRC"/status-page.mjs "$DEST/scripts/"
  rm -rf "$TMP"
  echo "    来自本地包 $FROM_ZIP"
else
  ok=0
  for base in "${REPO_SOURCES[@]}"; do
    fail=0
    for f in relay-server.mjs watch-page.mjs status-page.mjs; do
      curl -fsSL "$base/$f" -o "$DEST/scripts/$f" || { fail=1; break; }
    done
    if [ "$fail" -eq 0 ]; then
      echo "    来自 $base"
      ok=1
      break
    fi
  done
  if [ "$ok" -ne 1 ]; then
    echo "    两个下载源都不通。"
    echo "    换成离线方式：把 dsh-collab-relay-*.zip 上传到这机器，再执行"
    echo "      bash $0 --from-zip /root/dsh-collab-relay.zip"
    exit 1
  fi
fi

echo "==> 4/6 服务用户与权限"
id -u dsh >/dev/null 2>&1 || useradd --system --home "$DEST" --shell /usr/sbin/nologin dsh
chown -R dsh:dsh "$DEST" "$DATA"

echo "==> 5/6 注册 systemd 服务"
cat > /etc/systemd/system/dsh-collab-relay.service <<UNIT
[Unit]
Description=dsh-collab relay (room + progress relay for DeepSeek Harness)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=dsh
WorkingDirectory=$DEST
Environment=RELAY_DATA_DIR=$DATA
ExecStart=$(command -v node) $DEST/scripts/relay-server.mjs --port $PORT --host 0.0.0.0 --rooms 64
Restart=always
RestartSec=3
MemoryMax=256M

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable dsh-collab-relay >/dev/null 2>&1
systemctl restart dsh-collab-relay

echo "==> 6/6 放行端口与自检"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q active; then
  ufw allow "$PORT"/tcp >/dev/null 2>&1 || true
  echo "    ufw 已放行 $PORT/tcp"
fi

sleep 2
if curl -fsS "http://127.0.0.1:$PORT/dsh-collab/relay/health" >/dev/null 2>&1; then
  PUBLIC_IP=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
  echo ""
  echo "✅ 部署完成"
  echo "   本机自检： systemctl status dsh-collab-relay"
  echo "   数据目录： $DATA/rooms.json"
  echo ""
  echo "   团队要填的中继地址："
  echo "     http://$PUBLIC_IP:$PORT/dsh-collab/relay"
  echo "   浏览器自检："
  echo "     http://$PUBLIC_IP:$PORT/dsh-collab/status"
  echo ""
  echo "   如果团队访问不到：云厂商安全组里放行 $PORT/tcp（入站）"
else
  echo "❌ 服务没起来，看日志：journalctl -u dsh-collab-relay -n 50 --no-pager"
  exit 1
fi
