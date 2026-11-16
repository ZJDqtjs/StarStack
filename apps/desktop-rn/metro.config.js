const path = require('path')
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config')

// 页面与 api/agent/theme/ui 来自 apps/mobile-rn，但 React / RN / SVG 必须用
// 桌面工程自己的副本（RN 0.84.1），否则会打进两份 RN、运行时红屏。
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
  },
}

module.exports = mergeConfig(getDefaultConfig(__dirname), config)
