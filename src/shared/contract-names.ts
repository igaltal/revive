/**
 * The names in the contract (src/shared/contract.ts), without zod, so the
 * sandboxed preload can refuse anything else. contract.ts checks at compile
 * time that these lists and its registry are exactly the same.
 */
export const METHOD_NAMES = [
  'settings:get',
  'settings:set',
  'prereq:check',
  'prereq:installClaude',
  'prereq:signIn',
  'shell:openHelp',
  'folder:pick',
  'folder:check',
  'folder:choose',
  'folder:recent',
  'manifest:get',
  'scan:start',
  'scan:cancel',
  'scan:active',
  'guard:status',
  'guard:recheck',
  'runner:start',
  'runner:stop',
  'runner:list',
  'runner:logs',
  'runtime:head',
  'runtime:since',
  'sessions:output',
  'preview:show',
  'preview:hide',
  'preview:cover',
  'preview:uncover',
  'preview:reload',
  'preview:openInBrowser',
  'shots:list',
  'versions:list',
  'versions:save',
  'versions:preview',
  'versions:restore',
  'versions:undo',
  'trash:info',
  'trash:empty'
] as const

/** Main → client. */
export const SERVER_STREAMS = ['settings:changed', 'prereq:task', 'scan:progress', 'scan:done', 'guard:changed', 'runtime:event', 'session:output'] as const

/** Client → main (fire and forget). */
export const CLIENT_STREAMS = ['session:input', 'session:resize'] as const

export type MethodName = (typeof METHOD_NAMES)[number]
export type ServerStreamName = (typeof SERVER_STREAMS)[number]
export type ClientStreamName = (typeof CLIENT_STREAMS)[number]
