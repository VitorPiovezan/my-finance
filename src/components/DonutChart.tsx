import { useId, useMemo, useState } from 'react'

export type DonutSlice = {
  id: string
  label: string
  value: number
  color: string
}

type DonutChartProps = {
  slices: DonutSlice[]
  /** Conteúdo central (ex.: total formatado). */
  centerLabel?: string
  centerSub?: string
  /** Tamanho em px. Quadrado. */
  size?: number
  strokeWidth?: number
  /** Callback quando o usuário clica em uma fatia. */
  onSliceClick?: (slice: DonutSlice) => void
  emptyMessage?: string
}

/**
 * Gráfico de rosca em SVG puro. Cada fatia é um arco desenhado com "stroke" em um círculo,
 * usando `pathLength=100` para que `strokeDasharray` represente diretamente a porcentagem.
 */
export function DonutChart({
  slices,
  centerLabel,
  centerSub,
  size = 220,
  strokeWidth = 24,
  onSliceClick,
  emptyMessage = 'Sem dados para o período',
}: DonutChartProps) {
  const [hoverId, setHoverId] = useState<string | null>(null)
  const titleId = useId()

  const { total, nonZero } = useMemo(() => {
    const filtered = slices.filter((s) => s.value > 0)
    const sum = filtered.reduce((a, s) => a + s.value, 0)
    return { total: sum, nonZero: filtered }
  }, [slices])

  const radius = (size - strokeWidth) / 2
  const cx = size / 2
  const cy = size / 2

  if (total <= 0 || nonZero.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-full border border-dashed border-white/10 text-xs text-zinc-500"
        style={{ width: size, height: size }}
      >
        {emptyMessage}
      </div>
    )
  }

  let offset = 0
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-labelledby={titleId}
      className="block"
    >
      <title id={titleId}>Distribuição por categoria</title>
      <circle cx={cx} cy={cy} r={radius} fill="transparent" stroke="rgba(255,255,255,0.05)" strokeWidth={strokeWidth} />
      {nonZero.map((slice) => {
        const pct = (slice.value / total) * 100
        const dash = `${pct} ${100 - pct}`
        const el = (
          <circle
            key={slice.id}
            cx={cx}
            cy={cy}
            r={radius}
            fill="transparent"
            stroke={slice.color}
            strokeWidth={hoverId === slice.id ? strokeWidth + 4 : strokeWidth}
            strokeDasharray={dash}
            strokeDashoffset={-offset}
            pathLength={100}
            transform={`rotate(-90 ${cx} ${cy})`}
            style={{
              cursor: onSliceClick ? 'pointer' : 'default',
              transition: 'stroke-width 120ms ease-out, opacity 120ms ease-out',
              opacity: hoverId && hoverId !== slice.id ? 0.45 : 1,
            }}
            onMouseEnter={() => setHoverId(slice.id)}
            onMouseLeave={() => setHoverId((v) => (v === slice.id ? null : v))}
            onClick={() => onSliceClick?.(slice)}
          >
            <title>{`${slice.label} — ${pct.toFixed(1)}%`}</title>
          </circle>
        )
        offset += pct
        return el
      })}
      {centerLabel ? (
        <g>
          <text
            x={cx}
            y={cy - 4}
            textAnchor="middle"
            fontSize={size * 0.095}
            fontWeight={600}
            fill="#f4f4f5"
            style={{ fontFeatureSettings: '"tnum"' }}
          >
            {centerLabel}
          </text>
          {centerSub ? (
            <text
              x={cx}
              y={cy + size * 0.08}
              textAnchor="middle"
              fontSize={size * 0.055}
              fill="#a1a1aa"
            >
              {centerSub}
            </text>
          ) : null}
        </g>
      ) : null}
    </svg>
  )
}

/** Paleta de cores para categorias (dark friendly). */
export const CATEGORY_PALETTE = [
  '#60a5fa', // blue-400
  '#f472b6', // pink-400
  '#34d399', // emerald-400
  '#fbbf24', // amber-400
  '#a78bfa', // violet-400
  '#fb7185', // rose-400
  '#22d3ee', // cyan-400
  '#f97316', // orange-500
  '#4ade80', // green-400
  '#e879f9', // fuchsia-400
  '#facc15', // yellow-400
  '#94a3b8', // slate-400 (fallback / sem categoria)
] as const

export function colorForIndex(i: number): string {
  return CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]
}

/**
 * Devolve uma cor estável para uma categoria, derivada do seu ID via hash simples (djb2).
 * `null` representa "Sem categoria" e usa o último tom da paleta (slate), propositalmente
 * mais neutro que as demais cores.
 */
export function colorForCategoryId(id: string | null | undefined): string {
  if (!id) return CATEGORY_PALETTE[CATEGORY_PALETTE.length - 1]
  let h = 5381
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) + h + id.charCodeAt(i)) | 0
  }
  const usable = CATEGORY_PALETTE.length - 1
  const idx = Math.abs(h) % usable
  return CATEGORY_PALETTE[idx]
}
