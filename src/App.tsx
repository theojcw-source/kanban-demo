import { useState, useRef, useEffect } from 'react'
import { flushSync } from 'react-dom'
import { onCardPointerDown, applyStoredOrder, type DragCallbacks } from './kanbanDrag'
import './App.css'

// ── Types ──────────────────────────────────────────────────────────────────

interface Card {
  id: string
  col: string
  title: string
  description: string
}

// ── EditableField ──────────────────────────────────────────────────────────

function EditableField({
  value,
  placeholder,
  onSave,
  className,
}: {
  value: string
  placeholder: string
  onSave: (v: string) => void
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLTextAreaElement>(null)

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation()
    setDraft(value)
    setEditing(true)
  }

  useEffect(() => {
    if (editing) ref.current?.focus()
  }, [editing])

  function commit() {
    setEditing(false)
    if (draft.trim() !== value) onSave(draft.trim())
  }

  if (editing) {
    return (
      <textarea
        ref={ref}
        className={`editable-input ${className ?? ''}`}
        value={draft}
        placeholder={placeholder}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit() }
          if (e.key === 'Escape') setEditing(false)
        }}
        onPointerDown={e => e.stopPropagation()}
        rows={2}
      />
    )
  }

  return (
    <span
      className={`editable-display ${className ?? ''} ${!value ? 'editable-placeholder' : ''}`}
      onClick={startEdit}
      title="Click to edit"
    >
      {value || placeholder}
    </span>
  )
}

// ── KanbanCard ─────────────────────────────────────────────────────────────

function KanbanCard({
  card,
  activeId,
  dragCbs,
  onUpdate,
}: {
  card: Card
  activeId: string | null
  dragCbs: DragCallbacks
  onUpdate: (id: string, field: 'title' | 'description', value: string) => void
}) {
  const isDragging = activeId === card.id
  return (
    <div
      className={`kbn-card${isDragging ? ' kbn-card--dragging' : ''}`}
      onPointerDown={e => onCardPointerDown(e, card.id, dragCbs)}
    >
      <EditableField
        value={card.title}
        placeholder="Title…"
        onSave={v => onUpdate(card.id, 'title', v)}
        className="card-title"
      />
      <EditableField
        value={card.description}
        placeholder="Description…"
        onSave={v => onUpdate(card.id, 'description', v)}
        className="card-desc"
      />
    </div>
  )
}

// ── KanbanColumn ───────────────────────────────────────────────────────────

const COL_LABELS: Record<string, string> = {
  todo: 'To Do',
  'in-progress': 'In Progress',
  done: 'Done',
}

function KanbanColumn({
  col,
  cards,
  activeId,
  overCol,
  dragCbs,
  onUpdate,
}: {
  col: string
  cards: Card[]
  activeId: string | null
  overCol: string | null
  dragCbs: DragCallbacks
  onUpdate: (id: string, field: 'title' | 'description', value: string) => void
}) {
  return (
    <div className={`kbn-col${overCol === col ? ' kbn-col--over' : ''}`} data-colonne={col}>
      <div className="kbn-col-header">{COL_LABELS[col] ?? col}</div>
      <div className="kbn-col-body">
        {cards.map(card => (
          <KanbanCard key={card.id} card={card} activeId={activeId} dragCbs={dragCbs} onUpdate={onUpdate} />
        ))}
      </div>
    </div>
  )
}

// ── App ────────────────────────────────────────────────────────────────────

const COLS = ['todo', 'in-progress', 'done'] as const

const INITIAL_CARDS: Card[] = [
  { id: '1', col: 'todo', title: 'Design mockup', description: 'Wireframes for landing page' },
  { id: '2', col: 'todo', title: 'Write tests', description: 'Unit tests for auth module' },
  { id: '3', col: 'in-progress', title: 'API integration', description: 'Connect frontend to REST API' },
  { id: '4', col: 'in-progress', title: 'Fix login bug', description: 'Session token not refreshing' },
  { id: '5', col: 'done', title: 'Setup repo', description: 'Init project and CI pipeline' },
]

export default function App() {
  const [cards, setCards] = useState<Card[]>(INITIAL_CARDS)
  const [orders, setOrders] = useState<Record<string, string[]>>({})
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const parCol = Object.fromEntries(
    COLS.map(col => {
      const colCards = cards.filter(c => c.col === col)
      return [col, applyStoredOrder(colCards, c => c.id, orders[col] || [])]
    })
  )

  function handleDrop(targetCol: string, dropIndex: number) {
    setOverCol(null)
    if (!activeId) return
    const card = cards.find(c => c.id === activeId)
    if (!card) return

    const sourceCol = card.col

    if (sourceCol === targetCol) {
      const colCards = parCol[targetCol] || []
      const sourceIndex = colCards.findIndex(c => c.id === activeId)
      const ids = colCards.map(c => c.id).filter(id => id !== activeId)
      const adjusted = sourceIndex !== -1 && sourceIndex < dropIndex ? dropIndex - 1 : dropIndex
      ids.splice(adjusted, 0, activeId)
      flushSync(() => {
        setOrders(prev => ({ ...prev, [targetCol]: ids }))
        setTick(t => t + 1)
      })
    } else {
      setCards(prev => prev.map(c => c.id === activeId ? { ...c, col: targetCol } : c))

      const targetIds = (parCol[targetCol] || []).map(c => c.id)
      targetIds.splice(dropIndex, 0, activeId)
      setOrders(prev => ({ ...prev, [targetCol]: targetIds }))

      const sourceIds = (parCol[sourceCol] || []).map(c => c.id).filter(id => id !== activeId)
      setOrders(prev => ({ ...prev, [sourceCol]: sourceIds }))
    }
    setActiveId(null)
  }

  function updateCard(id: string, field: 'title' | 'description', value: string) {
    setCards(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c))
  }

  function addCard() {
    const id = String(Date.now())
    setCards(prev => [...prev, { id, col: 'todo', title: '', description: '' }])
  }

  const dragRef = useRef({ setActiveId, setOverCol, handleDrop })
  useEffect(() => { dragRef.current = { setActiveId, setOverCol, handleDrop } })
  const [dragCbs] = useState<DragCallbacks>(() => ({
    setActiveId: (...a) => dragRef.current.setActiveId(...a),
    setOverColonne: (...a) => dragRef.current.setOverCol(...a),
    handleDrop: (...a) => dragRef.current.handleDrop(...a),
  }))

  void tick

  return (
    <div className="app">
      <header className="app-header">
        <h1>Kanban Demo</h1>
        <button className="btn-add" onClick={addCard}>+ Add card</button>
      </header>
      <div className="kbn-board">
        {COLS.map(col => (
          <KanbanColumn
            key={col}
            col={col}
            cards={parCol[col] || []}
            activeId={activeId}
            overCol={overCol}
            dragCbs={dragCbs}
            onUpdate={updateCard}
          />
        ))}
      </div>
    </div>
  )
}
