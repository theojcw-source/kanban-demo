// ── Types ──

export interface DragCallbacks {
  setActiveId: (id: string | null) => void
  setOverColonne: (col: string | null) => void
  handleDrop: (col: string, dropIndex: number) => void | Promise<false | void>
}

// ── Config ──

const DRAG_THRESHOLD = 5
const SNAPBACK_MS = 280
const LAND_MS = 180

// ── State ──

let floatingClone: HTMLElement | null = null
let sourceEl: HTMLElement | null = null
let sourceRect: DOMRect | null = null
let offsetX = 0
let offsetY = 0
let activeCbs: DragCallbacks | null = null
let lastOverCol: string | null = null
let pendingEl: HTMLElement | null = null
let pendingId: string | null = null
let startX = 0
let startY = 0
let isDragging = false
let lastDropIndex = 0
let lastOffsetCol: string | null = null
let prevMouseX = 0
let tilt = 0

// ── Card offsets (cards-make-space) ──

function clearCardOffsets(instant = false) {
  if (!lastOffsetCol) return
  const col = lastOffsetCol  // capture before nulling
  lastOffsetCol = null
  const colBody = document.querySelector(
    `.kbn-col[data-colonne="${CSS.escape(col)}"] .kbn-col-body`
  ) as HTMLElement | null
  if (!colBody) return
  const cards = Array.from(colBody.querySelectorAll(':scope > .kbn-card')) as HTMLElement[]
  for (const card of cards) {
    if (instant) card.style.transition = 'none'
    card.style.transform = ''
    // Keep animation:'none' if set — prevents kbn-slide-in replay after drag
  }
  colBody.style.paddingBottom = ''
  if (instant) {
    // Use local `col`, not `lastOffsetCol` which is now null
    requestAnimationFrame(() => {
      const body = document.querySelector(`.kbn-col[data-colonne="${CSS.escape(col)}"] .kbn-col-body`)
      body?.querySelectorAll(':scope > .kbn-card').forEach(c => { (c as HTMLElement).style.transition = '' })
    })
  }
}

function updateCardOffsets(y: number, col: string) {
  const colBody = document.querySelector(
    `.kbn-col[data-colonne="${CSS.escape(col)}"] .kbn-col-body`
  ) as HTMLElement | null
  if (!colBody || !sourceRect) return

  // Instant-clear previous column if changed
  if (lastOffsetCol && lastOffsetCol !== col) clearCardOffsets(true)
  lastOffsetCol = col

  const dropIdx = findDropIndex(y, col)
  const shiftAmount = sourceRect.height + 8  // card height + column gap

  const cards = Array.from(colBody.querySelectorAll(':scope > .kbn-card')) as HTMLElement[]
  let nbShifted = 0
  cards.forEach((card, actualIdx) => {
    if (card.style.display === 'none') return  // source card: skip
    // Cancel kbn-slide-in fill-mode — it overrides style.transform if left active
    card.style.animation = 'none'
    card.style.transition = 'transform 180ms cubic-bezier(.25,.46,.45,.94)'
    // actualIdx matches what findDropIndex returns (real array index, not visible-only)
    const shifted = actualIdx >= dropIdx
    card.style.transform = shifted ? `translateY(${shiftAmount}px)` : ''
    if (shifted) nbShifted++
  })
  // Grow the column to contain shifted cards — only for cross-column drags.
  // Intra-column: source card (display:none) already freed the space; no expansion needed.
  // Grow column for cross-column drags — including empty columns and drop-at-end
  const sourceCol = sourceEl?.closest<HTMLElement>('.kbn-col')?.dataset.colonne ?? null
  colBody.style.paddingBottom = (sourceCol !== col) ? `${shiftAmount}px` : ''
}

// Calculate where the dropped card will land (reads the gap position from current DOM)
function getCardLandingPosition(col: string): { left: number; top: number } | null {
  const colBody = document.querySelector(
    `.kbn-col[data-colonne="${CSS.escape(col)}"] .kbn-col-body`
  ) as HTMLElement | null
  if (!colBody || !sourceRect) return null

  const colBodyRect = colBody.getBoundingClientRect()
  const cards = Array.from(colBody.querySelectorAll(':scope > .kbn-card')) as HTMLElement[]
  const visibleCards = cards.filter(c => c.style.display !== 'none')

  // Cards before the gap have no transform; cards at/after have translateY applied.
  // The landing zone starts right after the last unshifted card.
  let lastUnshiftedBottom: number | null = null
  for (const card of visibleCards) {
    if (!card.style.transform) {
      lastUnshiftedBottom = card.getBoundingClientRect().bottom
    } else {
      break  // first shifted card — gap is above this
    }
  }

  return {
    left: colBodyRect.left + 8,  // 8px = kbn-col-body padding
    top: lastUnshiftedBottom !== null
      ? lastUnshiftedBottom + 8   // after last unshifted card + column gap (8px)
      : colBodyRect.top + 8,      // dropIdx=0: top of column body + padding
  }
}

// ── Clone ──

function createClone(el: HTMLElement, x: number, y: number) {
  const rect = el.getBoundingClientRect()
  sourceRect = rect
  offsetX = x - rect.left
  offsetY = y - rect.top

  const clone = el.cloneNode(true) as HTMLElement
  clone.className = 'kbn-card kbn-card--floating'
  Object.assign(clone.style, {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    zIndex: '9999',
    pointerEvents: 'none',
    margin: '0',
    transform: 'scale(1.04) rotate(0deg)',
    boxShadow: '0 16px 40px rgba(0,0,0,.42)',
    transition: 'transform 120ms cubic-bezier(.34,1.56,.64,1), box-shadow 120ms ease',
  })
  document.body.appendChild(clone)
  floatingClone = clone

  // After pickup pop, track pointer without transition
  requestAnimationFrame(() => { if (floatingClone) floatingClone.style.transition = 'none' })

  sourceEl = el
  el.style.display = 'none'
  prevMouseX = x
}

function moveClone(x: number, y: number) {
  if (!floatingClone) return
  const dx = x - prevMouseX
  prevMouseX = x
  const tiltTarget = Math.max(-5, Math.min(5, dx * 0.3))
  tilt = tilt + (tiltTarget - tilt) * 0.18  // lerp toward velocity-based target
  floatingClone.style.left = `${x - offsetX}px`
  floatingClone.style.top  = `${y - offsetY}px`
  floatingClone.style.transform = `scale(1.04) rotate(${tilt}deg)`
}

function removeClone() {
  if (floatingClone) { floatingClone.remove(); floatingClone = null }
}

function restoreSource() {
  if (sourceEl) {
    sourceEl.style.animation = 'none'  // prevent kbn-slide-in replay (display:none→'' restarts CSS animations)
    sourceEl.style.display = ''
    sourceEl = null
  }
}

// ── Hit-testing ──

function findColonne(x: number, y: number): string | null {
  if (floatingClone) floatingClone.style.display = 'none'
  const el = document.elementFromPoint(x, y)
  if (floatingClone) floatingClone.style.display = ''
  if (!el) return null
  const col = el.closest('.kbn-col') as HTMLElement | null
  return col?.dataset.colonne ?? null
}

function findDropIndex(y: number, col: string): number {
  const colEl = document.querySelector(`.kbn-col[data-colonne="${CSS.escape(col)}"] .kbn-col-body`)
  if (!colEl) return 0
  const cards = Array.from(colEl.querySelectorAll(':scope > .kbn-card')) as HTMLElement[]
  for (let i = 0; i < cards.length; i++) {
    if (cards[i].style.display === 'none') continue
    const rect = cards[i].getBoundingClientRect()
    if (y < rect.top + rect.height / 2) return i
  }
  return cards.length
}

function suppressNextClick(e: MouseEvent) {
  e.stopPropagation()
  e.preventDefault()
  document.removeEventListener('click', suppressNextClick, true)
}

// ── Drag lifecycle ──

function startDrag(el: HTMLElement, x: number, y: number) {
  isDragging = true
  activeCbs!.setActiveId(pendingId!)
  createClone(el, x, y)
  document.body.classList.add('kbn-dragging')
  document.addEventListener('click', suppressNextClick, true)
}

function cleanup() {
  clearCardOffsets()
  lastOffsetCol = null
  tilt = 0
  prevMouseX = 0
  activeCbs = null
  lastOverCol = null
  pendingEl = null
  pendingId = null
  isDragging = false
  sourceRect = null
  lastDropIndex = 0
}

function validDrop(col: string) {
  const cbs = activeCbs!
  const clone = floatingClone
  const savedDropIndex = lastDropIndex

  // 1. Read landing position while gap is still open
  const targetPos = getCardLandingPosition(col)

  // 2. Update column highlight immediately
  cbs.setOverColonne(null)

  // 3. Freeze drag state — lastOffsetCol intentionally NOT cleared (gap stays open during flight)
  activeCbs = null
  lastOverCol = null
  pendingEl = null
  pendingId = null
  isDragging = false
  sourceRect = null
  lastDropIndex = 0
  tilt = 0
  prevMouseX = 0

  if (!clone || !targetPos) {
    // Fallback: fire immediately
    clearCardOffsets(true)
    Promise.resolve(cbs.handleDrop(col, savedDropIndex)).then(result => {
      requestAnimationFrame(() => {
        removeClone()
        if (result === false) restoreSource()
        else { const srcCol = sourceEl?.closest('.kbn-col')?.getAttribute('data-colonne'); if (srcCol === col) restoreSource(); else sourceEl = null }
      })
      cbs.setActiveId(null)
    })
    return
  }

  // 4. Animate clone to landing position — gap stays open during entire flight
  Object.assign(clone.style, {
    transition: `left ${LAND_MS}ms ease-out, top ${LAND_MS}ms ease-out, transform ${LAND_MS}ms ease-out, box-shadow ${LAND_MS}ms ease-out`,
    left: `${targetPos.left}px`,
    top: `${targetPos.top}px`,
    transform: 'scale(1) rotate(0deg)',
    boxShadow: '0 2px 8px rgba(0,0,0,.12)',
  })

  // 5. After animation: React update (flushSync commits DOM synchronously),
  //    then clear stale inline styles from the drag, then remove clone
  setTimeout(async () => {
    // Hide clone before awaiting handleDrop (dialog may show on top)
    if (floatingClone) floatingClone.style.display = 'none'
    const result = await Promise.resolve(cbs.handleDrop(col, savedDropIndex))
    // handleDrop uses flushSync for same-column reorder → DOM is already updated.
    // Clear stale transforms/animations left on reused DOM elements.
    lastOffsetCol = null
    // Re-query colBody after handleDrop (React may have replaced DOM nodes via flushSync)
    const colBodyFresh = document.querySelector(`.kbn-col[data-colonne="${CSS.escape(col)}"] .kbn-col-body`) as HTMLElement | null
    if (colBodyFresh) {
      colBodyFresh.querySelectorAll(':scope > .kbn-card').forEach(c => {
        const el = c as HTMLElement
        el.style.transition = 'none'
        el.style.transform = ''
        el.style.animation = 'none'
      })
    }
    requestAnimationFrame(() => {
      // Re-query to catch cards React added asynchronously after handleDrop
      const colBodyPost = document.querySelector(`.kbn-col[data-colonne="${CSS.escape(col)}"] .kbn-col-body`) as HTMLElement | null
      if (colBodyPost) {
        colBodyPost.style.paddingBottom = ''
        colBodyPost.querySelectorAll(':scope > .kbn-card').forEach(c => {
          const el = c as HTMLElement
          el.style.transition = ''
          el.style.animation = 'none'
        })
      }
      removeClone()
      // If handleDrop returned false (confirm dialog cancelled), restore source.
      // For same-column reorder, always restore. For committed cross-column, React handles it.
      const srcCol = sourceEl?.closest('.kbn-col')?.getAttribute('data-colonne')
      if (result === false || srcCol === col) restoreSource()
      else sourceEl = null
      cbs.setActiveId(null)
    })
  }, LAND_MS + 20)
}

function invalidDrop() {
  const cbs = activeCbs!
  const clone = floatingClone
  const el = sourceEl
  cbs.setOverColonne(null)
  clearCardOffsets()  // animated return: cards slide back while clone snaps

  if (clone && sourceRect) {
    // Restore source immediately (invisible) so column reserves space — no jump at end
    if (el) { el.style.display = ''; el.style.opacity = '0' }

    Object.assign(clone.style, {
      transition: `left ${SNAPBACK_MS}ms cubic-bezier(.34,1.56,.64,1), top ${SNAPBACK_MS}ms cubic-bezier(.34,1.56,.64,1), transform ${SNAPBACK_MS}ms cubic-bezier(.34,1.56,.64,1), box-shadow ${SNAPBACK_MS}ms ease`,
      left: `${sourceRect.left}px`,
      top: `${sourceRect.top}px`,
      transform: 'scale(1) rotate(0deg)',
      boxShadow: '0 2px 4px rgba(0,0,0,.08)',
    })

    setTimeout(() => {
      removeClone()
      if (el) {
        el.style.transition = 'opacity 80ms ease'
        el.style.opacity = ''
        setTimeout(() => { el.style.transition = '' }, 80)
      }
      sourceEl = null
      cbs.setActiveId(null)
      cleanup()
    }, SNAPBACK_MS)
  } else {
    removeClone(); restoreSource(); cbs.setActiveId(null); cleanup()
  }
}

// ── Pointer handlers ──

function onPointerMove(e: PointerEvent) {
  if (!isDragging) {
    if (Math.abs(e.clientX - startX) < DRAG_THRESHOLD && Math.abs(e.clientY - startY) < DRAG_THRESHOLD) return
    if (!pendingEl) return
    startDrag(pendingEl, startX, startY)
  }
  moveClone(e.clientX, e.clientY)
  const col = findColonne(e.clientX, e.clientY)
  if (col !== lastOverCol) { lastOverCol = col; activeCbs?.setOverColonne(col) }
  if (col) {
    lastDropIndex = findDropIndex(e.clientY, col)
    updateCardOffsets(e.clientY, col)
  } else {
    clearCardOffsets()
  }
}

function onPointerUp(e: PointerEvent) {
  document.removeEventListener('pointermove', onPointerMove)
  document.removeEventListener('pointerup', onPointerUp)

  if (!isDragging) { cleanup(); return }

  const col = findColonne(e.clientX, e.clientY)
  // Freeze animation:none inline on all cards before removing the CSS override
  document.querySelectorAll('.kbn-card').forEach(c => { (c as HTMLElement).style.animation = 'none' })
  document.body.classList.remove('kbn-dragging')

  if (col && activeCbs) { validDrop(col) } else { invalidDrop() }
}

// ── Public API ──

export function onCardPointerDown(e: React.PointerEvent, id: string, callbacks: DragCallbacks) {
  if (e.button !== 0) return
  pendingEl = e.currentTarget as HTMLElement
  pendingId = id
  startX = e.clientX
  startY = e.clientY
  activeCbs = callbacks
  isDragging = false
  document.addEventListener('pointermove', onPointerMove)
  document.addEventListener('pointerup', onPointerUp)
}

// ── Kanban order with priority support ──

export function applyStoredOrder<T>(
  items: T[],
  getId: (item: T) => string,
  storedIds: string[],
  isPrio?: (item: T) => boolean,
): T[] {
  if (!storedIds.length && !isPrio) return items

  const posMap = new Map<string, number>()
  storedIds.forEach((id, i) => posMap.set(id, i))

  const sorted = [...items].sort((a, b) => {
    const posA = posMap.get(getId(a)) ?? 9999
    const posB = posMap.get(getId(b)) ?? 9999
    return posA - posB
  })

  if (!isPrio) return sorted

  // Partition: prioritized items first, then non-prioritized
  return [...sorted.filter(i => isPrio(i)), ...sorted.filter(i => !isPrio(i))]
}
