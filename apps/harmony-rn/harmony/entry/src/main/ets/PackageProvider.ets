import type { RNPackageContext, RNOHPackage } from '@rnoh/react-native-openharmony'
import { StarStackNodePackage } from './rn/StarStackNodePackage'

export function getRNOHPackages(ctx: RNPackageContext): RNOHPackage[] {
  return [new StarStackNodePackage(ctx)]
}
