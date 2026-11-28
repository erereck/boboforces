/**
 * M12 (fase 7b): as constantes dos bots em grupo (`group.ts`, `zombie.ts`, `orders.ts`) e da comemoração do Palhaço
 * (`persona.ts`). Num arquivo à parte do `config.ts` (a frente 7a mexia nele ao mesmo tempo); a integração pode juntar.
 *
 * - **Quem segue um líder** (o Vem comigo e o Me cobre das ordens, o Suporte com o humano dele) vai a uma VAGA atrás
 *   dele: "atrás" pelo rumo do líder (`AiContext.heading`: gira até o do movimento ou, parado há `headingSettleS`, até o
 *   yaw dele), a vaga pela ordem do seguidor entre os que seguem o mesmo líder (±40° e ±80° a partir das costas, a
 *   `slotM`; do 5º em diante, uma volta mais longe). Parado na vaga, o seguidor olha para fora: o yaw do líder + o
 *   setor da vaga (vigia as costas e os lados).
 * - **Os zumbis cercam:** a menos de `AI_ZOMBIE.directM` o zumbi vai a uma vaga do anel de `zombieRingM` em volta do
 *   alvo, no ângulo de onde veio + ((índice % 5) − 2)·`zombieRingStepRad`.
 * - **O Me cobre** prefere os inimigos que atacaram quem mandou (ou o próprio bot) nos últimos `coverAttackerS`.
 */
export const AI_GROUP = {
  /** O rumo do líder: andando acima disto (m/s) gira até o do movimento. */
  headingSpeed: 1.5,
  /**
   * Revisão: parado há isto (s), o rumo gira até o yaw do líder (quem entra, para e vira para a porta tem as vagas atrás
   * de si, não entre ele e a porta); o rumo gira no máximo `headingTurnDegPerS` (o A/D não troca o lado das vagas).
   */
  headingSettleS: 0.5,
  headingTurnDegPerS: 180,
  /** As vagas (graus a partir das costas do rumo), na ordem dos seguidores, e a distância delas ao líder (m). */
  slotDeg: [40, -40, 80, -80],
  slotM: 2.5,
  /** Me cobre: as vagas mais coladas (m). */
  coverSlotM: 1.6,
  /** Do 5º seguidor em diante, uma volta mais longe (m a mais por volta). */
  ringStepM: 1.5,
  /** Chegou na vaga (m, no plano); parado, volta a andar quando a vaga se afasta mais que `slotLeaveM`. */
  slotArriveM: 0.8,
  slotLeaveM: 2,
  /** Mais longe que isto na altura (m), o líder está em outro andar: segue andando. */
  sameFloorM: 1.5,
  /**
   * A vaga fica a isto (m, no raio) de uma parede atrás do líder, num nó da navegação a até `slotFloorM` do piso dele
   * (o do último tick no chão) e à vista dele.
   */
  slotWallM: 0.8,
  slotFloorM: 0.6,
  /** Parado na vaga, a varredura do olhar (± graus) e o ritmo dela (rad/s). */
  watchSweepDeg: 20,
  watchSweepRate: 0.9,
  /** Quem não seguiu ninguém nos últimos (s) sai da conta das vagas. */
  followStaleS: 1,
  /** Me cobre: os inimigos que feriram quem mandou nos últimos (s); quantos o bot lembra por corpo. */
  coverAttackerS: 3,
  coverAttackers: 3,
  /** Me cobre (revisão): troca de atacante só se o outro estiver a menos desta fração da distância do atual. */
  coverSwitchFrac: 0.7,
  /** Zumbis: o anel (m) e o passo entre vagas (rad); vagas por volta (o índice do zumbi % isto − a metade). */
  zombieRingM: 0.9,
  zombieRingStepRad: 0.45,
  zombieRingSlots: 5,
  /** O zumbi troca o ângulo de chegada quando o alvo passa para o outro lado (mais que isto, rad). */
  zombieRelatchRad: Math.PI / 2,
  /**
   * Perto da vaga (m), o zumbi desacelera (sem tremer em volta dela), só com o alvo abaixo de `zombieEaseTargetMps`
   * (revisão: freando atrás de quem recua, o zumbi ficava 1,07–1,2 m atrás, fora do `attackM`, e não golpeava).
   */
  zombieSlotEaseM: 0.3,
  zombieEaseTargetMps: 0.5,
} as const;

/**
 * M12 (fase 7b): a comemoração do Palhaço (era uma dancinha de 1,5 s que girava, agachava várias vezes e pulava, e
 * passava na frente do combate).
 */
export const AI_CELEBRATE = {
  /** A chance depois do abate: bobeira · isto. */
  chanceMul: 0.5,
  /** Quanto dura (s): o giro dá uma volta nesse tempo; o pulinho sai no começo. */
  seconds: 0.4,
} as const;
