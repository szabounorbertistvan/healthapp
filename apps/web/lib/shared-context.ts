import { createContext, type Context } from "react";

/**
 * createContext, but one context object per `key` for the whole process.
 *
 * `next dev` (Turbopack) can hold two instances of the same client module at
 * once: routes compiled at different times keep their own, and while one
 * request renders, a concurrent request to another route swaps the global
 * module loader under it. A provider from one instance and a hook from the
 * other then see two different contexts, and the hook finds no provider —
 * /coaches answered 500 "useI18n must be used inside <I18nProvider>" whenever
 * its render overlapped any other request (2026-10-05). Keying the object on
 * globalThis makes every instance share it. A production build has one
 * instance and is unaffected; in the browser this is a plain createContext.
 */
export function sharedContext<T>(key: string, defaultValue: T): Context<T> {
  const registry = ((globalThis as { __voinicContexts?: Map<string, Context<unknown>> }).__voinicContexts ??= new Map());
  let context = registry.get(key) as Context<T> | undefined;
  if (!context) {
    context = createContext(defaultValue);
    registry.set(key, context as Context<unknown>);
  }
  return context;
}
