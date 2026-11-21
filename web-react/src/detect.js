// 编排页：从源码 zip 的文件清单自动识别项目类型，给出默认命令 / 产物目录 / 推荐平台。
// 只读 zip 中央目录（文件名），不解压，大文件也是毫秒级。

export async function listZipNames(file) {
  try {
    const size = file.size
    const tail = Math.min(size, 66000)
    const buf = new DataView(await file.slice(size - tail).arrayBuffer())
    let e = -1
    for (let i = tail - 22; i >= 0; i--) { if (buf.getUint32(i, true) === 0x06054b50) { e = i; break } }
    if (e < 0) return []
    const count = buf.getUint16(e + 10, true), cdSize = buf.getUint32(e + 12, true), cdOff = buf.getUint32(e + 16, true)
    if (cdOff === 0xFFFFFFFF) return []
    const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer())
    const dec = new TextDecoder()
    const names = []
    let p = 0
    while (p + 46 <= cd.byteLength && names.length < Math.min(count, 50000)) {
      if (cd.getUint32(p, true) !== 0x02014b50) break
      const nl = cd.getUint16(p + 28, true), xl = cd.getUint16(p + 30, true), cl = cd.getUint16(p + 32, true)
      names.push(dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nl)))
      p += 46 + nl + xl + cl
    }
    return names
  } catch (e) { return [] }
}

// 平台：id → 展示名 / 后端 arch / 节点 os 匹配
export const PLATFORMS = [
  { id: 'any', label: '不限平台', badge: '*', arch: '', os: '' },
  { id: 'win-x64', label: 'Windows x64', badge: 'WIN', arch: 'amd64', os: 'windows' },
  { id: 'linux-x64', label: 'Linux x64', badge: 'LNX', arch: 'amd64', os: 'linux' },
  { id: 'linux-arm64', label: 'Linux ARM64', badge: 'ARM', arch: 'arm64', os: 'linux' },
  { id: 'mac', label: 'macOS', badge: 'MAC', arch: '', os: 'darwin' },
]
export const platformOf = id => PLATFORMS.find(p => p.id === id) || PLATFORMS[0]

const unixLike = plat => plat === 'linux-x64' || plat === 'linux-arm64' || plat === 'mac'

// 项目类型表（顺序即优先级）。cmd(plat, names) 返回默认编译命令
export const PROJECTS = [
  { id: 'apk', label: 'Android 应用', artifact: 'APK / AAB', badge: 'APK', tone: '#16a34a', rec: 'any',
    test: n => n.has('androidmanifest.xml'), why: 'AndroidManifest.xml',
    cmd: (p, n) => (n.has('gradlew') ? (unixLike(p) ? './gradlew assembleRelease' : 'gradlew.bat assembleRelease') : 'gradle assembleRelease'), output: 'app/build/outputs' },
  { id: 'exe', label: 'Windows 程序 (.NET)', artifact: 'EXE / MSI', badge: 'EXE', tone: '#2563eb', rec: 'win-x64',
    test: n => n.ext('.sln') || n.ext('.csproj'), why: '.sln / .csproj',
    cmd: () => 'dotnet publish -c Release -o out', output: 'out' },
  { id: 'go', label: 'Go 程序', artifact: '可执行文件', badge: 'GO', tone: '#0891b2', rec: 'any',
    test: n => n.has('go.mod'), why: 'go.mod',
    cmd: () => 'go build -o out/ ./...', output: 'out' },
  { id: 'rust', label: 'Rust 程序', artifact: '可执行文件', badge: 'RS', tone: '#c2410c', rec: 'any',
    test: n => n.has('cargo.toml'), why: 'Cargo.toml',
    cmd: () => 'cargo build --release', output: 'target/release' },
  { id: 'java', label: 'Java 项目 (Maven)', artifact: 'JAR / WAR', badge: 'JAR', tone: '#b45309', rec: 'any',
    test: n => n.has('pom.xml'), why: 'pom.xml',
    cmd: () => 'mvn -B package', output: 'target' },
  { id: 'cmake', label: 'C / C++ 工程', artifact: '可执行文件 / 库', badge: 'C++', tone: '#7c3aed', rec: 'any',
    test: n => n.has('cmakelists.txt'), why: 'CMakeLists.txt',
    cmd: p => 'cmake -B build && cmake --build build' + (unixLike(p) ? '' : ' --config Release'), output: 'build' },
  { id: 'node', label: 'Node.js / 前端', artifact: '静态站点 / 应用', badge: 'JS', tone: '#ca8a04', rec: 'any',
    test: n => n.has('package.json'), why: 'package.json',
    cmd: () => 'npm install && npm run build', output: 'dist' },
  { id: 'script', label: '自定义脚本', artifact: '任意产物', badge: 'PS1', tone: '#475569', rec: 'any',
    test: n => n.has('build.ps1'), why: 'build.ps1',
    cmd: () => 'powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1', output: 'out' },
]
export const CUSTOM_PROJECT = { id: 'custom', label: '未识别项目', artifact: '任意产物', badge: '?', tone: '#64748b', rec: 'any', why: '', cmd: () => '', output: 'out' }

export function detectProject(names) {
  const list = (names || []).map(s => String(s).replace(/\\/g, '/').toLowerCase()).filter(s => s && !s.endsWith('/'))
  if (!list.length) return null
  // 常见情况：zip 里只有一层根目录，去掉它
  const first = list[0].split('/')[0]
  const strip = list.every(s => s.indexOf('/') > 0 && s.split('/')[0] === first)
  const paths = strip ? list.map(s => s.slice(first.length + 1)) : list
  const shallow = paths.filter(s => s.split('/').length <= 3)
  const bases = new Set(shallow.map(s => s.split('/').pop()))
  const n = { has: b => bases.has(b), ext: e => shallow.some(s => s.endsWith(e)) }
  const hit = PROJECTS.find(p => p.test(n))
  return { proj: hit || CUSTOM_PROJECT, names: n, count: list.length }
}
