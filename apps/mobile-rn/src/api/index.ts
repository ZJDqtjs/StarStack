import { createApi } from './client'
import { request, upload } from './transport'
import { mem } from '../session'

export const api = createApi({
  baseUrl: () => mem.base,
  getToken: () => mem.token,
  request,
  upload,
})

export * from './client'
export * from './constants'
export * from './format'
