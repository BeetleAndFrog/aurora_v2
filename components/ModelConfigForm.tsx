'use client'

import { useEffect, useState, type FormEvent } from 'react'

type Provider = 'openrouter' | 'vercel' | 'custom'

/** Known OpenAI-compatible base URLs. `null` baseUrl = free-text (Custom). */
const PROVIDER_PRESETS: Record<Provider, { label: string; baseUrl: string | null }> = {
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  // ponytail: Vercel's documented OpenAI-compatible base URL per their AI Gateway
  // docs as of training cutoff. Verify against gateway.vercel.com/docs if this 404s.
  vercel: { label: 'Vercel AI Gateway', baseUrl: 'https://ai-gateway.vercel.sh/v1' },
  custom: { label: 'Custom', baseUrl: null },
}

// ponytail: any current OpenRouter free-tier slug works here — not guaranteed
// live forever, swap if OpenRouter retires it.
const OPENROUTER_FREE_MODEL = 'meta-llama/llama-3.1-8b-instruct:free'

type ConfigStatus = {
  hasConfig: boolean
  label?: string | null
  baseUrl?: string | null
  model?: string | null
  verifiedAt?: string | null
}

export default function ModelConfigForm({ onSaved }: { onSaved?: () => void }) {
  const [checking, setChecking] = useState(true)
  const [status, setStatus] = useState<ConfigStatus | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  const [provider, setProvider] = useState<Provider>('openrouter')
  const [baseUrl, setBaseUrl] = useState(PROVIDER_PRESETS.openrouter.baseUrl ?? '')
  const [model, setModel] = useState(OPENROUTER_FREE_MODEL)
  const [apiKey, setApiKey] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let active = true
    fetch('/api/model-config')
      .then(res => (res.ok ? res.json() : null))
      .then((data: ConfigStatus | null) => {
        if (!active) return
        if (data) {
          setStatus(data)
          if (!data.hasConfig) {
            setFormOpen(true)
          } else {
            // Already connected from a prior save (e.g. the user reloaded
            // mid-onboarding after saving but before finishing other
            // fields) — the parent's gate should see this as satisfied too,
            // not just a fresh submit in this mount.
            onSaved?.()
          }
        } else {
          setFormOpen(true)
        }
      })
      .catch(() => {
        if (active) setFormOpen(true)
      })
      .finally(() => {
        if (active) setChecking(false)
      })
    return () => {
      active = false
    }
  }, [])

  function selectProvider(next: Provider) {
    setProvider(next)
    const preset = PROVIDER_PRESETS[next]
    setBaseUrl(preset.baseUrl ?? '')
    if (next === 'openrouter' && !model.trim()) setModel(OPENROUTER_FREE_MODEL)
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch('/api/model-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: PROVIDER_PRESETS[provider].label, baseUrl, model, apiKey }),
      })
      const data = await res.json()
      if (data.ok) {
        setSaved(true)
        setApiKey('')
        setStatus({
          hasConfig: true,
          label: PROVIDER_PRESETS[provider].label,
          baseUrl,
          model,
          verifiedAt: new Date().toISOString(),
        })
        onSaved?.()
      } else {
        setError(data.error || 'Could not verify this configuration.')
      }
    } catch {
      setError('Network error — could not reach the server.')
    } finally {
      setSaving(false)
    }
  }

  if (checking) {
    return <p className="text-sm text-gray-500">Checking configuration…</p>
  }

  return (
    <div className="space-y-4">
      {status?.hasConfig && !formOpen && (
        <div className="rounded-xl border border-gray-800 bg-[#0a0a0a] p-4 text-sm text-gray-300">
          <p>
            Connected: <span className="text-white">{status.label || status.baseUrl}</span>, model{' '}
            <span className="text-white">{status.model}</span>
            {status.verifiedAt && <>, verified {new Date(status.verifiedAt).toLocaleString()}</>}
          </p>
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="mt-3 rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:border-gray-500"
          >
            Replace
          </button>
        </div>
      )}

      {formOpen && (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">Provider</label>
            <select
              value={provider}
              onChange={e => selectProvider(e.target.value as Provider)}
              className="w-full rounded-xl border border-gray-800 bg-[#0a0a0a] px-4 py-3 text-sm text-white focus:border-gray-600 focus:outline-none"
            >
              <option value="openrouter">OpenRouter</option>
              <option value="vercel">Vercel AI Gateway</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          {provider === 'openrouter' && (
            <a
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noreferrer"
              className="inline-block text-xs font-medium text-blue-400 underline hover:text-blue-300"
            >
              Get a free API key from OpenRouter (~30 sec)
            </a>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">Base URL</label>
            <input
              required
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              readOnly={provider !== 'custom'}
              placeholder="https://api.example.com/v1"
              className={`w-full rounded-xl border border-gray-800 px-4 py-3 text-sm placeholder-gray-600 focus:border-gray-600 focus:outline-none ${
                provider !== 'custom' ? 'bg-[#141414] text-gray-400' : 'bg-[#0a0a0a] text-white'
              }`}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">Model ID</label>
            <input
              required
              value={model}
              onChange={e => setModel(e.target.value)}
              placeholder="anthropic/claude-3.5-sonnet"
              className="w-full rounded-xl border border-gray-800 bg-[#0a0a0a] px-4 py-3 text-sm text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">API Key</label>
            <input
              required
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-…"
              autoComplete="off"
              className="w-full rounded-xl border border-gray-800 bg-[#0a0a0a] px-4 py-3 text-sm text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
            />
            <p className="mt-1 text-xs text-gray-500">Never shown again once saved.</p>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-blue-600 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Testing…' : 'Test & Save'}
          </button>

          {error && <p className="text-sm text-red-400">{error}</p>}
          {saved && !error && <p className="text-sm text-emerald-400">Saved — connection verified</p>}
        </form>
      )}
    </div>
  )
}
