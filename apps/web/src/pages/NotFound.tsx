import { useNavigate } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

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
            // Navigate to the root, NOT a static `/${DEFAULT_TENANT}/…` target.
            // RootRedirect (App.tsx) derives the landing URL from the SERVER tenant
            // (`/v1/tenants/me`), so no client-side default ever drives a tenant URL
            // here (§3.2 "derive from server"). Defense-in-depth: the AppShell gate
            // already neutralizes a wrong segment, but this removes the static
            // DEFAULT_TENANT from the navigation target entirely.
            onClick: () => navigate('/'),
          }}
        />
      </div>
    </div>
  )
}
