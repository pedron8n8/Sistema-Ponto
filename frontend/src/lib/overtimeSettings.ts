import { apiFetch } from './api'

// Contrato de GET/PATCH /admin/overtime-settings, compartilhado pelas duas
// telas que gravam a mesma tolerancia (AdminDashboard e AdminBankHoursPage).
export type OvertimeSettings = { bufferMinutes: number }

export const OVERTIME_BUFFER_MAX = 120
// O backend aplica 15 quando a conta nunca configurou nada; 0 desliga.
export const OVERTIME_BUFFER_DEFAULT = 15

// Campo vazio vira Number('') === 0: sem esta checagem, limpar o campo e
// salvar zerava a tolerancia da empresa em vez de mostrar o erro. Mesma faixa
// que o servidor recusa com 400: o campo avisa antes de gastar uma ida ao
// servidor, mas quem manda continua sendo o backend.
export const parseBufferMinutes = (raw: string): number | null => {
  const trimmed = raw.trim()
  const parsed = Number(trimmed)
  if (!trimmed || !Number.isInteger(parsed) || parsed < 0 || parsed > OVERTIME_BUFFER_MAX) return null
  return parsed
}

export const fetchOvertimeSettings = async (token: string) => {
  const response = await apiFetch<{ overtimeSettings?: OvertimeSettings }>('/admin/overtime-settings', { token })
  return response.overtimeSettings?.bufferMinutes ?? OVERTIME_BUFFER_DEFAULT
}

// skipIdempotency: salvar o mesmo valor duas vezes no mesmo dia voltaria 202
// sem overtimeSettings no corpo, e a tela leria undefined.
export const saveOvertimeSettings = (token: string, bufferMinutes: number) =>
  apiFetch<{ overtimeSettings: OvertimeSettings; message?: string }>('/admin/overtime-settings', {
    token,
    method: 'PATCH',
    body: { bufferMinutes },
    skipIdempotency: true,
  })
