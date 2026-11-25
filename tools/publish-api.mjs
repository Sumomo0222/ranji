// 通过 GitHub 的 Git Data API 发布一个目录（不依赖 github.com 的 git 传输通道，只需要 api.github.com 可达）。
// 每个文件单独上传、只上传内容有变化的文件，失败自动重试。
//   node tools/publish-api.mjs <目录> <分支> <提交说明> [--force] [--files=<清单文件>]
//     --force     用一个没有父提交的新提交整体替换该分支（gh-pages 用）
//     --files     只发布清单里列出的相对路径（main 用，清单来自 git ls-files）
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const [dir, branch, message] = args.filter((a) => !a.startsWith('--'));
if (!dir || !branch || !message) {
  console.error('用法：node tools/publish-api.mjs <目录> <分支> <提交说明> [--force] [--files=清单]');
  process.exit(1);
}
// 仓库归属从 git 远程地址里取，取不到时退回默认值
const remoteUrl = (() => {
  try {
    return execSync('git remote get-url origin', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch (err) {
    return '';
  }
})();
const ownerRepo = /^(?:https?:\/\/|git@)github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remoteUrl);
const OWNER = ownerRepo ? ownerRepo[1] : 'Sumomo0222';
const REPO = ownerRepo ? ownerRepo[2] : 'ranji';
const API = `repos/${OWNER}/${REPO}`;
const force = flags.includes('--force');
const listFlag = flags.find((f) => f.startsWith('--files='));
const BASE_DIR = path.resolve(ROOT, dir);

// 请求经由 curl 发出（本机网络下比 gh 命令行和 Node 的 fetch 都稳）。
// 登录令牌写进一个仅本人可读的临时配置文件交给 curl，不出现在命令行参数里，脚本退出时删除。
const token = execSync('gh auth token', { encoding: 'utf8' }).trim();
const HDR = path.join(ROOT, '.scratch', `gh-headers-${process.pid}`);
fs.mkdirSync(path.dirname(HDR), { recursive: true });
fs.writeFileSync(HDR, `header = "Authorization: Bearer ${token}"\nheader = "Accept: application/vnd.github+json"\nheader = "X-GitHub-Api-Version: 2022-11-28"\nheader = "User-Agent: ranji-publish"\nheader = "Content-Type: application/json"\n`, { mode: 0o600 });
process.on('exit', () => fs.rmSync(HDR, { force: true }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function curl(args) {
  return new Promise((resolve, reject) => execFile('curl', ['-sS', '--max-time', '900', '--config', HDR, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout))));
}

async function api(method, endpoint, body) {
  let tmp;
  if (body) {
    tmp = `${HDR}-${Math.random().toString(36).slice(2)}.json`;
    fs.writeFileSync(tmp, JSON.stringify(body), { mode: 0o600 });
  }
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        const out = await curl(['-X', method, `https://api.github.com/${endpoint}`, '-w', '\n%{http_code}', ...(body ? ['--data-binary', `@${tmp}`] : [])]);
        const nl = out.lastIndexOf('\n');
        const status = Number(out.slice(nl + 1));
        const text = out.slice(0, nl).trim();
        // 404：引用或对象还不存在；409：仓库还是空的。都属于首次发布时的正常情况
        if (status === 404 || status === 409) return null;
        if (status >= 200 && status < 300) return text ? JSON.parse(text) : null;
        throw new Error(`HTTP ${status} ${text.slice(0, 200)}`);
      } catch (err) {
        if (attempt >= 6) throw new Error(`${method} ${endpoint.replace(/\?.*/, '')} 失败：${String(err.message).split('\n')[0]}`);
        await sleep(1500 * attempt);
      }
    }
  } finally {
    if (tmp) fs.rmSync(tmp, { force: true });
  }
}

const walkAbs = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === '.git' ? [] : walkAbs(path.join(d, e.name))) : [path.join(d, e.name)]));
const walk = (d) => walkAbs(d).map((f) => path.relative(d, f).split(path.sep).join('/'));

let files = listFlag ? fs.readFileSync(listFlag.slice('--files='.length), 'utf8').split('\n').filter(Boolean) : walk(BASE_DIR);
if (!listFlag && !files.includes('.nojekyll') && branch === 'gh-pages') fs.writeFileSync(path.join(BASE_DIR, '.nojekyll'), '');
files = [...new Set(files)].sort();
if (!listFlag && fs.existsSync(path.join(BASE_DIR, '.nojekyll')) && !files.includes('.nojekyll')) files.push('.nojekyll');

// 本地文件的 git blob 哈希，用来和远端比对，只上传有变化的
const local = files.map((file) => {
  const content = fs.readFileSync(path.join(BASE_DIR, file));
  const sha = createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
  return { file, content, sha };
});

// GitHub 不允许在空仓库里直接创建提交；先用 Contents API 放一个 README 作为初始提交
// （仓库体积字段是异步统计的，不能用它判断是否为空；看有没有引用最准）
const refs = await api('GET', `${API}/git/refs`);
if (!refs || refs.length === 0) {
  const readme = local.find((f) => f.file === 'README.md');
  await api('PUT', `${API}/contents/README.md`, { message: 'Initial commit', content: (readme?.content ?? Buffer.from(`${REPO}\n`)).toString('base64') });
  console.log('仓库为空，已创建初始提交');
}
const headRef = await api('GET', `${API}/git/ref/heads/${branch}`);
let remote = new Map();
let parent = null;
if (headRef) {
  const commit = await api('GET', `${API}/git/commits/${headRef.object.sha}`);
  parent = commit.sha;
  const tree = await api('GET', `${API}/git/trees/${commit.tree.sha}?recursive=1`);
  remote = new Map((tree?.tree || []).filter((e) => e.type === 'blob').map((e) => [e.path, e.sha]));
}

const changed = local.filter((f) => remote.get(f.file) !== f.sha);
console.log(`${branch}: 共 ${local.length} 个文件，需要上传 ${changed.length} 个（${(changed.reduce((a, f) => a + f.content.length, 0) / 1048576).toFixed(1)} MB）`);

// 并发上传，单个文件失败会重试
let done = 0;
const queue = [...changed];
const workers = Array.from({ length: 4 }, async () => {
  for (;;) {
    const item = queue.shift();
    if (!item) return;
    await api('POST', `${API}/git/blobs`, { content: item.content.toString('base64'), encoding: 'base64' });
    done++;
    if (done % 10 === 0 || done === changed.length) console.log(`  已上传 ${done}/${changed.length}`);
  }
});
await Promise.all(workers);

const tree = await api('POST', `${API}/git/trees`, { tree: local.map((f) => ({ path: f.file, mode: '100644', type: 'blob', sha: f.sha })) });
const commit = await api('POST', `${API}/git/commits`, { message, tree: tree.sha, parents: force || !parent ? [] : [parent] });
if (headRef) await api('PATCH', `${API}/git/refs/heads/${branch}`, { sha: commit.sha, force });
else await api('POST', `${API}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha });
console.log(`${branch}: 已发布 ${commit.sha.slice(0, 7)}${parent && !force ? `（父提交 ${parent.slice(0, 7)}）` : ''}`);

// gh-pages 发布后确认 GitHub Pages 是开着的（已开启时接口返回 409，按「无需处理」对待）
if (branch === 'gh-pages') {
  await api('POST', `${API}/pages`, { build_type: 'legacy', source: { branch: 'gh-pages', path: '/' } });
  console.log(`GitHub Pages：https://${OWNER}.github.io/${REPO}/`);
}
