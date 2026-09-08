const {
  TENANT_OVERTIME_POLICY_SELECT,
  resolveMinOvertimeMinutes,
} = require('../../src/utils/tenantOvertimePolicy');

describe('TENANT_OVERTIME_POLICY_SELECT', () => {
  // Asercao de FORMA. O mock do Prisma e um jest.fn() e ignora `select`, entao
  // nenhum teste de comportamento pega um call site que esqueceu o campo — foi
  // exatamente assim que o clock-out ficou sem o limiar.
  it('pede o limiar pela relacao do dono da organizacao', () => {
    expect(TENANT_OVERTIME_POLICY_SELECT).toEqual({
      organizationAdmin: { select: { overtimeMinMinutes: true } },
    });
  });
});

describe('resolveMinOvertimeMinutes', () => {
  it('devolve o limiar do dono da organizacao', () => {
    expect(resolveMinOvertimeMinutes({ organizationAdmin: { overtimeMinMinutes: 10 } })).toBe(10);
  });

  it('devolve null quando o limiar esta desligado', () => {
    expect(resolveMinOvertimeMinutes({ organizationAdmin: { overtimeMinMinutes: null } })).toBeNull();
  });

  it('devolve null para base legada sem dono de organizacao', () => {
    expect(resolveMinOvertimeMinutes({ organizationAdmin: null })).toBeNull();
    expect(resolveMinOvertimeMinutes({})).toBeNull();
    expect(resolveMinOvertimeMinutes(null)).toBeNull();
    expect(resolveMinOvertimeMinutes(undefined)).toBeNull();
  });

  it('preserva o zero como desligado, sem virar null surpresa', () => {
    // 0 e "sem limiar" tanto quanto null; quem consome passa isso para
    // applyMinOvertimeMinutes, que trata <= 0 como desligado.
    expect(resolveMinOvertimeMinutes({ organizationAdmin: { overtimeMinMinutes: 0 } })).toBe(0);
  });
});
