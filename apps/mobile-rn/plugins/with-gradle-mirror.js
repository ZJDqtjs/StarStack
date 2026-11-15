// prebuild 会把 gradle-wrapper.properties 重置回 services.gradle.org，
// 国内网络下载 Gradle 发行版经常中途 reset（本项目就踩过：下载 40% 断流）。
// 这个 plugin 在每次 prebuild 后把发行版地址换到腾讯镜像，避免手动补丁被覆盖。
const { withDangerousMod } = require('@expo/config-plugins')
const fs = require('node:fs')
const path = require('node:path')

const MIRROR = 'https\\://mirrors.cloud.tencent.com/gradle/'

module.exports = function withGradleMirror(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const file = path.join(
        cfg.modRequest.platformProjectRoot,
        'gradle',
        'wrapper',
        'gradle-wrapper.properties'
      )
      if (fs.existsSync(file)) {
        let text = fs.readFileSync(file, 'utf8')
        text = text.replace(
          /distributionUrl=https\\:\/\/services\.gradle\.org\/distributions\//,
          'distributionUrl=' + MIRROR
        )
        text = text.replace(/networkTimeout=\d+/, 'networkTimeout=60000')
        fs.writeFileSync(file, text)
      }

      // 默认只编真机架构：CMake 编 4 个 ABI 要多花十几分钟。
      // 需要模拟器时把这里和 gradle.properties 一起改回 armeabi-v7a,arm64-v8a,x86,x86_64。
      const props = path.join(cfg.modRequest.platformProjectRoot, 'gradle.properties')
      if (fs.existsSync(props)) {
        let text = fs.readFileSync(props, 'utf8')
        text = text.replace(/^reactNativeArchitectures=.*$/m, 'reactNativeArchitectures=arm64-v8a')
        fs.writeFileSync(props, text)
      }
      return cfg
    },
  ])
}
