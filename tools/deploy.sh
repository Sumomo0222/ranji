#!/usr/bin/env bash
# 部署燃记：
#   1) 把源码提交到本地的 main（识别引擎的大文件不进 git，见 .gitignore）
#   2) 通过 GitHub API 发布两个分支（只要求 api.github.com 可达，不依赖 github.com 的 git 传输）：
#        main      源码，只上传有变化的文件
#        gh-pages  docs/ 的构建产物，每次整体替换；GitHub Pages 从这个分支的根目录发布
#   3) 等待线上生效
# 用法：npm run build && bash tools/deploy.sh [提交说明]
set -euo pipefail
cd "$(dirname "$0")/.."

command -v gh >/dev/null 2>&1 || PATH="$HOME/.local/bin:$PATH"
export PATH

REPO=ranji
DESCRIPTION="燃记：个人健身与饮食管理（纯静态，拍照估算热量，自动生成周报）"
DEPLOY_DIR=.scratch/deploy-gh-pages

[ -f docs/index.html ] || { echo "先运行 npm run build"; exit 1; }

# ---------- main：源码 ----------
if [ ! -d .git ]; then git init -b main >/dev/null; fi
if ! git remote get-url origin >/dev/null 2>&1; then
  OWNER=$(gh api user --jq .login)
  gh repo view "$OWNER/$REPO" >/dev/null 2>&1 || gh repo create "$REPO" --public --description "$DESCRIPTION"
  git remote add origin "https://github.com/$OWNER/$REPO.git"
fi
OWNER=$(git remote get-url origin | sed -E 's#^(https?://|git@)github\.com[/:]([^/]+)/.*$#\2#')
git add -A
if git diff --cached --quiet; then
  echo "main: 没有需要提交的改动"
else
  git commit -q -m "${1:-更新}"
fi
MAIN_SHA=$(git rev-parse --short HEAD)
mkdir -p .scratch
git ls-tree -r --name-only HEAD > .scratch/main-files.txt
node tools/publish-api.mjs . main "$(git log -1 --format=%s)" "--files=.scratch/main-files.txt"
echo "main: 已发布 $MAIN_SHA"

# ---------- gh-pages：构建产物 ----------
rm -rf "$DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR"
cp -R docs/. "$DEPLOY_DIR"/
touch "$DEPLOY_DIR/.nojekyll"
node tools/publish-api.mjs "$DEPLOY_DIR" gh-pages "deploy $MAIN_SHA" --force
rm -rf "$DEPLOY_DIR"
echo "gh-pages: 已发布"

# ---------- 等待线上生效 ----------
URL="https://$OWNER.github.io/$REPO/"
BUILD=$(grep -o 'app-[A-Za-z0-9]*\.js' docs/index.html | head -1)
echo "线上地址：$URL"
for i in $(seq 1 40); do
  BODY=$(curl -s -m 20 "$URL" || true)
  if printf '%s' "$BODY" | grep -q "$BUILD"; then
    echo "已生效（第 $i 次检查）：$URL"
    exit 0
  fi
  sleep 8
done
echo "还没检测到新版本（$BUILD）。GitHub Pages 的缓存最长约 10 分钟，稍后刷新即可。"
exit 0
