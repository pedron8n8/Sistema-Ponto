// Aritmetica de pagamento de um TimeEntry, compartilhada por clock-out (time.controller),
// pagina de custo (report.controller) e export em XLSX (reportWorker).
//
// A formula e sempre a mesma: regular = trabalhado - HE50 - HE100, depois
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

const calculateEntryPayment = ({ workedMinutes, overtimeMinutes50, overtimeMinutes100, hourlyRate }) => {
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
    hourlyRate: Number(rate.toFixed(2)),
    regularAmount: Number(regularAmount.toFixed(2)),
    overtime50Amount: Number(overtime50Amount.toFixed(2)),
    overtime100Amount: Number(overtime100Amount.toFixed(2)),
    overtimeTotalAmount: Number(overtimeTotalAmount.toFixed(2)),
    totalAmount: Number(totalAmount.toFixed(2)),
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
  resolveSettledOvertime,
  resolveIncurredOvertime,
};
