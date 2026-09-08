// Como se BUSCA e se resolve o limiar de hora extra curta do tenant.
//
// Vive fora de utils/overtime.js de proposito: overtime.js e aritmetica pura e
// nao sabe o que e Prisma. Misturar um fragmento de query nele daria duas
// responsabilidades ao arquivo.
//
// O que quebrou antes nao foi a conta, foi cada call site escrever seu proprio
// `select` e esquecer o campo: o clock-out — o UNICO caminho que persiste hora
// extra e estampa overtimeStatus — nao trazia overtimeMinMinutes, entao gravava
// 6min de HE num tenant com limiar de 10min e a marcava como PENDING. E HE
// pendente BLOQUEIA a aprovacao do ponto, que era exatamente o que o limiar
// existia para evitar.
//
// Fragmento unico resolve isso na raiz: quem faz a query espalha a constante e
// nao tem como esquecer o campo.
const TENANT_OVERTIME_POLICY_SELECT = {
  organizationAdmin: { select: { overtimeMinMinutes: true } },
};

// Recebe a LINHA do colaborador (com a relacao organizationAdmin carregada),
// nao um escalar: e o que permite ao call site passar `userConfig` direto e nao
// ter que saber por onde o limiar chega.
//
// Colaborador sem dono de organizacao (base legada) simplesmente nao tem
// limiar — o comportamento volta a ser o de antes, sem limiar nenhum. O zero
// atravessa como zero em vez de virar null porque quem consome
// (applyMinOvertimeMinutes) ja trata <= 0 como desligado, e converter aqui
// esconderia a diferenca entre "configurado como 0" e "nunca configurado".
const resolveMinOvertimeMinutes = (userRow) =>
  userRow?.organizationAdmin?.overtimeMinMinutes ?? null;

module.exports = { TENANT_OVERTIME_POLICY_SELECT, resolveMinOvertimeMinutes };
