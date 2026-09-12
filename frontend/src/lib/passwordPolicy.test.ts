import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { MIN_PASSWORD_LENGTH, validateStrongPassword } from './passwordPolicy'

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

describe('contrato com o backend', () => {
  // passwordPolicy.ts e um espelho manual de validateStrongPassword no
  // servidor. Este teste e o que avisa quando os dois divergem: sem ele, mudar
  // a regra no backend volta a produzir 400 sem explicacao na tela.
  const backendSource = readFileSync(
    fileURLToPath(new URL('../../../backend/src/controllers/user.controller.js', import.meta.url)),
    'utf8'
  )

  it('usa o mesmo tamanho minimo que o servidor exige', () => {
    const match = backendSource.match(/normalizedPassword\.length\s*<\s*(\d+)/)
    expect(match, 'nao achei a checagem de tamanho em user.controller.js').toBeTruthy()
    expect(Number(match![1])).toBe(MIN_PASSWORD_LENGTH)
  })

  it('reprova exatamente as mesmas senhas da denylist do servidor', () => {
    const block = backendSource.match(/const WEAK_PASSWORD_DENYLIST = new Set\(\[([\s\S]*?)\]\)/)
    expect(block, 'nao achei WEAK_PASSWORD_DENYLIST em user.controller.js').toBeTruthy()
    const backendDenylist = Array.from(block![1].matchAll(/'([^']+)'/g)).map((entry) => entry[1])
    expect(backendDenylist.length).toBeGreaterThan(0)

    // Cada senha da denylist do servidor tem de ser recusada aqui tambem, e o
    // motivo tem de ser a denylist, nao tamanho ou complexidade.
    for (const weak of backendDenylist) {
      expect(validateStrongPassword(weak), `${weak} passou no validador do front`).toBeTruthy()
    }
  })

  it('checa na mesma ordem do servidor: tamanho, complexidade, denylist', () => {
    // Documentando o que a ordem implica hoje, nos dois lados: a denylist e a
    // ultima checagem e nenhuma das 7 entradas atuais chega nela — todas caem
    // antes, por tamanho ou complexidade. Ela so passa a valer para alguma
    // entrada futura que satisfaca as duas primeiras regras.
    expect(validateStrongPassword('teste@123456')).toMatch(/mai[uú]scula|uppercase/i)
    expect(validateStrongPassword('Password')).toMatch(/12|caracteres|characters/i)
  })

  it('aceita uma senha fora da denylist que satisfaca as duas primeiras regras', () => {
    expect(validateStrongPassword('Teste@1234567')).toBeNull()
  })

  it('aceita o que o servidor aceita', () => {
    expect(validateStrongPassword('Chuva#Azul2026')).toBeNull()
  })
})
