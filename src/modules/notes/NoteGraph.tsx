import { useMemo, useState } from 'react'
import type { NoteRecord } from '../../types'
import { cn } from '../../lib/utils'
import { t, useT } from '../../i18n'

export interface GraphEdge {
  source: string
  target: string
}

interface NoteGraphProps {
  notes: NoteRecord[]
  edges: GraphEdge[]
  activeId: string | null
  onOpen: (id: string) => void
}

const WIDTH = 300
const HEIGHT = 216

interface GraphPoint {
  id: string
  title: string
  x: number
  y: number
  degree: number
}

function shortTitle(title: string): string {
  const clean = title.trim() || t('未命名')
  return clean.length > 8 ? `${clean.slice(0, 8)}…` : clean
}

export function NoteGraph({ notes, edges, activeId, onOpen }: NoteGraphProps) {
  const t = useT()
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const { nodes, links, neighbors } = useMemo(() => {
    const ordered = [...notes].sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'))
    const count = ordered.length
    const points: GraphPoint[] = ordered.map((note, index) => {
      const angle = (index / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2
      const radius = Math.min(WIDTH, HEIGHT) * 0.34
      return {
        id: note.id,
        title: note.title,
        x: WIDTH / 2 + Math.cos(angle) * radius,
        y: HEIGHT / 2 + Math.sin(angle) * radius,
        degree: 0,
      }
    })
    const byId = new Map(points.map((point) => [point.id, point]))
    const visible = edges.filter((edge) => byId.has(edge.source) && byId.has(edge.target))
    const neighborMap = new Map<string, Set<string>>()
    for (const edge of visible) {
      if (!neighborMap.has(edge.source)) neighborMap.set(edge.source, new Set())
      if (!neighborMap.has(edge.target)) neighborMap.set(edge.target, new Set())
      neighborMap.get(edge.source)?.add(edge.target)
      neighborMap.get(edge.target)?.add(edge.source)
    }
    for (const point of points) point.degree = neighborMap.get(point.id)?.size ?? 0

    const iterations = count > 60 ? 80 : count > 30 ? 120 : 180
    for (let step = 0; step < iterations; step += 1) {
      const forces = points.map(() => ({ x: 0, y: 0 }))
      for (let i = 0; i < count; i += 1) {
        for (let j = i + 1; j < count; j += 1) {
          const a = points[i]
          const b = points[j]
          let dx = a.x - b.x
          let dy = a.y - b.y
          let distanceSq = dx * dx + dy * dy
          if (distanceSq < 0.01) {
            dx = (i - j) * 0.5 + 0.1
            dy = 1
            distanceSq = dx * dx + dy * dy
          }
          const distance = Math.sqrt(distanceSq)
          const force = 460 / (distanceSq + 90)
          const fx = (dx / distance) * force
          const fy = (dy / distance) * force
          forces[i].x += fx
          forces[i].y += fy
          forces[j].x -= fx
          forces[j].y -= fy
        }
      }
      for (const edge of visible) {
        const a = byId.get(edge.source)
        const b = byId.get(edge.target)
        if (!a || !b) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const distance = Math.sqrt(dx * dx + dy * dy) || 0.01
        const force = (distance - 66) * 0.028
        const fx = (dx / distance) * force
        const fy = (dy / distance) * force
        const indexA = points.indexOf(a)
        const indexB = points.indexOf(b)
        forces[indexA].x += fx
        forces[indexA].y += fy
        forces[indexB].x -= fx
        forces[indexB].y -= fy
      }
      for (let i = 0; i < count; i += 1) {
        forces[i].x += (WIDTH / 2 - points[i].x) * 0.007
        forces[i].y += (HEIGHT / 2 - points[i].y) * 0.007
        points[i].x = Math.min(WIDTH - 32, Math.max(32, points[i].x + Math.max(-6, Math.min(6, forces[i].x))))
        points[i].y = Math.min(HEIGHT - 28, Math.max(28, points[i].y + Math.max(-6, Math.min(6, forces[i].y))))
      }
    }

    const pad = 26
    const minX = Math.min(...points.map((point) => point.x))
    const maxX = Math.max(...points.map((point) => point.x))
    const minY = Math.min(...points.map((point) => point.y))
    const maxY = Math.max(...points.map((point) => point.y))
    const spread = Math.max(
      1,
      Math.min(
        2.1,
        (WIDTH - pad * 2) / Math.max(1, maxX - minX),
        (HEIGHT - pad * 2) / Math.max(1, maxY - minY),
      ),
    )
    if (spread > 1) {
      const centerX = (minX + maxX) / 2
      const centerY = (minY + maxY) / 2
      for (const point of points) {
        point.x = WIDTH / 2 + (point.x - centerX) * spread
        point.y = HEIGHT / 2 + (point.y - centerY) * spread
      }
    }

    return { nodes: points, links: visible, neighbors: neighborMap }
  }, [notes, edges])

  const focusId = hoveredId ?? activeId
  const focusNeighbors = focusId ? neighbors.get(focusId) : undefined

  return (
    <svg
      className="note-graph"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={t('笔记关系图谱')}
      onMouseLeave={() => setHoveredId(null)}
    >
      <g>
        {links.map((edge) => {
          const hot = Boolean(focusId && (edge.source === focusId || edge.target === focusId))
          const dim = Boolean(focusId && !hot)
          return (
            <line
              key={`${edge.source}-${edge.target}`}
              className={cn('ng-edge', hot && 'hot', dim && 'dim')}
              x1={nodes.find((node) => node.id === edge.source)?.x ?? 0}
              y1={nodes.find((node) => node.id === edge.source)?.y ?? 0}
              x2={nodes.find((node) => node.id === edge.target)?.x ?? 0}
              y2={nodes.find((node) => node.id === edge.target)?.y ?? 0}
            />
          )
        })}
      </g>
      <g>
        {nodes.map((node) => {
          const isActive = node.id === activeId
          const isHot = node.id === focusId || Boolean(focusId && focusNeighbors?.has(node.id))
          const showLabel = nodes.length <= 14 || isActive || isHot
          const radius = 5.2 + Math.min(4.8, node.degree * 1.1) + (isActive ? 1.5 : 0)
          return (
            <g
              key={node.id}
              className={cn('ng-node', isActive && 'current', isHot && 'hot', focusId && !isHot && !isActive && 'dim')}
              role="button"
              tabIndex={0}
              aria-label={t('打开笔记 {title}', { title: node.title })}
              onClick={() => onOpen(node.id)}
              onMouseEnter={() => setHoveredId(node.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onOpen(node.id)
                }
              }}
            >
              <title>{t('{title} · {count} 条连接', { title: node.title, count: node.degree })}</title>
              {isActive && <circle className="ng-halo" cx={node.x} cy={node.y} r={radius + 6} />}
              <circle className="ng-dot" cx={node.x} cy={node.y} r={radius} />
              {showLabel && (
                <text className="ng-label" x={node.x} y={node.y + radius + 10}>
                  {shortTitle(node.title)}
                </text>
              )}
            </g>
          )
        })}
      </g>
    </svg>
  )
}
