import { Clock, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WorkflowSchedule } from '@/mocks/workflows'

/**
 * ScheduleEditor (M2 P3-A).
 *
 * Two controls over one schedule: a friendly DAILY-TIME picker (for owners) and
 * a raw CRON field (for power users). Both read the same `WorkflowSchedule` view
 * model so they never diverge.
 *
 * M2 ships EDITING DISABLED — Schedules CRUD lands in P5a. So every input is
 * read-only/disabled and the card carries an explicit "editing coming soon"
 * affordance; it is NEVER a dead write surface. Uses the locked light-surface
 * form-field styling (`.field` / `.field-label` / `.field-hint` from
 * `light-form-fields.css`).
 */
export interface ScheduleEditorProps {
  schedule: WorkflowSchedule
  className?: string
}

export function ScheduleEditor({ schedule, className }: ScheduleEditorProps) {
  return (
    <section
      className={cn('border border-[var(--rule)] bg-[var(--surface)]', className)}
      aria-labelledby="schedule-editor-heading"
    >
      {/* Header + the "editing coming soon" badge. */}
      <div className="flex items-center justify-between gap-4 border-b border-[var(--border)] px-6 py-4">
        <div className="flex items-center gap-2">
          <Clock className="size-4 text-[var(--muted-foreground)]" aria-hidden="true" />
          <h2
            id="schedule-editor-heading"
            className="font-serif text-lg leading-tight text-[var(--foreground)]"
          >
            Schedule
          </h2>
        </div>
        <span
          className="inline-flex items-center gap-1.5 border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-[0.04em] text-[var(--muted-foreground)]"
          aria-label="Editing coming soon"
        >
          <Lock className="size-3" aria-hidden="true" />
          Editing coming soon
        </span>
      </div>

      <div className="space-y-6 px-6 py-5">
        {/* Plain-language summary. */}
        <p className="text-sm text-[var(--foreground-soft)]">{schedule.summary}</p>

        <div className="grid gap-5 sm:grid-cols-2">
          {/* Friendly daily-time picker (disabled). */}
          <div>
            <label htmlFor="schedule-time" className="field-label">
              Run every day at
            </label>
            <input
              id="schedule-time"
              type="time"
              className="field"
              value={schedule.dailyTime}
              disabled
              aria-disabled="true"
              readOnly
            />
            <p className="field-hint">Timezone: {schedule.timezone}</p>
          </div>

          {/* Status (enabled / paused) — read-only display. */}
          <div>
            <span className="field-label">Status</span>
            <div
              className="field flex items-center"
              aria-disabled="true"
              role="status"
            >
              {schedule.enabled ? 'Active' : 'Paused'}
            </div>
            {schedule.nextRunAt && (
              <p className="field-hint">Next run: {schedule.nextRunAt}</p>
            )}
          </div>
        </div>

        {/* Raw cron field for power users (disabled). */}
        <div>
          <label htmlFor="schedule-cron" className="field-label">
            Cron expression
          </label>
          <input
            id="schedule-cron"
            type="text"
            className="field font-mono text-[0.8125rem]"
            value={schedule.cron}
            disabled
            aria-disabled="true"
            readOnly
            spellCheck={false}
          />
          <p className="field-hint">
            Power-user override. Editing the schedule arrives with the next update.
          </p>
        </div>
      </div>
    </section>
  )
}
