'use client'

import { useSession } from 'next-auth/react'
import ModelConfigForm from '@/components/ModelConfigForm'

/**
 * Thin client wrapper: ModelConfigForm itself is transport-agnostic, this is
 * the one spot that knows about the NextAuth session and refreshes its
 * `hasModelConfig` JWT claim right after a successful save (instead of
 * waiting for natural token refresh).
 */
export default function SettingsModelSection() {
  const { update } = useSession()

  return <ModelConfigForm onSaved={() => update()} />
}
