import { useSyncExternalStore } from 'react'

export type RoutePath =
  | '/'
  | '/finance'
  | '/projects'
  | '/tasks'
  | '/more'
  | '/clients'
  | '/goals'
  | '/tools'
  | '/accounts'
  | '/notes'
  | '/portfolio'
  | '/settings'
  | '/search'
  | '/today'
  | '/sales'
  | '/subscribers'
  | '/routine'
  | '/meals'
  | '/planner'
  | '/account'
  | '/reminders'
  | '/inbox'
  | '/habits'
  | '/recurring'
  | '/agenda'
  | '/focus'
  | '/week'
  | '/life'

export interface Route {
  path: RoutePath
  params: URLSearchParams
}

function parse(): Route {
  const hash = location.hash.replace(/^#/, '') || '/'
  const [path, query = ''] = hash.split('?')
  return { path: path as RoutePath, params: new URLSearchParams(query) }
}

let current = parse()
const listeners = new Set<() => void>()

window.addEventListener('hashchange', () => {
  current = parse()
  window.scrollTo(0, 0)
  listeners.forEach((l) => l())
})

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}

export function navigate(path: RoutePath, params?: Record<string, string>) {
  const query = params ? `?${new URLSearchParams(params)}` : ''
  location.hash = `${path}${query}`
}

/** Removes query params (e.g. ?open=id) without adding a history entry. */
export function clearParams() {
  const route = parse()
  if ([...route.params.keys()].length === 0) return
  history.replaceState(null, '', `#${route.path}`)
  current = { path: route.path, params: new URLSearchParams() }
  listeners.forEach((l) => l())
}
