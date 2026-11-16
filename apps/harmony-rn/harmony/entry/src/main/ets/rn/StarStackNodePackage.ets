import { RNPackage } from '@rnoh/react-native-openharmony'
import type {
  AnyThreadTurboModule,
  AnyThreadTurboModuleContext,
  RNPackageContext,
} from '@rnoh/react-native-openharmony'
import { StarStackNodeModule } from '../turboModules/StarStackNodeModule'

export class StarStackNodePackage extends RNPackage {
  constructor(ctx: RNPackageContext) {
    super(ctx)
  }

  getAnyThreadTurboModuleFactoryByNameMap(): Map<
    string,
    (ctx: AnyThreadTurboModuleContext) => AnyThreadTurboModule
  > {
    const map = new Map<string, (ctx: AnyThreadTurboModuleContext) => AnyThreadTurboModule>()
    map.set(StarStackNodeModule.NAME, (ctx: AnyThreadTurboModuleContext) => new StarStackNodeModule(ctx))
    return map
  }
}
