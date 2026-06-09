import { Link } from 'react-router-dom'
import { Plug } from 'lucide-react'
import { ComingSoon } from '@/components/ui/ComingSoon'

/**
 * Integration-status summary panel — DEFERRED (P5b Wave 2).
 *
 * The honest per-tenant integration enablement status lives on its own surface
 * (the Integrations page → GET /v1/integrations). This Settings panel keeps its
 * SHELL but no longer fabricates a rows table — it points to the live surface
 * instead of duplicating it with mock data.
 */
export interface IntegrationStatusPanelProps {
  /** Base path for the workspace, e.g. `/mi-pase`, so the link is tenant-scoped. */
  basePath: string
}

export function IntegrationStatusPanel({ basePath }: IntegrationStatusPanelProps) {
  return (
    <section aria-labelledby="settings-integrations-heading" className="space-y-4">
      <h2
        id="settings-integrations-heading"
        className="font-serif text-xl leading-tight text-[var(--foreground)]"
      >
        Integration status
      </h2>
      <ComingSoon
        Icon={Plug}
        title="Manage integrations on the Integrations page"
        description={
          <>
            Connector enablement status now lives on its own surface.{' '}
            <Link
              to={`${basePath}/integrations`}
              className="underline underline-offset-2 hover:text-[var(--foreground)]"
            >
              Open Integrations
            </Link>
            .
          </>
        }
      />
    </section>
  )
}
