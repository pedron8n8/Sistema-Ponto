import { describe, expect, it } from 'vitest'

import { validateStrongPassword } from './passwordPolicy'

// A politica vive no backend (validateStrongPassword em user.controller.js).
// Estes casos sao o espelho dela: se o backend endurecer e este arquivo nao
// acompanhar, o formulario volta a deixar o usuario submeter para levar 400.
describe('validateStrongPassword', () => {
  it('rejeita senha curta que o backend recusaria com 400', () => {
    expect(validateStrongPassword('teste123')).toBeTruthy()
    expect(validateStrongPassword('Teste@12345')).toBeTruthy()
  })

  it('rejeita senha longa sem os quatro tipos de caractere', () => {
    expect(validateStrongPassword('senhasenhasenha')).toBeTruthy()
    expect(validateStrongPassword('SENHASENHASENHA1')).toBeTruthy()
    expect(validateStrongPassword('Senhasenhasenha1')).toBeTruthy()
  })

  it('rejeita as senhas da denylist do backend, mesmo com tamanho suficiente', () => {
    expect(validateStrongPassword('teste@123456')).toBeTruthy()
    expect(validateStrongPassword('Teste@123456')).toBeTruthy()
  })

  it('aceita senha que satisfaz tamanho, complexidade e denylist', () => {
    expect(validateStrongPassword('Colaborador#2026')).toBeNull()
  })

  it('trata ausencia de senha como invalida em vez de estourar', () => {
    expect(validateStrongPassword('')).toBeTruthy()
    expect(validateStrongPassword(undefined as unknown as string)).toBeTruthy()
  })
})
