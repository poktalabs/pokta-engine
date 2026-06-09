import type { ReportColumn } from '@/mocks/reports'
import { cn } from '@/lib/utils'

/**
 * A simple hairline-grid table for the opened report (M2 P4-B).
 *
 * Brand "scientific-print table" look: hard ink frame, soft 15%-ink row rules,
 * radius 0, Manrope body, numeric columns right-aligned + tabular. String cells
 * only (the mock pre-formats currency/percent display values).
 */
export interface ReportTableProps {
  title: string
  columns: ReportColumn[]
  rows: Record<string, string>[]
}

export function ReportTable({ title, columns, rows }: ReportTableProps) {
  return (
    <section className="border border-[var(--rule)] bg-[var(--surface)]">
      <header className="border-b border-[var(--rule)] px-6 py-4">
        <h3 className="font-serif text-lg leading-tight text-[var(--foreground)]">{title}</h3>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={cn(
                    'kicker px-6 py-3 text-[var(--muted-foreground)]',
                    col.align === 'right' ? 'text-right' : 'text-left',
                  )}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((row, i) => (
              <tr key={i} className="align-top">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      'px-6 py-3 font-sans text-[var(--foreground)]',
                      col.align === 'right' && 'text-right tabular-nums',
                    )}
                  >
                    {row[col.key] ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
