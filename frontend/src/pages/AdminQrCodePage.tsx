import { useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'

type QrResponse = {
  message: string
  terminal: {
    id: string
    name: string | null
    branch: string
  }
  qr: {
    token: string
    expiresAt: string
    ttlSeconds: number
    singleUse?: boolean
    reusable?: boolean
  }
}

const AdminQrCodePage = () => {
  const { session } = useAuth()
  const token = session?.access_token

  const [terminalId, setTerminalId] = useState('terminal-sp-01')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [qrData, setQrData] = useState<QrResponse | null>(null)

  const handleGenerate = async () => {
    if (!token) return

    setLoading(true)
    setError('')
    setNotice('')

    try {
      const response = await apiFetch<QrResponse>('/time/terminal/qr', {
        token,
        method: 'POST',
        body: { terminalId: terminalId.trim() },
      })

      setQrData(response)
      setNotice('QR de terminal gerado com sucesso.')
    } catch (err) {
      setQrData(null)
      setError(err instanceof Error ? err.message : 'Erro ao gerar QR do terminal')
    } finally {
      setLoading(false)
    }
  }

  const qrImageUrl = qrData?.qr?.token
    ? `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(qrData.qr.token)}`
    : null

  return (
    <section className="grid gap-6">
      <div className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.35em] text-teal-700">Admin</p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">QR Code do terminal</h2>
        <p className="mt-3 text-sm text-slate-600">
          Gere um QR para imprimir e fixar no local. O colaborador valida presença lendo este QR pela câmera.
        </p>
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Terminal ID</label>
        <input
          value={terminalId}
          onChange={(event) => setTerminalId(event.target.value)}
          placeholder="terminal-sp-01"
          className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-200"
        />

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={handleGenerate}
            disabled={loading || !terminalId.trim()}
            className="rounded-full bg-teal-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {loading ? 'Gerando...' : 'Gerar QR'}
          </button>

        </div>

        {error ? <p className="mt-3 text-xs text-rose-600">{error}</p> : null}
        {notice ? <p className="mt-3 text-xs text-emerald-600">{notice}</p> : null}
      </div>

      {qrData ? (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <div className="rounded-3xl border border-slate-100 bg-white/90 p-4 shadow-sm">
            {qrImageUrl ? (
              <img src={qrImageUrl} alt="QR Code do terminal" className="h-[260px] w-[260px] rounded-2xl border border-slate-100" />
            ) : null}
          </div>

          <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900">Dados do QR gerado</h3>
            <p className="mt-3 text-sm text-slate-700">
              Terminal: <strong>{qrData.terminal.name || qrData.terminal.id}</strong> ({qrData.terminal.branch})
            </p>
            <p className="mt-1 text-sm text-slate-700">Expira em: {new Date(qrData.qr.expiresAt).toLocaleString('pt-BR')}</p>
            <p className="mt-1 text-sm text-slate-700">TTL: {qrData.qr.ttlSeconds}s</p>
            <p className="mt-1 text-sm text-slate-700">
              Modo: {qrData.qr.reusable ? 'Reutilizável (recomendado para QR na parede)' : 'Uso único'}
            </p>

            <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Token técnico</label>
            <textarea
              readOnly
              value={qrData.qr.token}
              className="mt-2 h-40 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700"
            />
          </div>
        </div>
      ) : null}
    </section>
  )
}

export default AdminQrCodePage
