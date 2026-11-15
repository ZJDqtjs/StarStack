#!/usr/bin/env bash
# 一次性打通 Cloudflare Workers <-> GitHub Actions 自动部署。
#
# 用法（在仓库根目录）：
#   CLOUDFLARE_API_TOKEN=xxx bash home/scripts/setup-cloudflare.sh
#
# Token 需要：Account / Workers Scripts / Edit、Zone / Zone / Read、
#             Zone / Workers Routes 或 DNS / Edit（绑定自定义域用）。
# 脚本不打印、不落盘 token；只把它传给 Cloudflare API / wrangler / gh。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORKER="${STARSTACK_WORKER:-starstack-home}"
HOSTNAME="${STARSTACK_HOME_HOSTNAME:-home.starstack.run}"
ZONE="${STARSTACK_ZONE:-starstack.run}"
REPO="${STARSTACK_GITHUB_REPO:-ZJDqtjs/StarStack}"
API="https://api.cloudflare.com/client/v4"

: "${CLOUDFLARE_API_TOKEN:?请先设置 CLOUDFLARE_API_TOKEN（Cloudflare Dashboard → My Profile → API Tokens）}"

cf() {
  curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
       -H "Content-Type: application/json" "$@"
}
# 从 JSON 里按点路径取值，例如 result.0.id
json_get() {
  node -e '
    let s = "";
    process.stdin.on("data", d => s += d).on("end", () => {
      const o = JSON.parse(s);
      const v = process.argv[1].split(".").reduce((a, k) => (a == null ? a : a[k]), o);
      if (v === undefined || v === null) process.exit(2);
      console.log(typeof v === "object" ? JSON.stringify(v) : v);
    });
  ' "$1"
}
fail() { echo "ERROR: $*" >&2; exit 1; }

echo "== 1/6 验证 Cloudflare Token =="
VERIFY="$(cf "$API/user/tokens/verify")" || fail "token 校验失败（无效或已过期）"
[ "$(printf '%s' "$VERIFY" | json_get success)" = "true" ] || fail "token 未通过校验"
echo "OK"

echo "== 2/6 解析 Account ID =="
ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-$(cf "$API/accounts" | json_get result.0.id)}" \
  || fail "无法读取账户，请显式设置 CLOUDFLARE_ACCOUNT_ID"
echo "account = $ACCOUNT_ID"

echo "== 3/6 解析 Zone ID（$ZONE）=="
ZONE_ID="${CLOUDFLARE_ZONE_ID:-$(cf "$API/zones?name=$ZONE" | json_get result.0.id)}" \
  || fail "查不到 zone $ZONE，给 token 补 Zone:Read 或显式设置 CLOUDFLARE_ZONE_ID"
echo "zone = $ZONE_ID"

echo "== 4/6 检查是否已存在精确的 CNAME（会挡住 Custom Domain）=="
EXISTING="$(cf "$API/zones/$ZONE_ID/dns_records?name=$HOSTNAME" | json_get result)" || EXISTING="[]"
if [ "$EXISTING" != "[]" ] && printf '%s' "$EXISTING" | grep -q '"type":"CNAME"'; then
  echo "WARN: $HOSTNAME 已有 CNAME 记录，Custom Domain 无法创建。" >&2
  echo "      请先在 Cloudflare DNS 里删除该精确记录（泛解析 *.starstack.run 不冲突，不用动）。" >&2
fi

echo "== 5/6 部署 Worker（wrangler）=="
( cd "$ROOT/home" && \
  CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" \
  CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID" \
  npx --yes wrangler@latest deploy ) || fail "wrangler deploy 失败"

echo "== 6/6 绑定自定义域 $HOSTNAME =="
BODY="$(node -e '
  console.log(JSON.stringify({
    hostname: process.argv[1], service: process.argv[2],
    enabled: true, zone_id: process.argv[3], zone_name: process.argv[4]
  }));
' "$HOSTNAME" "$WORKER" "$ZONE_ID" "$ZONE")"
DOMAIN_RESULT="$(cf -X PUT "$API/accounts/$ACCOUNT_ID/workers/domains" -d "$BODY")" \
  || fail "绑定自定义域失败（token 缺 Workers Routes/DNS 权限？）"
if [ "$(printf '%s' "$DOMAIN_RESULT" | json_get success 2>/dev/null || echo false)" != "true" ]; then
  echo "WARN: 域名绑定返回异常，请到 Dashboard → Workers & Pages → $WORKER → Domains & Routes 手动添加。" >&2
else
  echo "OK：Cloudflare 会自动创建 DNS 记录并签发证书"
fi

echo "== 写入 GitHub Secrets（使 push 自动部署）=="
GH_BIN="$(command -v gh || true)"
[ -z "$GH_BIN" ] && [ -f "/c/Program Files/GitHub CLI/gh.exe" ] && GH_BIN="/c/Program Files/GitHub CLI/gh.exe"
if [ -n "$GH_BIN" ]; then
  if ! "$GH_BIN" auth status >/dev/null 2>&1; then
    # 复用本机 git 凭据管理器里已有的 GitHub token，不写入任何文件
    GIT_TOK="$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p' || true)"
    [ -n "$GIT_TOK" ] && export GH_TOKEN="$GIT_TOK"
  fi
  if printf '%s' "$CLOUDFLARE_API_TOKEN" | "$GH_BIN" secret set CLOUDFLARE_API_TOKEN --repo "$REPO" >/dev/null 2>&1 && \
     printf '%s' "$ACCOUNT_ID" | "$GH_BIN" secret set CLOUDFLARE_ACCOUNT_ID --repo "$REPO" >/dev/null 2>&1; then
    echo "OK：两个 Secrets 已写入 $REPO"
  else
    echo "WARN：gh 未认证或权限不足，请手动在仓库 Settings → Secrets 添加：" >&2
    echo "      CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID=$ACCOUNT_ID" >&2
  fi
else
  echo "WARN：未找到 gh CLI，请手动添加两个 Secrets：" >&2
  echo "      CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID=$ACCOUNT_ID" >&2
fi

echo
echo "== 完成，验证 =="
echo "   curl -I https://$HOSTNAME/        （证书签发可能要等几十秒）"
echo "   gh workflow run ci.yml --ref main （手动触发一次部署；push 到 main 也会自动部署）"
