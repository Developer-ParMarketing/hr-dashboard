/** Includes legacy `mine` / `calendar` so old links open the combined Request tab. */
const REQUEST_TAB_VALUES = new Set(['apply', 'mine', 'balance', 'calendar', 'pending', 'all', 'punch'])

/** Read `?tab=` from the URL when it matches a known request-page tab id. */
export function tabFromSearchParams(searchParams: URLSearchParams): string | null {
  const raw = searchParams.get('tab')?.trim()
  if (!raw || !REQUEST_TAB_VALUES.has(raw)) return null
  return raw
}
