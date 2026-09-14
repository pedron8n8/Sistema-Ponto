// Aritmetica de pagamento de um TimeEntry, compartilhada por clock-out (time.controller),
// pagina de custo (report.controller) e export em XLSX (reportWorker).
//
// A formula de UM ENTRY e sempre a mesma: regular = trabalhado - HE50 - HE100, depois
// regular * rate + HE50 * rate * 1.5 + HE100 * rate * 2. O que muda entre as duas
// telas de relatorio e QUAIS minutos de HE entram na conta do adicional — e essa
// diferenca e uma escolha deliberada, nao um bug:
//
//   - resolveIncurredOvertime: TODA a HE registrada, decidida ou nao. Responde
//     "quanto esse dia custou" (pior caso, para orcamento) — usado pela pagina de custo.
//   - resolveSettledOvertime: só a HE com overtimeStatus === 'APPROVED'. Responde
//     "quanto e pagavel agora" — usado pelo export em XLSX.
//
// Em qualquer entry, incurred = settled + pending (a HE ainda aguardando decisao).
// Se um dia alguem "unificar" essas duas politicas em uma so, essa pessoa esta
// apagando uma das duas perguntas que este modulo responde — nao corrigindo uma
// duplicacao.
//
// O QUE E PAGAVEL (nivel DIA, nao entry): minutos normais pagos num dia sao
// min(trabalhado do dia inteiro, contractDailyMinutes) — nunca o trabalhado bruto.
// Minutos acima do contrato que NAO viraram HE aprovada (tolerancia engoliu, HE
// ainda pendente, ou HE negada) simplesmente nao sao pagos — nem como normal, nem
// como adicional. Esse teto e por PESSOA-DIA: tem que ser aplicado depois de somar
// todos os entries daquele dia, nunca entry por entry (um dia partido em dois
// entries de 300 e 240min com contrato 480 paga min(540,480)=480, nao 300+240).
// calculateDayPaymentRaw concentra essa regra; calculateEntryPaymentRaw continua
// existindo tal como antes para quem precisa do valor de UM entry isolado (o
// clock-out nunca soma dias, so mostra o proprio entry).
//
// Arredondamento: calculateEntryPaymentRaw NAO arredonda nada — devolve os
// valores exatos em ponto flutuante. calculateEntryPayment arredonda por cima
// dela para 2 casas, e e a forma certa para um valor que sai sozinho (a
// resposta do clock-out, uma linha de export). Quem SOMA o pagamento de varios
// entries de um mesmo usuario (relatorio de custo, resumo do export) deve
// somar os valores RAW e arredondar uma unica vez no final — exatamente como o
// codigo original fazia — para nao acumular 1-2 centavos de erro por causa de
// arredondar entry por entry antes de somar. calculateDayPaymentRaw segue a
// mesma convencao: recebe minutos ja somados do dia (RAW) e devolve valores RAW.
const calculateEntryPaymentRaw = ({ workedMinutes, overtimeMinutes50, overtimeMinutes100, hourlyRate }) => {
  const rate = Number(hourlyRate || 0);
  if (!Number.isFinite(rate) || rate <= 0) {
    return {
      hourlyRate: 0,
      regularAmount: 0,
      overtime50Amount: 0,
      overtime100Amount: 0,
      overtimeTotalAmount: 0,
      totalAmount: 0,
    };
  }

  const regularMinutes = Math.max(0, workedMinutes - overtimeMinutes50 - overtimeMinutes100);
  const regularAmount = (regularMinutes / 60) * rate;
  const overtime50Amount = (overtimeMinutes50 / 60) * rate * 1.5;
  const overtime100Amount = (overtimeMinutes100 / 60) * rate * 2;
  const overtimeTotalAmount = overtime50Amount + overtime100Amount;
  const totalAmount = regularAmount + overtimeTotalAmount;

  return {
    hourlyRate: rate,
    regularAmount,
    overtime50Amount,
    overtime100Amount,
    overtimeTotalAmount,
    totalAmount,
  };
};

const roundMoney = (value) => (Number.isFinite(value) ? Number(value.toFixed(2)) : 0);

// Wrapper fino de arredondamento sobre calculateEntryPaymentRaw. Forma e valores
// identicos ao antigo calculateFinancialSummary — e o que a resposta do
// clock-out e qualquer outro consumidor de UM valor isolado devem usar.
const calculateEntryPayment = (args) => {
  const raw = calculateEntryPaymentRaw(args);
  return {
    hourlyRate: roundMoney(raw.hourlyRate),
    regularAmount: roundMoney(raw.regularAmount),
    overtime50Amount: roundMoney(raw.overtime50Amount),
    overtime100Amount: roundMoney(raw.overtime100Amount),
    overtimeTotalAmount: roundMoney(raw.overtimeTotalAmount),
    totalAmount: roundMoney(raw.totalAmount),
  };
};

// Teto contratual do DIA (nao do entry). `normalMinutes` chega ja somado de todos
// os entries do dia daquela pessoa e ja excluindo HE (tipicamente trabalhado -
// HE incorrida, a mesma exclusao que resolveRegularMinutes/resolveIncurredOvertime
// fazem por entry) — esta funcao so aplica o teto e precifica, nao decide o que
// conta como "normal". `overtimeMinutes50/100` sao a HE que este chamado quer
// precificar como adicional (settled para "pagavel agora", incurred para "custo
// pior caso") — quem decide qual HE entra aqui e o chamador, exatamente como no
// nivel de entry.
const calculateDayPaymentRaw = ({
  normalMinutes,
  overtimeMinutes50,
  overtimeMinutes100,
  contractDailyMinutes,
  hourlyRate,
}) => {
  const rate = Number(hourlyRate || 0);
  if (!Number.isFinite(rate) || rate <= 0) {
    return {
      hourlyRate: 0,
      regularMinutes: 0,
      regularAmount: 0,
      overtime50Amount: 0,
      overtime100Amount: 0,
      overtimeTotalAmount: 0,
      totalAmount: 0,
    };
  }

  const rawNormalMinutes = Math.max(0, Number(normalMinutes) || 0);
  const contract = Math.max(0, Number(contractDailyMinutes) || 0);
  const ot50 = Math.max(0, Number(overtimeMinutes50) || 0);
  const ot100 = Math.max(0, Number(overtimeMinutes100) || 0);

  // O teto: acima do contrato so e pago o que virou HE aprovada (adicional,
  // somado abaixo); o resto do "normal" acima do contrato nao e pago.
  const regularMinutes = Math.min(rawNormalMinutes, contract);
  const regularAmount = (regularMinutes / 60) * rate;
  const overtime50Amount = (ot50 / 60) * rate * 1.5;
  const overtime100Amount = (ot100 / 60) * rate * 2;
  const overtimeTotalAmount = overtime50Amount + overtime100Amount;
  const totalAmount = regularAmount + overtimeTotalAmount;

  return {
    hourlyRate: rate,
    regularMinutes,
    regularAmount,
    overtime50Amount,
    overtime100Amount,
    overtimeTotalAmount,
    totalAmount,
  };
};

// HE ja liquidada para pagamento: só conta quando a decisao foi APPROVED.
// overtimeStatus null/undefined (sem HE a decidir) ou PENDING/REJECTED => zero.
const resolveSettledOvertime = (entry) => {
  if (entry?.overtimeStatus !== 'APPROVED') {
    return { overtimeMinutes50: 0, overtimeMinutes100: 0 };
  }
  return {
    overtimeMinutes50: Math.max(0, Number(entry.overtimeMinutes50) || 0),
    overtimeMinutes100: Math.max(0, Number(entry.overtimeMinutes100) || 0),
  };
};

// Toda a HE registrada no entry, decidida ou nao — usada para saber o custo total,
// pior caso, independente do status de aprovacao.
const resolveIncurredOvertime = (entry) => ({
  overtimeMinutes50: Math.max(0, Number(entry?.overtimeMinutes50) || 0),
  overtimeMinutes100: Math.max(0, Number(entry?.overtimeMinutes100) || 0),
});

module.exports = {
  calculateEntryPayment,
  calculateEntryPaymentRaw,
  calculateDayPaymentRaw,
  resolveSettledOvertime,
  resolveIncurredOvertime,
};
