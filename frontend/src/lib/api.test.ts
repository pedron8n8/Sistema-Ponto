import { describe, expect, it } from 'vitest'
import { translateApiMessage } from './api'
import { MIN_PASSWORD_LENGTH } from './passwordPolicy'

// i18next nao esta inicializado no ambiente de teste, entao resolvedLanguage e
// vazio e translateApiMessage segue o caminho em ingles, que e o que interessa
// aqui: e nele que as regras PT->EN sao aplicadas.

describe('translateApiMessage: mensagens de senha do backend', () => {
  // As tres frases vem de validateStrongPassword em
  // backend/src/controllers/user.controller.js:188-208.
  it('traduz a recusa por tamanho com o limite real', () => {
    expect(translateApiMessage({ message: 'Senha deve ter no minimo 12 caracteres' })).toBe(
      `Password must have at least ${MIN_PASSWORD_LENGTH} characters.`
    )
  })

  it('traduz a recusa por complexidade sem cair na regra de tamanho', () => {
    expect(
      translateApiMessage({
        message: 'Senha deve conter letra maiuscula, letra minuscula, numero e caractere especial',
      })
    ).toBe('Password must include uppercase, lowercase, number and special character.')
  })

  it('traduz a recusa da denylist', () => {
    expect(translateApiMessage({ message: 'Senha muito fraca. Escolha uma senha mais robusta' })).toBe(
      'Password is too weak. Choose a stronger one.'
    )
  })

  it('traduz senha obrigatoria', () => {
    expect(translateApiMessage({ message: 'Senha e obrigatoria' })).toBe('Password is required.')
  })

  it('nao promete mais 6 caracteres em lugar nenhum', () => {
    const messages = [
      'Senha deve ter no minimo 12 caracteres',
      'Senha deve ter pelo menos 12 caracteres',
      'Senha deve conter letra maiuscula, letra minuscula, numero e caractere especial',
      'Senha muito fraca. Escolha uma senha mais robusta',
    ]
    for (const message of messages) {
      expect(translateApiMessage({ message })).not.toContain('6 characters')
    }
  })
})
