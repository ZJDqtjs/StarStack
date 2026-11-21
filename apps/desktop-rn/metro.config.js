const fs = require('fs')
const path = require('path')
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config')

const rnwPath = fs.realpathSync(
  path.resolve(require.resolve('react-native-windows/package.json'), '..'),
)

// 页面与 api/agent/theme/ui 来自 apps/mobile-rn，但 React / RN / SVG 必须用
// 桌面工程自己的副本（RN 0.84.1），否则会打进两份 RN、运行时红屏。
//
// 注意：`react-native init-windows --overwrite` 会用 RNW 模板把本文件覆盖成默认版，
// 覆盖后 watchFolders 为空，bundle 会报 “Unable to resolve ../mobile-rn/src/...”。
// 所以模板里的 blockList / transformer 必须与共享源码配置写在同一份文件里。
const shared = path.resolve(__dirname, '../mobile-rn')
const nm = (name) => path.resolve(__dirname, 'node_modules', name)

const config = {
  watchFolders: [shared],
  resolver: {
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
    extraNodeModules: {
      react: nm('react'),
      'react-native': nm('react-native'),
      'react-native-svg': nm('react-native-svg'),
      '@react-native-async-storage/async-storage': nm('@react-native-async-storage/async-storage'),
    },
    // RNW 模板默认值：run-windows 运行期间 windows/ 与 msbuild 产物会被锁住，
    // 让 Metro 去爬它们会 EBUSY / 让 metro server 崩。
    blockList: [
      new RegExp(`${path.resolve(__dirname, 'windows').replace(/[/\\]/g, '/')}.*`),
      new RegExp(`${rnwPath}/build/.*`),
      new RegExp(`${rnwPath}/target/.*`),
      /.*\.ProjectImports\.zip/,
    ],
  },
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
  },
}

module.exports = mergeConfig(getDefaultConfig(__dirname), config)
