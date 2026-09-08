// Todo `pattern` anunciado no inputSchema do catalogo MCP tem de ser um regex
// que realmente casa o formato que a descricao promete.
//
// O bug que isto trava: _shared.js declarava o pattern de data como
// '^\d{4}-\d{2}-\d{2}$' entre aspas SIMPLES. \d nao e uma sequencia de escape
// valida em JS, entao colapsava para 'd' e o schema anunciado virava
// ^d{4}-d{2}-d{2}$ — um regex que casa a letra d literal e REJEITA qualquer
// data real em cliente que valide o inputSchema. Ficou assim nas 11 tools que
// declaram data, enquanto approvals.js e users.js escreviam '\\d' e estavam
// certos: o erro era invisivel porque cada arquivo parecia razoavel sozinho.
//
// Nao basta comparar a string com a esperada: a asercao aqui EXECUTA o regex
// contra exemplos, que e o unico jeito de pegar a proxima variante do mesmo
// engano (uma barra a menos, um escape a mais).

const mockPrisma = require('../mocks/prisma.mock');

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

const { TOOLS } = require('../../src/mcp/catalog');

// Exemplo que DEVE casar e exemplo que NAO deve, por formato prometido.
const EXEMPLOS = [
  { formato: 'YYYY-MM-DD', casa: '2026-08-31', naoCasa: ['31/08/2026', 'dddd-dd-dd', '2026-8-31'] },
  { formato: 'HH:MM', casa: '08:30', naoCasa: ['8:30', 'dd:dd', '0830'] },
  { formato: '4 digitos', casa: '1234', naoCasa: ['12a4', 'dddd', '123'] },
];

const acharExemplo = (pattern) =>
  EXEMPLOS.find((e) => new RegExp(pattern).test(e.casa));

const camposComPattern = () => {
  const encontrados = [];
  TOOLS.forEach((tool) => {
    const props = tool.inputSchema?.properties || {};
    Object.entries(props).forEach(([campo, schema]) => {
      if (schema && typeof schema.pattern === 'string') {
        encontrados.push({ tool: tool.name, campo, pattern: schema.pattern });
      }
    });
  });
  return encontrados;
};

describe('patterns do inputSchema do catalogo MCP', () => {
  it('o catalogo realmente declara patterns (senao o teste passaria vazio)', () => {
    expect(camposComPattern().length).toBeGreaterThan(10);
  });

  it('nenhum pattern contem uma classe de digito colapsada', () => {
    // A assinatura exata do bug: 'd{' onde deveria haver '\d{'. Barato, direto,
    // e nomeia o campo culpado em vez de falhar num agregado.
    const quebrados = camposComPattern().filter(({ pattern }) =>
      /(^|[^\\])d\{/.test(pattern)
    );

    expect(quebrados).toEqual([]);
  });

  it('todo pattern casa um exemplo valido do formato que promete', () => {
    const semExemplo = camposComPattern().filter(({ pattern }) => !acharExemplo(pattern));

    // Se cair aqui, ou o pattern esta quebrado, ou o catalogo passou a declarar
    // um formato novo e EXEMPLOS precisa ganhar uma linha.
    expect(semExemplo).toEqual([]);
  });

  it('todo pattern rejeita o que nao e do formato', () => {
    const permissivos = [];

    camposComPattern().forEach(({ tool, campo, pattern }) => {
      const exemplo = acharExemplo(pattern);
      if (!exemplo) return;

      const re = new RegExp(pattern);
      exemplo.naoCasa.forEach((ruim) => {
        if (re.test(ruim)) permissivos.push({ tool, campo, pattern, aceitou: ruim });
      });
    });

    expect(permissivos).toEqual([]);
  });

  it('a data continua sendo YYYY-MM-DD nas tools que a declaram', () => {
    const camposDeData = camposComPattern().filter(({ campo }) =>
      /date|Date/.test(campo)
    );

    expect(camposDeData.length).toBeGreaterThan(0);
    camposDeData.forEach(({ pattern }) => {
      const re = new RegExp(pattern);
      expect(re.test('2026-08-31')).toBe(true);
      expect(re.test('dddd-dd-dd')).toBe(false);
    });
  });
});
