import i18next from 'i18next'

const isPortugueseLanguage = () => {
  const language = String(i18next.resolvedLanguage || i18next.language || '').toLowerCase()
  return language.startsWith('pt')
}

const localizeMessage = (en: string, pt: string) => (isPortugueseLanguage() ? pt : en)

export const MIN_PASSWORD_LENGTH = 12

// Espelho de WEAK_PASSWORD_DENYLIST em backend/src/controllers/user.controller.js.
// Sem ela o formulario deixa passar 'teste@123456' — que tem tamanho e
// complexidade suficientes e ainda assim volta 400 do servidor.
const WEAK_PASSWORD_DENYLIST = new Set([
  '123456',
  '12345678',
  'password',
  'qwerty',
  'admin',
  'admin123',
  'teste@123456',
])

/**
 * Mesma politica que o backend aplica em POST /users, PATCH /users/:id e no
 * cadastro. Validar antes de submeter e o que evita que o unico sinal da regra
 * seja um 400 no console.
 */
export const validateStrongPassword = (password: string) => {
  const normalized = String(password || '')

  if (normalized.length < MIN_PASSWORD_LENGTH) {
    return localizeMessage(
      `Password must have at least ${MIN_PASSWORD_LENGTH} characters.`,
      `Senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`
    )
  }

  const hasUppercase = /[A-Z]/.test(normalized)
  const hasLowercase = /[a-z]/.test(normalized)
  const hasDigit = /\d/.test(normalized)
  const hasSpecial = /[^A-Za-z0-9]/.test(normalized)

  if (!hasUppercase || !hasLowercase || !hasDigit || !hasSpecial) {
    return localizeMessage(
      'Password must include uppercase, lowercase, number and special character.',
      'Senha deve conter letra maiuscula, minuscula, numero e caractere especial.'
    )
  }

  if (WEAK_PASSWORD_DENYLIST.has(normalized.toLowerCase())) {
    return localizeMessage(
      'Password is too weak. Choose a stronger one.',
      'Senha muito fraca. Escolha uma senha mais robusta.'
    )
  }

  return null
}

/**
 * Texto de apoio para o campo de senha, para a regra aparecer antes do erro.
 */
export const passwordPolicyHint = () =>
  localizeMessage(
    `At least ${MIN_PASSWORD_LENGTH} characters, with uppercase, lowercase, number and special character.`,
    `Minimo ${MIN_PASSWORD_LENGTH} caracteres, com maiuscula, minuscula, numero e caractere especial.`
  )
