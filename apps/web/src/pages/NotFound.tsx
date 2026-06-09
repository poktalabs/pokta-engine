import { useNavigate } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { DEFAULT_TENANT } from '@/providers/TenantProvider'

/** 404 — routed catch-all. */
export default function NotFound() {
  const navigate = useNavigate()
  return (
    <div className="grid min-h-screen place-items-center bg-[var(--background)] p-6">
      <div className="w-full max-w-md">
        <EmptyState
          Icon={Compass}
          title="Page not found"
          description="That route doesn’t exist. Head back to your workspace."
          action={{
            label: 'Go to workspace',
            onClick: () => navigate(`/${DEFAULT_TENANT}/approvals`),
          }}
        />
      </div>
    </div>
  )
}
