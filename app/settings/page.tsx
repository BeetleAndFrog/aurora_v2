import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import SettingsModelSection from './SettingsModelSection'

export default async function SettingsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) redirect('/auth/signin?callbackUrl=/settings')

  return (
    <div className="min-h-screen bg-[#0a0a0a] p-4 py-12">
      <div className="mx-auto w-full max-w-md">
        <h1 className="mb-8 text-2xl font-bold text-white">Settings</h1>

        <section className="rounded-2xl border border-gray-800 bg-[#1a1a1a] p-8">
          <h2 className="mb-2 text-lg font-semibold text-white">Model</h2>
          <p className="mb-6 text-sm text-gray-400">
            Astryon&apos;s AI features run on your own model access. Connect a provider below.
          </p>
          <SettingsModelSection />
        </section>
      </div>
    </div>
  )
}
