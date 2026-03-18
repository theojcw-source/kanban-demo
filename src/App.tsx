import { useState, useRef, useEffect } from 'react'
import { flushSync } from 'react-dom'
import { onCardPointerDown, applyStoredOrder, type DragCallbacks } from './kanbanDrag'
import { supabase, type DbColumn, type DbCard } from './supabase'
import './App.css'

// ── Types ──────────────────────────────────────────────────────────────────

interface Card {
  id: string
  col_id: string
  title: string
  description: string
  position: number
}

interface Column {
  id: string
  title: string
  position: number
}

// ── EditableField (cards) ──────────────────────────────────────────────────

function EditableField({
  value, placeholder, onSave, className,
}: {
  value: string
  placeholder: string
  onSave: (v: string) => void
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { if (editing) ref.current?.focus() }, [editing])

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
      onDoubleClick={e => { e.stopPropagation(); setDraft(value); setEditing(true) }}
    >
      {value || placeholder}
    </span>
  )
}

// ── EditableColTitle ───────────────────────────────────────────────────────

function EditableColTitle({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) ref.current?.select() }, [editing])

  function commit() {
    setEditing(false)
    if (draft.trim() && draft.trim() !== value) onSave(draft.trim())
  }

  if (editing) {
    return (
      <input
        ref={ref}
        className="col-title-input"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
      />
    )
  }

  return (
    <span className="col-title" onDoubleClick={() => { setDraft(value); setEditing(true) }}>
      {value}
    </span>
  )
}

// ── KanbanCard ─────────────────────────────────────────────────────────────

function KanbanCard({
  card, activeId, dragCbs, onUpdate, onDelete,
}: {
  card: Card
  activeId: string | null
  dragCbs: DragCallbacks
  onUpdate: (id: string, field: 'title' | 'description', value: string) => void
  onDelete: (id: string) => void
}) {
  return (
    <div
      className={`kbn-card${activeId === card.id ? ' kbn-card--dragging' : ''}`}
      onPointerDown={e => onCardPointerDown(e, card.id, dragCbs)}
    >
      <div className="card-header">
        <EditableField value={card.title} placeholder="Title…" onSave={v => onUpdate(card.id, 'title', v)} className="card-title" />
        <button className="btn-delete-card" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onDelete(card.id) }} title="Delete">✕</button>
      </div>
      <EditableField value={card.description} placeholder="Description…" onSave={v => onUpdate(card.id, 'description', v)} className="card-desc" />
    </div>
  )
}

// ── KanbanColumn ───────────────────────────────────────────────────────────

function KanbanColumn({
  col, cards, activeId, overCol, dragCbs, onUpdate, onDelete, onDeleteCol, onRenameCol,
}: {
  col: Column
  cards: Card[]
  activeId: string | null
  overCol: string | null
  dragCbs: DragCallbacks
  onUpdate: (id: string, field: 'title' | 'description', value: string) => void
  onDelete: (id: string) => void
  onDeleteCol: (id: string) => void
  onRenameCol: (id: string, title: string) => void
}) {
  return (
    <div className={`kbn-col${overCol === col.id ? ' kbn-col--over' : ''}`} data-colonne={col.id}>
      <div className="kbn-col-header">
        <EditableColTitle value={col.title} onSave={t => onRenameCol(col.id, t)} />
        <button className="btn-delete-col" onClick={() => onDeleteCol(col.id)} title="Delete column">✕</button>
      </div>
      <div className="kbn-col-body">
        {cards.map(card => (
          <KanbanCard key={card.id} card={card} activeId={activeId} dragCbs={dragCbs} onUpdate={onUpdate} onDelete={onDelete} />
        ))}
      </div>
    </div>
  )
}

// ── AddMenu ────────────────────────────────────────────────────────────────

function AddMenu({
  columns,
  onAddCard,
  onAddColumn,
}: {
  columns: Column[]
  onAddCard: (colId: string) => void
  onAddColumn: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  return (
    <div className="add-menu" ref={ref}>
      <button className="btn-add-main" onClick={() => setOpen(o => !o)}>+ New</button>
      {open && (
        <div className="add-dropdown">
          {columns.map(col => (
            <button key={col.id} className="add-dropdown-item" onClick={() => { onAddCard(col.id); setOpen(false) }}>
              Add card → <span className="add-dropdown-col">{col.title}</span>
            </button>
          ))}
          {columns.length > 0 && <div className="add-dropdown-sep" />}
          <button className="add-dropdown-item" onClick={() => { onAddColumn(); setOpen(false) }}>
            Add column
          </button>
        </div>
      )}
    </div>
  )
}

// ── App ────────────────────────────────────────────────────────────────────

export default function App() {
  const [columns, setColumns] = useState<Column[]>([])
  const [cards, setCards] = useState<Card[]>([])
  const [orders, setOrders] = useState<Record<string, string[]>>({})
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [loading, setLoading] = useState(true)
  const [addingCol, setAddingCol] = useState(false)
  const [newColTitle, setNewColTitle] = useState('')

  useEffect(() => {
    async function load() {
      const [{ data: cols }, { data: cds }] = await Promise.all([
        supabase.from('kanban_columns').select('*').order('position'),
        supabase.from('kanban_cards').select('*').order('position'),
      ])
      setColumns((cols as DbColumn[]) || [])
      setCards((cds as DbCard[]) || [])
      setLoading(false)
    }
    load()
  }, [])

  const sortedCols = [...columns].sort((a, b) => a.position - b.position)

  const parCol = Object.fromEntries(
    sortedCols.map(col => {
      const colCards = cards.filter(c => c.col_id === col.id)
      return [col.id, applyStoredOrder(colCards, c => c.id, orders[col.id] || [])]
    })
  )

  // ── Card actions ─────────────────────────────────────────────────────────

  async function addCard(colId: string) {
    const id = String(Date.now())
    const position = (parCol[colId] || []).length
    const card: Card = { id, col_id: colId, title: '', description: '', position }
    setCards(prev => [...prev, card])
    await supabase.from('kanban_cards').insert({ id, col_id: colId, title: '', description: '', position })
  }

  async function deleteCard(id: string) {
    setCards(prev => prev.filter(c => c.id !== id))
    await supabase.from('kanban_cards').delete().eq('id', id)
  }

  async function updateCard(id: string, field: 'title' | 'description', value: string) {
    setCards(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c))
    await supabase.from('kanban_cards').update({ [field]: value }).eq('id', id)
  }

  // ── Column actions ────────────────────────────────────────────────────────

  async function addColumn() {
    const title = newColTitle.trim()
    if (!title) return
    const id = title.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now()
    const position = columns.length
    setColumns(prev => [...prev, { id, title, position }])
    setNewColTitle('')
    setAddingCol(false)
    await supabase.from('kanban_columns').insert({ id, title, position })
  }

  async function deleteColumn(id: string) {
    setColumns(prev => prev.filter(c => c.id !== id))
    setCards(prev => prev.filter(c => c.col_id !== id))
    await supabase.from('kanban_columns').delete().eq('id', id)
  }

  async function renameColumn(id: string, title: string) {
    setColumns(prev => prev.map(c => c.id === id ? { ...c, title } : c))
    await supabase.from('kanban_columns').update({ title }).eq('id', id)
  }

  // ── Drag & drop ───────────────────────────────────────────────────────────

  function handleDrop(targetColId: string, dropIndex: number) {
    setOverCol(null)
    if (!activeId) return
    const card = cards.find(c => c.id === activeId)
    if (!card) return
    const sourceColId = card.col_id

    if (sourceColId === targetColId) {
      const colCards = parCol[targetColId] || []
      const sourceIndex = colCards.findIndex(c => c.id === activeId)
      const ids = colCards.map(c => c.id).filter(id => id !== activeId)
      const adjusted = sourceIndex !== -1 && sourceIndex < dropIndex ? dropIndex - 1 : dropIndex
      ids.splice(adjusted, 0, activeId)
      flushSync(() => { setOrders(prev => ({ ...prev, [targetColId]: ids })); setTick(t => t + 1) })
      ids.forEach((cid, i) => supabase.from('kanban_cards').update({ position: i }).eq('id', cid))
    } else {
      setCards(prev => prev.map(c => c.id === activeId ? { ...c, col_id: targetColId } : c))
      const targetIds = (parCol[targetColId] || []).map(c => c.id)
      targetIds.splice(dropIndex, 0, activeId)
      setOrders(prev => ({ ...prev, [targetColId]: targetIds }))
      const sourceIds = (parCol[sourceColId] || []).map(c => c.id).filter(id => id !== activeId)
      setOrders(prev => ({ ...prev, [sourceColId]: sourceIds }))
      supabase.from('kanban_cards').update({ col_id: targetColId, position: dropIndex }).eq('id', activeId)
      targetIds.forEach((cid, i) => supabase.from('kanban_cards').update({ position: i }).eq('id', cid))
      sourceIds.forEach((cid, i) => supabase.from('kanban_cards').update({ position: i }).eq('id', cid))
    }
    setActiveId(null)
  }

  const dragRef = useRef({ setActiveId, setOverCol, handleDrop })
  useEffect(() => { dragRef.current = { setActiveId, setOverCol, handleDrop } })
  const [dragCbs] = useState<DragCallbacks>(() => ({
    setActiveId: (...a) => dragRef.current.setActiveId(...a),
    setOverColonne: (...a) => dragRef.current.setOverCol(...a),
    handleDrop: (...a) => dragRef.current.handleDrop(...a),
  }))

  void tick

  if (loading) return <div className="loading"><div className="spinner" />Loading…</div>

  return (
    <div className="app">
      <header className="app-header">
        <h1>Simple Kanban</h1>
        <AddMenu columns={sortedCols} onAddCard={addCard} onAddColumn={() => setAddingCol(true)} />
      </header>

      <div className="kbn-board">
        {sortedCols.map(col => (
          <KanbanColumn
            key={col.id} col={col}
            cards={parCol[col.id] || []}
            activeId={activeId} overCol={overCol} dragCbs={dragCbs}
            onUpdate={updateCard} onDelete={deleteCard}
            onDeleteCol={deleteColumn} onRenameCol={renameColumn}
          />
        ))}

        {addingCol && (
          <div className="kbn-col kbn-col--new">
            <input
              className="new-col-input" autoFocus placeholder="Column name…"
              value={newColTitle} onChange={e => setNewColTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addColumn(); if (e.key === 'Escape') { setAddingCol(false); setNewColTitle('') } }}
            />
            <div className="new-col-btns">
              <button className="btn-confirm" onClick={addColumn}>Add</button>
              <button className="btn-cancel" onClick={() => { setAddingCol(false); setNewColTitle('') }}>✕</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
