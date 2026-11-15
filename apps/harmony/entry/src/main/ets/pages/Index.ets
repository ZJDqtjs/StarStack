import { webview } from '@kit.ArkWeb';

// The console is the same React build (web-react/dist) the desktop exe embeds.
// Keeping it in rawfile means the HarmonyOS shell needs no server of its own;
// the API goes to the broker over HTTPS + Bearer. rawfile has no same-origin
// backend, so api.js falls back to the default Broker address at load time.
// Buyer-only by design: an ArkWeb page cannot keep a node alive in background.
@Entry
@Component
struct Index {
  controller: webview.WebviewController = new webview.WebviewController();

  build() {
    Column() {
      Web({ src: $rawfile('web/index.html'), controller: this.controller })
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .fileAccess(true)
        .imageAccess(true)
        .zoomAccess(false)
        .width('100%')
        .height('100%')
    }
    .width('100%')
    .height('100%')
  }
}
