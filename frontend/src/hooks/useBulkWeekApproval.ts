import { useCallback, useEffect, useMemo, useState } from 'react'

export type RowSelectState = 'none' | 'unchecked' | 'checked' | 'indeterminate'

export function useBulkWeekApproval(selectableIds: number[]) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [busy, setBusy] = useState(false)

  const selectableKey = useMemo(
    () => [...new Set(selectableIds)].sort((a, b) => a - b).join(','),
    [selectableIds],
  )

  useEffect(() => {
    setSelected((prev) => {
      const allowed = new Set(selectableIds)
      const next = new Set([...prev].filter((id) => allowed.has(id)))
      if (next.size === prev.size && [...next].every((id) => prev.has(id))) return prev
      return next
    })
  }, [selectableKey, selectableIds])

  const toggle = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleMany = useCallback((ids: number[], select: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (select) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const allSelected =
        selectableIds.length > 0 && selectableIds.every((id) => prev.has(id))
      if (allSelected) return new Set()
      return new Set(selectableIds)
    })
  }, [selectableIds])

  const clear = useCallback(() => setSelected(new Set()), [])

  const selectedIds = useMemo(() => [...selected], [selected])
  const selectedCount = selected.size
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id))
  const someSelected = selectableIds.some((id) => selected.has(id)) && !allSelected

  const rowState = useCallback(
    (ids: number[]): RowSelectState => {
      const actionable = ids.filter((id) => selectableIds.includes(id))
      if (actionable.length === 0) return 'none'
      const selectedInRow = actionable.filter((id) => selected.has(id)).length
      if (selectedInRow === 0) return 'unchecked'
      if (selectedInRow === actionable.length) return 'checked'
      return 'indeterminate'
    },
    [selectableIds, selected],
  )

  const isSelected = useCallback((id: number) => selected.has(id), [selected])

  return {
    selectedIds,
    selectedCount,
    allSelected,
    someSelected,
    toggle,
    toggleMany,
    toggleAll,
    clear,
    busy,
    setBusy,
    isSelected,
    rowState,
  }
}
