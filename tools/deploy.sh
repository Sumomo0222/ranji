#!/usr/bin/env bash
# 部署燃记：
#   1) 把源码提交并推送到 main（识别引擎的大文件不进 git，见 .gitignore）
#   2) 把 docs/ 的构建产物作为一个提交推送到 gh-pages，GitHub Pages 从这个分支的根目录发布
#   3) 开启 GitHub Pages，并等待线上生效
# 用法：npm run build && bash tools/deploy.sh [提交说明]
set -euo pipefail
cd "$(dirname "$0")/.."

command -v gh >/dev/null 2>&1 || PATH="$HOME/.local/bin:$PATH"

REPO=ranji
DESCRIPTION="燃记：个人健身与饮食管理（纯静态，拍照估算热量，自动生成周报）"
OWNER=$(gh api user --jq .login)
DEPLOY_DIR=.scratch/deploy-gh-pages

[ -f docs/index.html ] || { echo "先运行 npm run build"; exit 1; }

# ---------- main：源码 ----------
if [ ! -d .git ]; then git init -b main >/dev/null; fi
git add -A
if git diff --cached --quiet; then
  echo "main: 没有需要提交的改动"
else
  git commit -q -m "${1:-更新}" || true
fi
if ! git remote get-url origin >/dev/null 2>&1; then
  gh repo view "$OWNER/$REPO" >/dev/null 2>&1 || gh repo create "$REPO" --public --description "$DESCRIPTION"
  git remote add origin "https://github.com/$OWNER/$REPO.git"
fi
# 推送时用 gh 登录的凭据，不改动全局的 git 配置。
# github.com 直连不通时，改走系统设置里的代理（仅对本次命令生效）。
PROXY_ARGS=()
if ! curl -s -o /dev/null -m 8 https://github.com; then
  PORT=$(scutil --proxy 2>/dev/null | awk '/HTTPSPort/ {print $3}')
  if [ -n "$PORT" ] && curl -s -o /dev/null -m 15 -x "http://127.0.0.1:$PORT" https://github.com; then
    PROXY_ARGS=(-c "http.proxy=http://127.0.0.1:$PORT")
    echo "github.com 直连不通，改走系统代理 127.0.0.1:$PORT"
  fi
fi
git_auth() { git -c credential.helper= -c 'credential.helper=!gh auth git-credential' "${PROXY_ARGS[@]}" "$@"; }
git_auth push -q -u origin main
MAIN_SHA=$(git rev-parse --short HEAD)
echo "main: 已推送 $MAIN_SHA"

# ---------- gh-pages：构建产物（单次提交，每次部署整体替换） ----------
rm -rf "$DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR"
cp -R docs/. "$DEPLOY_DIR"/
touch "$DEPLOY_DIR/.nojekyll"
(
  cd "$DEPLOY_DIR"
  rm -rf .git
  git init -q -b gh-pages
  git add -A
  git commit -q -m "deploy $MAIN_SHA"
  git_auth push -q --force origin gh-pages
)
rm -rf "$DEPLOY_DIR"
echo "gh-pages: 已发布 $MAIN_SHA"

# ---------- 开启 Pages ----------
gh api -X POST "repos/$OWNER/$REPO/pages" -f build_type=legacy -f "source[branch]=gh-pages" -f "source[path]=/" >/dev/null 2>&1 || true
URL="https://$OWNER.github.io/$REPO/"
echo "线上地址：$URL"

# ---------- 等待生效 ----------
BUILD=$(grep -o 'app-[a-z0-9]*\.js' docs/index.html | head -1)
for i in $(seq 1 40); do
  BODY=$(curl -s -m 20 "$URL" || true)
  if printf '%s' "$BODY" | grep -q "$BUILD"; then
    echo "已生效（第 $i 次检查）：$URL"
    exit 0
  fi
  sleep 8
done
echo "还没检测到新版本（$BUILD），GitHub Pages 首次发布通常需要 1–3 分钟，稍后刷新即可。"
exit 0
