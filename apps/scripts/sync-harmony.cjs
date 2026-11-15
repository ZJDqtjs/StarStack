#!/usr/bin/env node
// 同步鸿蒙内嵌 Web 产物：apps/mobile/dist -> apps/harmony/entry/src/main/resources/rawfile/web
// 与桌面端（csproj 编译期嵌入）、安卓端（cap sync）不同，鸿蒙 rawfile 是入库文件，
// 每次 npm run build 之后必须重跑本脚本，否则 HAP 里带的是旧控制台。
// 统一写成 LF：rawfile 曾因 CRLF 检出与 dist 产生纯换行差异，比对全是噪音。
// 最后校验 index.html 引用的每个资源确实存在于目录中（Index.ets 写死 web/index.html，
// 而 assets 文件名带内容 hash，构建后名字会变）。
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'mobile', 'dist');
const DST = path.join(__dirname, '..', 'harmony', 'entry', 'src', 'main', 'resources', 'rawfile', 'web');

function copyTree(src, dst) {
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      fs.cpSync(s, d, { recursive: true });
      count++;
    } else {
      const buf = fs.readFileSync(s);
      // 文本资源归一化行尾；二进制（图标等）原样拷贝
      if (/\.(html?|css|js|mjs|json|svg|txt)$/i.test(entry.name)) {
        fs.writeFileSync(d, buf.toString('utf8').replace(/\r\n/g, '\n'));
      } else {
        fs.writeFileSync(d, buf);
      }
      count++;
    }
  }
  return count;
}

function verifyIndex() {
  const htmlPath = path.join(DST, 'index.html');
  if (!fs.existsSync(htmlPath)) throw new Error('rawfile/web/index.html missing after sync');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+)"/g)].map((m) => m[1]);
  const missing = refs.filter((r) => !fs.existsSync(path.join(DST, r)));
  if (missing.length) throw new Error('index.html references missing files: ' + missing.join(', '));
  return refs;
}

if (!fs.existsSync(path.join(SRC, 'index.html'))) {
  console.error('[sync:harmony] apps/mobile/dist 不存在或没有 index.html：请先 npm run build');
  process.exit(1);
}
const n = copyTree(SRC, DST);
const refs = verifyIndex();
console.log(`[sync:harmony] 已同步 ${n} 个条目到 harmony rawfile/web，index.html 引用校验通过（${refs.length} 个资源）`);
