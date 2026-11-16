const path = require('path')
const { mergeConfig, getDefaultConfig } = require('@react-native/metro-config')
const { createHarmonyMetroConfig } = require('@react-native-oh/react-native-harmony/metro.config')

// 页面与 api/agent/theme/ui 来自 apps/mobile-rn，但 React / RN / SVG 用鸿蒙工程
// 自己的 RN 0.84.1 副本；否则 Metro 会从 mobile-rn/node_modules 打进 RN 0.88。
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

module.exports = mergeConfig(
  getDefaultConfig(__dirname),
  createHarmonyMetroConfig({
    reactNativeHarmonyPackageName: '@react-native-oh/react-native-harmony',
  }),
  config,
)
