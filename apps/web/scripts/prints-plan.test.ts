import {
  BENCH_ROUTES,
  CONTENT_IDS,
  FACE_EXPRESSIONS,
  FIGURE_BOT_ROTATION,
  FIGURE_PITCH_SAMPLES,
  OPTIONAL_MANNEQUINS,
  OPTIONAL_PRINT_CAMERAS,
  PLAYABLE_PROP_DOSE_VIEW,
  PRINT_CAMERAS,
  REQUIRED_MANNEQUINS,
  TIMES_OF_DAY,
  type MapMannequin,
  type PropDoseView,
  type TimeOfDay,
} from '@boboforces/format';
import { BENCH_PARAMS, type GameDebugApi } from '@boboforces/game';
import type { MipFilterMode } from '@boboforces/render';
import { createRenderDebug } from '@boboforces/render/data';
import { describe, expect, it } from 'vitest';
import { urlAsksForSwitchTitle } from '../src/title-preview.ts';
import { parseArgs, stamp } from './args.ts';
import type { PageDebugApi } from './edge.ts';
import { FAKE_CAMERAS, fakePrintsPage } from './prints-fake.ts';
import {
  buildPrintPlan,
  CLIP_DT_S,
  contactSheetHtml,
  COPY_VARIANTS,
  copyCommand,
  copyPlan,
  EXPRESSION_LABELS,
  fakeTag,
  FIGURE_CLIPS,
  FIGURE_HOOK_MEMBERS,
  FILA_LOOKS,
  filterPlan,
  inRound,
  PRINT_BASE,
  PRINT_SETS,
  printDirName,
  PRINTS_LOADING_PARAM,
  printsQuery,
  questionsFor,
  READING_ATLAS_DISTANCE_M,
  READING_DISTANCES_M,
  REQUESTED_CAMERAS,
  ROUND3_NOTES,
  ROUND3_QUESTIONS,
  ROUND4_NOTES,
  ROUND4_QUESTIONS,
  ROUND5_NOTES,
  ROUND5_QUESTIONS,
  roundsWithQuestions,
  TROPA_NO_TEAM,
  runOrder,
  SEQUENCE_FRAMES,
  shotNeeds,
  shotQuery,
  SWITCH_TITLE_QUERY,
  WALK_FRAMES,
  type FigurePrintHook,
  type MannequinOverride,
  type MannequinPose,
  type PrintMipFilter,
  type PrintPropDose,
  type PrintShot,
  type PrintTimeOfDay,
  type SceneShot,
  type ShotResult,
} from './prints-plan.ts';

// Os tipos locais do roteiro são os mesmos do contrato (se o format mudar, isto deixa de compilar).
const sameTime: TimeOfDay extends PrintTimeOfDay ? (PrintTimeOfDay extends TimeOfDay ? true : false) : false = true;
const sameDose: PropDoseView extends PrintPropDose ? (PrintPropDose extends PropDoseView ? true : false) : false = true;
const sameMip: MipFilterMode extends PrintMipFilter ? (PrintMipFilter extends MipFilterMode ? true : false) : false =
  true;
type MapPose = MapMannequin['pose'];
const samePose: MapPose extends MannequinPose ? (MannequinPose extends MapPose ? true : false) : false = true;

// O gancho como os scripts o enxergam (`edge.ts`) tem os mesmos membros do contrato `GameDebugApi`: nenhum a mais
// (o script chamaria algo que não existe) nem a menos (o contrato cresceu e o roteiro não sabe). Os membros do gancho
// novo da rodada 3 (`FigurePrintHook`, pedido à integração) ficam de fora dessa conta: o `prints.ts` os detecta.
type CoreMembers = Exclude<keyof GameDebugApi, keyof FigurePrintHook>;
const hookFromContract: PageDebugApi = null as unknown as GameDebugApi;
const noMissingMember: Exclude<CoreMembers, keyof PageDebugApi> extends never ? true : false = true;
/** Quando o game tiver os membros do gancho novo, a assinatura tem de ser a pedida. */
type ContractFigureHook = Pick<GameDebugApi, Extract<keyof GameDebugApi, keyof FigurePrintHook>>;
const figureHookMatches: FigurePrintHook extends ContractFigureHook ? true : false = true;
/** Os membros do contrato, um por um (o `satisfies` reprova o que faltar ou sobrar). */
const GAME_DEBUG_MEMBERS = {
  readyForPrint: true,
  cameras: true,
  setCamera: true,
  setTimeOfDay: true,
  setPropDose: true,
  setGrayscale: true,
  setMipFilter: true,
  setHudVisible: true,
  setViewmodelVisible: true,
  showResult: true,
  setFrozen: true,
  showFontSpecimen: true,
  whenReady: true,
} as const satisfies Record<CoreMembers, true>;

const scenes = (plan: readonly PrintShot[]): SceneShot[] => plan.filter((p): p is SceneShot => p.page === 'scene');
const main = (plan: readonly PrintShot[]): PrintShot[] => plan.filter((p) => p.copy === null);
const names = (list: readonly MannequinOverride[]): string[] => list.map((m) => m.name);

describe('roteiro dos prints', () => {
  const plan = buildPrintPlan();

  it('cobre as duas rodadas, com nomes únicos e legíveis', () => {
    expect(sameTime && sameDose && sameMip && samePose && noMissingMember && hookFromContract === null).toBe(true);
    expect(figureHookMatches).toBe(true);
    expect(PRINT_SETS.map((s) => `${s.number}-${s.id}`)).toEqual([
      '1-hora',
      '2-densidade',
      '4-leitura',
      '6-fontes',
      '7-altura',
      '8-titulo',
      '9-setores',
      '10-regua',
      '11-fila',
      '12-close',
      '13-vitrine',
      '14-zumbi',
      '15-mira',
      '16-sequencia',
      '17-andar',
      '18-bots',
      '19-tropa',
      '20-farda',
      '21-patio',
      '22-infectado',
      '23-arsenal',
      '24-empunhadura',
      '25-na-mao',
    ]);
    expect(new Set(plan.map((p) => p.set))).toEqual(new Set(PRINT_SETS.map((s) => s.id)));
    expect(new Set(plan.map((p) => p.file)).size).toBe(plan.length);
    for (const p of plan) {
      expect(p.file).toMatch(/^\d{1,2}-[a-z]+-[a-z0-9-]+-(1280x720|640x360)\.png$/);
      expect(p.file.startsWith(`${PRINT_SETS.find((s) => s.id === p.set)!.number}-${p.set}-${p.slug}`)).toBe(true);
    }
    // Escolhas: hora 6 + densidade 2 + leitura 8 + 1 no atlas + fontes 2 + HUD 2 + altura 2 + títulos 3 + setores 3.
    expect(filterPlan(plan, ['escolhas']).length).toBe(29);
    // Rodada 3 na árvore principal: régua 7 + fila 11 + close 4 + vitrine 1 + zumbi 2 + mira 6 + sequência 6 + andar 3
    // (40), mais a leitura (9) que as duas rodadas usam; e as 30 variantes da cópia, por último.
    const round3 = filterPlan(plan, ['rodada3']);
    expect(main(round3).length).toBe(40 + 9);
    expect(round3.filter((p) => p.copy !== null).length).toBe(30);
    // Rodada 4 (roupa militar, #58): tropa 7 + farda 3 + pátio 1 + zumbi 2 (13), mais a leitura (9); sem cópia.
    const round4 = filterPlan(plan, ['rodada4']);
    expect(round4.length).toBe(13 + 9);
    expect(round4.every((p) => p.copy === null)).toBe(true);
    // Rodada 5 (as armas do M2): arsenal 3 + empunhadura 3 + na mão 6 (12); sem cópia e sem a leitura.
    const round5 = filterPlan(plan, ['rodada5']);
    expect(round5.length).toBe(12);
    expect(round5.every((p) => p.copy === null)).toBe(true);
    expect(plan.length).toBe(29 + 40 + 13 + 12 + 30);
    const firstCopy = plan.findIndex((p) => p.copy !== null);
    expect(plan.slice(firstCopy).every((p) => p.copy !== null)).toBe(true);
  });

  it('(9) números de setor: o 9 visto do sul, o 6 visto do norte e o 4 e o 5, em 1280×720', () => {
    const setores = scenes(plan).filter((p) => p.set === 'setores');
    expect(setores.map((p) => `${p.settings.camera}@${p.width}`)).toEqual([
      'print:setores-norte@1280',
      'print:setores-sul@1280',
      'print:setores-4-5@1280',
    ]);
    expect(filterPlan(plan, ['setores'])).toHaveLength(3);
    expect(filterPlan(plan, ['9'])).toHaveLength(3);
  });

  it('saíram as doses, o mip, o contorno e a skin de densidade dobrada; as perguntas não falam do bobo A', () => {
    const files = plan.map((p) => p.file).join(' ');
    for (const gone of ['doses', 'mip', 'contorno', 'dobrada', 'candidatas']) expect(files).not.toContain(gone);
    for (const key of ['outline', 'outlinePx', 'skinDensity', 'fontCompare', 'fontCombo']) {
      expect(Object.keys(PRINT_BASE)).not.toContain(key);
    }
    expect(() => filterPlan(plan, ['doses'])).toThrow('conjunto de prints desconhecido');
    expect(() => filterPlan(plan, ['5'])).toThrow('conjunto de prints desconhecido');
    // Porte do boneco (#56): a pergunta da hora perde o "1,625 m" e a da densidade perde o grão.
    const text = PRINT_SETS.map((s) => s.question).join(' ');
    expect(text).not.toContain('1,625');
    expect(text).not.toMatch(/grão/);
    expect(PRINT_SETS.find((s) => s.id === 'hora')!.question).toContain('#56');
  });

  it('usa só câmeras nomeadas do contrato do mapa, as pedidas, ou a vista do jogador com HUD', () => {
    const known = new Set<string>([...PRINT_CAMERAS, ...OPTIONAL_PRINT_CAMERAS, ...REQUESTED_CAMERAS]);
    for (const p of scenes(plan)) {
      if (p.settings.camera === null) expect(p.settings.hud, p.file).toBe(true);
      else expect(known, p.file).toContain(p.settings.camera);
      if (inRound(p.set, 'escolhas') && p.settings.camera !== null) {
        expect(PRINT_CAMERAS as readonly string[], p.file).toContain(p.settings.camera);
      }
    }
    // A câmera pedida ainda não está no contrato (quando entrar, sai daqui).
    for (const c of REQUESTED_CAMERAS) {
      expect([...PRINT_CAMERAS, ...OPTIONAL_PRINT_CAMERAS] as string[]).not.toContain(c);
      expect(scenes(plan).some((p) => p.settings.camera === c)).toBe(true);
    }
    // As opcionais da fila e do close são todas usadas pela rodada 3.
    for (const c of OPTIONAL_PRINT_CAMERAS)
      expect(
        scenes(plan).some((p) => p.settings.camera === c),
        c,
      ).toBe(true);
    expect(FAKE_CAMERAS).toEqual([...PRINT_CAMERAS, ...BENCH_ROUTES]);
  });

  it('a cena mostra o jogo: dose do jogo (#52), mip padrão (#50), sem viewmodel e sem chave de depuração', () => {
    const debug = createRenderDebug();
    expect(PRINT_BASE.propDose).toBe(PLAYABLE_PROP_DOSE_VIEW);
    expect(PRINT_BASE.mipFilter).toBe(debug.mipFilter);
    expect(PRINT_BASE.grayscale).toBe(debug.grayscale);
    expect([PRINT_BASE.mannequins, PRINT_BASE.clip]).toEqual([[], null]);
    for (const p of scenes(plan)) {
      expect(p.settings.propDose).toBe(PLAYABLE_PROP_DOSE_VIEW);
      expect(p.settings.mipFilter).toBe('nearest');
      if (p.set !== 'leitura') expect(p.settings.grayscale).toBe(false);
      if (p.set !== 'hora') expect(p.settings.timeOfDay).toBe('day');
      if (p.set !== 'fontes' && p.set !== 'bots' && p.set !== 'na-mao')
        expect([p.settings.hud, p.settings.fontSpecimen]).toEqual([false, false]);
      // A arma na mão só aparece na rodada 5 (vista do jogador); o resto mostra a cena sem viewmodel.
      expect(p.settings.viewmodel, p.file).toBe(p.set === 'na-mao');
      if (!(p.set === 'leitura' && p.file.includes('atlas'))) expect(p.atlas).toBe(false);
      // Bots só na variante dos visuais dos bots (na árvore principal os prints têm 0 bots, §B16).
      if (p.set !== 'bots' && p.set !== 'na-mao') expect([p.bots, p.profile]).toEqual([0, null]);
      if (p.set !== 'na-mao') expect(p.weapons).toBe(null);
      if (inRound(p.set, 'escolhas')) expect([p.settings.mannequins, p.settings.clip]).toEqual([[], null]);
    }
  });

  it('(1) Dia, Entardecer e Noite em 1280×720 e 640×360, como regressão', () => {
    const hora = scenes(plan).filter((p) => p.set === 'hora');
    expect(hora.map((p) => `${p.settings.timeOfDay}@${p.width}`)).toEqual([
      'day@1280',
      'dusk@1280',
      'night@1280',
      'day@640',
      'dusk@640',
      'night@640',
    ]);
    expect(new Set(hora.map((p) => p.settings.timeOfDay))).toEqual(new Set(TIMES_OF_DAY));
    expect(PRINT_SETS.find((s) => s.id === 'hora')!.title).toContain('regressão');
  });

  it('(2) densidade só a 1 m e 3 m, com a skin normal', () => {
    const densidade = scenes(plan).filter((p) => p.set === 'densidade');
    expect(densidade.map((p) => `${p.settings.camera}@${p.width}`)).toEqual([
      'print:densidade-1m@1280',
      'print:densidade-3m@1280',
    ]);
  });

  it('(4) leitura só em 640×360 e sem contorno: 4 distâncias × cor e cinza, mais o de 50 m no atlas', () => {
    const leitura = scenes(plan).filter((p) => p.set === 'leitura');
    expect(leitura.length).toBe(READING_DISTANCES_M.length * 2 + 1);
    for (const p of leitura) expect([p.width, p.height]).toEqual([640, 360]);
    for (const m of READING_DISTANCES_M) {
      const at = leitura.filter((p) => p.settings.camera === `print:leitura-${m}m` && !p.atlas);
      expect(at.map((p) => (p.settings.grayscale ? 'cinza' : 'cor'))).toEqual(['cor', 'cinza']);
    }
    const atlas = leitura.filter((p) => p.atlas);
    expect(atlas.map((p) => [p.settings.camera, p.settings.grayscale, p.file])).toEqual([
      [`print:leitura-${READING_ATLAS_DISTANCE_M}m`, false, '4-leitura-50m-colorido-atlas-640x360.png'],
    ]);
    expect(inRound('leitura', 'rodada3') && inRound('leitura', 'escolhas')).toBe(true);
  });

  it('(6) folha das fontes e HUD visível em 1280×720 e 640×360', () => {
    const fontes = scenes(plan).filter((p) => p.set === 'fontes');
    expect(fontes.map((p) => `${p.settings.fontSpecimen ? 'folha' : p.settings.hud ? 'hud' : '?'}@${p.width}`)).toEqual(
      ['folha@1280', 'folha@640', 'hud@1280', 'hud@640'],
    );
    for (const p of fontes) expect(p.settings.fontSpecimen && p.settings.hud).toBe(false);
    // O jogo esconde o HUD da vista 0 com câmera nomeada: o print do HUD sai na vista do jogador.
    for (const p of fontes) expect(p.settings.camera === null).toBe(p.settings.hud);
  });

  it('(7) altura na régua de métricas em 1280×720 e 640×360', () => {
    const altura = scenes(plan).filter((p) => p.set === 'altura');
    expect(altura.map((p) => `${p.settings.camera}@${p.width}`)).toEqual(['print:altura@1280', 'print:altura@640']);
  });

  it('(8) título da web em 1280×720 e 640×360 e o do Switch com os 9 itens em 1280×720', () => {
    const titulo = plan.filter((p) => p.set === 'titulo');
    expect(titulo.map((p) => (p.page === 'title' ? `${p.shell}@${p.width}x${p.height}` : 'cena'))).toEqual([
      'web@1280x720',
      'web@640x360',
      'switch@1280x720',
    ]);
  });

  it('filtra por conjunto, número ou rodada e recusa o desconhecido', () => {
    expect(new Set(filterPlan(plan, ['leitura', '7']).map((p) => p.set))).toEqual(new Set(['leitura', 'altura']));
    expect(filterPlan(plan, ['']).length).toBe(plan.length);
    expect(() => filterPlan(plan, ['cores'])).toThrow('conjunto de prints desconhecido');
    expect(new Set(filterPlan(plan, ['16', 'zumbi']).map((p) => p.set))).toEqual(new Set(['sequencia', 'zumbi']));
    expect(filterPlan(plan, ['escolhas', 'rodada3', 'rodada4', 'rodada5']).length).toBe(plan.length);
    expect(filterPlan(plan, ['rodada3']).some((p) => inRound(p.set, 'rodada4') && p.set !== 'leitura')).toBe(false);
  });

  it('roda agrupado por página (uma carga por página), com os mesmos prints', () => {
    const tree = main(plan);
    const order = runOrder(tree, 'construto');
    expect(new Set(order)).toEqual(new Set(tree));
    expect(order.length).toBe(tree.length);
    const pages = order.map((p) => shotQuery(p, 'construto'));
    const changes = pages.filter((q, i) => i === 0 || q !== pages[i - 1]).length;
    // Cena normal (escolhas e rodadas 3 a 5 na mesma carga), cena no atlas, título da web e prévia do Switch, mais uma
    // carga por arma na mão da rodada 5 (bench com 1 bot e `weapons=`).
    const naMao = tree.filter((p) => p.set === 'na-mao').length;
    expect(naMao).toBe(6);
    expect(changes).toBe(4 + naMao);
    expect(new Set(pages).size).toBe(4 + naMao);
    expect(order[0]!.file).toBe(tree[0]!.file);
    // A variante dos bots abre a sua página (12 bots, perfil do PC).
    const bots = copyPlan(plan, 'bots-visuais');
    expect(bots.map((p) => shotQuery(p, 'construto'))).toEqual([printsQuery('construto', false, 12, 'pc')]);
  });
});

describe('rodada 3 (porte do boneco, #56)', () => {
  const plan = buildPrintPlan();
  const tree = scenes(main(plan));
  const of = (set: string): SceneShot[] => tree.filter((p) => p.set === set);
  const allOverrides = tree.flatMap((p) => p.settings.mannequins);

  it('manequins, looks, armas, poses, mira e expressões existem no contrato', () => {
    const mannequins = new Set<string>([...REQUIRED_MANNEQUINS, ...OPTIONAL_MANNEQUINS, 'densidade']);
    const skins = new Set<string>(CONTENT_IDS.filter((id) => id.startsWith('skin:')));
    const pitchMin = FIGURE_PITCH_SAMPLES[0];
    const pitchMax = FIGURE_PITCH_SAMPLES[FIGURE_PITCH_SAMPLES.length - 1]!;
    for (const m of allOverrides) {
      expect(mannequins, m.name).toContain(m.name);
      if (m.look !== undefined && m.look !== 'padrao') expect(skins, m.look).toContain(m.look);
      if (m.weapon) expect(CONTENT_IDS as readonly string[], m.weapon).toContain(`model:${m.weapon}`);
      if (m.team !== undefined) expect([-1, 0, 1]).toContain(m.team);
      if (m.pitch !== undefined) expect(m.pitch >= pitchMin && m.pitch <= pitchMax, `${m.pitch}`).toBe(true);
      if (m.expression !== undefined) expect(m.expression >= 0 && m.expression < FACE_EXPRESSIONS.length).toBe(true);
      if (m.hairStyle !== undefined) expect(m.hairStyle >= 0 && m.hairStyle < 34).toBe(true);
      if (m.headwear !== undefined) expect(m.headwear >= 0 && m.headwear < 5).toBe(true);
    }
    // Cada manequim aparece no máximo uma vez por print.
    for (const p of tree) expect(new Set(names(p.settings.mannequins)).size, p.file).toBe(p.settings.mannequins.length);
    expect(EXPRESSION_LABELS.length).toBe(FACE_EXPRESSIONS.length);
    // Toda a rodada 3 sai em 1280×720, menos a leitura (640×360, como no GDD).
    for (const p of tree) if (inRound(p.set, 'rodada3') && p.set !== 'leitura') expect(p.width).toBe(1280);
  });

  it('(10) régua: em pé, P4f e deslizando, armados, curto × black power, perfil e 45°, mais afro e boné', () => {
    const regua = of('regua');
    expect(regua.map((p) => `${p.slug}@${p.settings.camera}`)).toEqual([
      'classico-perfil@print:altura',
      'classico-45@print:altura-45',
      'blackpower-perfil@print:altura',
      'blackpower-45@print:altura-45',
      'afro-perfil@print:altura',
      'bone-perfil@print:altura',
      'cabelos-agachados-perfil@print:altura',
    ]);
    // G5: os 3 cabelos altos agachados lado a lado, um em cada manequim da régua.
    const g5 = regua.pop()!;
    expect(g5.settings.mannequins.map((m) => [m.name, m.pose, m.look, m.hairStyle, m.headwear])).toEqual([
      ['altura:em-pe', 'crouch', 'skin:blackpower', undefined, undefined],
      ['altura:agachado', 'crouch', 'skin:classico', 31, undefined],
      ['altura:deslizando', 'crouch', 'skin:mechanic', undefined, 4],
    ]);
    for (const p of regua) {
      expect(p.settings.mannequins.map((m) => `${m.name}:${m.pose}:${m.weapon}`)).toEqual([
        'altura:em-pe:stand:rifle',
        'altura:agachado:crouch:rifle',
        'altura:deslizando:slide:rifle',
      ]);
    }
    expect(regua.find((p) => p.slug === 'afro-perfil')!.settings.mannequins[0]!.hairStyle).toBe(31);
    expect(regua.find((p) => p.slug === 'bone-perfil')!.settings.mannequins[0]).toMatchObject({
      look: 'skin:mechanic',
      headwear: 4,
    });
  });

  it('(11) fila: os 12 looks (rotação dos bots + padrão) nos dois times, 3 câmeras, e as 8 expressões', () => {
    expect(FILA_LOOKS).toEqual([...FIGURE_BOT_ROTATION.map((id) => `skin:${id}`), 'padrao']);
    const fila = of('fila');
    expect(fila.length).toBe(11);
    for (const camera of ['print:linha-frente', 'print:linha-3-4', 'print:linha-costas']) {
      const pages = fila.filter((p) => p.settings.camera === camera);
      expect(pages.length).toBe(3);
      for (const team of [0, 1]) {
        const looks = pages.flatMap((p) => p.settings.mannequins.filter((m) => m.team === team).map((m) => m.look));
        expect(looks, `${camera} time ${team}`).toEqual(FILA_LOOKS);
      }
      for (const p of pages) {
        expect(names(p.settings.mannequins)).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((n) => `linha:${n}`));
      }
    }
    const expressions = fila.filter((p) => p.settings.camera === 'print:linha-expressoes');
    expect(expressions.map((p) => p.slug)).toEqual(['expressoes-a', 'expressoes-b']);
    for (const p of expressions) {
      expect(p.settings.mannequins.map((m) => m.expression)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    }
  });

  it('(12–14) close a 1 m e 3 m, vitrine armada do mapa, zumbi de frente e o rosto a 1 m', () => {
    expect(of('close').map((p) => `${p.slug}@${p.settings.camera}`)).toEqual([
      'frente-1m@print:close-1m',
      'costas-1m@print:close-1m',
      'densidade-1m@print:densidade-1m',
      'densidade-3m@print:densidade-3m',
    ]);
    const costas = of('close').find((p) => p.slug === 'costas-1m')!;
    expect(costas.settings.mannequins.map((m) => [m.name, m.team, m.turnDeg])).toEqual([
      ['close:1', 0, 180],
      ['close:5', 1, 180],
    ]);
    expect(of('vitrine').map((p) => [p.settings.camera, p.settings.mannequins])).toEqual([['print:dia', []]]);
    expect(of('zumbi').map((p) => `${p.slug}@${p.settings.camera}`)).toEqual([
      'frente@print:linha-frente',
      'rosto-1m@print:close-1m',
    ]);
    for (const p of of('zumbi')) expect(p.settings.mannequins.some((m) => m.look === 'skin:zombie')).toBe(true);
  });

  it('(15) mira: agachado mirando para cima atrás da cobertura, em pé para cima e para baixo, e o ADS', () => {
    const mira = of('mira');
    expect(mira.map((p) => `${p.slug}:${p.settings.mannequins.map((m) => `${m.name}/${m.pose}/${m.pitch}`)}`)).toEqual([
      'agachado-cima-06:altura:agachado/crouch/0.6',
      'agachado-cima-12:altura:agachado/crouch/1.2',
      'agachado-cima-12-45:altura:agachado/crouch/1.2',
      'em-pe-cima:altura:em-pe/stand/1.2',
      'em-pe-baixo:altura:em-pe/stand/-1.2',
      'em-pe-ads:altura:em-pe/aim/0',
    ]);
  });

  it('(16–17) quadros com dt fixo: os 6 da sequência e o andar de frente, de lado e de ré', () => {
    expect(SEQUENCE_FRAMES.map(([slug]) => slug)).toEqual(['arrancar', 'parar', 'adad', 'pular', 'pousar', 'dano']);
    expect(WALK_FRAMES.map(([slug]) => slug)).toEqual(['frente', 'lado', 're']);
    expect(CLIP_DT_S).toBe(1 / 60);
    for (const set of ['sequencia', 'andar']) {
      for (const p of of(set)) {
        const clip = p.settings.clip!;
        expect(Object.keys(FIGURE_CLIPS)).toContain(clip.clip);
        expect(clip.dtS).toBe(CLIP_DT_S);
        expect(Number.isInteger(clip.frame) && clip.frame >= 0).toBe(true);
        // O manequim do clipe está nos ajustes do mesmo print (aparência e arma conhecidas).
        expect(names(p.settings.mannequins)).toContain(clip.mannequin);
      }
    }
    expect(of('sequencia').map((p) => p.settings.clip!.clip)).toEqual([
      'start',
      'stop',
      'strafe',
      'jump',
      'land',
      'hit',
    ]);
  });

  it('o gancho novo: o que cada print precisa (as escolhas não precisam de nada)', () => {
    expect(FIGURE_HOOK_MEMBERS).toEqual(['setMannequins', 'setFigureClip']);
    for (const p of main(plan)) {
      const needs = shotNeeds(p);
      if (inRound(p.set, 'escolhas')) expect(needs, p.file).toEqual([]);
    }
    expect(shotNeeds(of('vitrine')[0]!)).toEqual([]);
    expect(shotNeeds(of('regua')[0]!)).toEqual(['setMannequins']);
    expect(shotNeeds(of('sequencia')[0]!)).toEqual(['setMannequins', 'setFigureClip']);
    // A chave do loading dos prints, quando ligada, é uma chave do bench do contrato.
    if (PRINTS_LOADING_PARAM !== null) expect(Object.values(BENCH_PARAMS)).toContain(PRINTS_LOADING_PARAM);
  });

  it('as 16 perguntas do §G com o padrão marcado e onde ver cada uma', () => {
    expect(ROUND3_QUESTIONS.map((q) => q.id)).toEqual(Array.from({ length: 16 }, (_, i) => `G${i + 1}`));
    const defaults = Object.fromEntries(ROUND3_QUESTIONS.map((q) => [q.id, q.options[q.default]]));
    expect(defaults).toMatchObject({
      G1: 'Sem capacete',
      G2: 'U (o FutBobo como é)',
      G3: 'Manter (1,5 / 2,0 / 1,25)',
      G4: 'P4f',
      G5: '(c) recortar no teto de 0,99 m / 1,99 m',
      G6: 'Envelope, com os ganhos no teto',
      G7: 'Assim',
      G8: 'Assim',
      G9: 'Lisa; número no peito ligado; escudo',
      G10: 'Desligado',
      G11: 'Zumbi FutBobo',
      G12: 'Carrinho',
      G13: 'Isso',
      G14: 'Não (proporção do FutBobo)',
      G15: 'Manter 0,8 e medir o TTK',
      G16: 'Depois (M2, com contrato de emote)',
    });
    for (const q of ROUND3_QUESTIONS) {
      expect(q.default >= 0 && q.default < q.options.length, q.id).toBe(true);
      expect(q.options.length, q.id).toBeGreaterThanOrEqual(2);
      for (const s of q.sets) expect(inRound(s, 'rodada3'), `${q.id} ${s}`).toBe(true);
      for (const c of q.copies) expect(COPY_VARIANTS.find((v) => v.id === c)?.question, `${q.id} ${c}`).toBe(q.id);
    }
    // Todo conjunto da rodada 3 responde alguma pergunta (direto ou pela variante da cópia).
    for (const s of PRINT_SETS.filter((x) => inRound(x.id, 'rodada3'))) {
      const used =
        ROUND3_QUESTIONS.some((q) => q.sets.includes(s.id)) ||
        COPY_VARIANTS.some((v) => v.repeats.some(([set]) => set === s.id));
      expect(used, s.id).toBe(true);
    }
    expect(ROUND3_NOTES.length).toBe(10);
  });

  it('cópia descartável: as 10 variantes repetem prints que existem e ficam marcadas', () => {
    expect(COPY_VARIANTS.map((v) => v.id)).toEqual([
      'h5',
      'pf',
      'p1',
      'cabelo-aceitar',
      'cabelo-achatar',
      'molas-cheias',
      'capacete',
      'grao',
      'antebraco',
      'bots-visuais',
    ]);
    for (const v of COPY_VARIANTS) {
      const shots = copyPlan(plan, v.id);
      expect(shots.length, v.id).toBe(v.repeats.length);
      for (const s of shots) {
        expect(s.file).toContain(`-copia-${v.id}-`);
        expect(s.caption).toContain(`CÓPIA ${v.id}`);
        const base = plan.find((p) => p.copy === null && p.set === s.set && p.slug === s.slug);
        // Mesmas chaves do print da árvore principal (só os bots não têm base: na árvore são 0, §B16).
        if (v.id !== 'bots-visuais') expect(base && base.page === 'scene' && s.page === 'scene').toBe(true);
        if (base?.page === 'scene' && s.page === 'scene') expect(s.settings).toEqual(base.settings);
      }
    }
    expect(COPY_VARIANTS.find((v) => v.id === 'molas-cheias')!.video).toMatch(/vídeo/);
    expect(() => copyPlan(plan, 'h6')).toThrow('variante da cópia desconhecida');
    expect(copyCommand('h5')).toBe('npm run prints -- --copia h5 --saida <pasta>');
  });
});

describe('rodada 4 (roupa militar, #58)', () => {
  const plan = buildPrintPlan();
  const tree = scenes(main(plan));
  const of = (set: string): SceneShot[] => tree.filter((p) => p.set === set);

  it('tropa: os 12 looks de frente e de costas nos 2 times e sem time; farda a 1 m; vitrine e zumbi', () => {
    for (const s of ['tropa', 'farda', 'patio', 'infectado'] as const) {
      expect(inRound(s, 'rodada4') && !inRound(s, 'rodada3') && !inRound(s, 'escolhas'), s).toBe(true);
      for (const p of of(s)) expect([p.width, p.height], p.file).toEqual([1280, 720]);
    }
    expect(inRound('leitura', 'rodada4')).toBe(true);
    const tropa = of('tropa');
    expect(tropa.map((p) => p.slug)).toEqual([
      'frente-1',
      'costas-1',
      'frente-2',
      'costas-2',
      'frente-3',
      'costas-3',
      'sem-time',
    ]);
    for (const camera of ['print:linha-frente', 'print:linha-costas']) {
      const pages = tropa.filter((p) => p.settings.camera === camera && !p.slug.startsWith('sem-time'));
      expect(pages.length).toBe(3);
      for (const team of [0, 1]) {
        const looks = pages.flatMap((p) => p.settings.mannequins.filter((m) => m.team === team).map((m) => m.look));
        expect(looks, `${camera} time ${team}`).toEqual(FILA_LOOKS);
      }
    }
    const noTeam = tropa.filter((p) => p.slug.startsWith('sem-time'));
    // Sem time: os 7 primeiros da fila (os 6 da rotação do PC já têm skin sem time; o 7º sai sob demanda) e o zumbi.
    expect(noTeam.flatMap((p) => p.settings.mannequins.map((m) => m.look))).toEqual([
      ...FILA_LOOKS.slice(0, 7),
      'skin:zombie',
    ]);
    expect(TROPA_NO_TEAM).toEqual([...FILA_LOOKS.slice(0, 7), 'skin:zombie']);
    for (const p of noTeam) {
      expect(p.settings.camera).toBe('print:linha-frente');
      expect(names(p.settings.mannequins)).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((n) => `linha:${n}`));
      for (const m of p.settings.mannequins) expect(m.team).toBe(-1);
    }
    expect(of('farda').map((p) => `${p.slug}@${p.settings.camera}`)).toEqual([
      'frente-1m@print:close-1m',
      'costas-1m@print:close-1m',
      'sem-time-1m@print:close-1m',
    ]);
    expect(of('farda')[1]!.settings.mannequins.map((m) => [m.name, m.team, m.turnDeg])).toEqual([
      ['close:1', 0, 180],
      ['close:5', 1, 180],
    ]);
    expect(of('patio').map((p) => [p.settings.camera, p.settings.mannequins])).toEqual([['print:dia', []]]);
    expect(of('infectado').map((p) => p.slug)).toEqual(['frente', 'rosto-1m']);
    for (const p of of('infectado')) expect(p.settings.mannequins.some((m) => m.look === 'skin:zombie')).toBe(true);
  });

  it('as 4 perguntas R1–R4 com o padrão marcado e onde ver cada uma; todo conjunto da rodada responde alguma', () => {
    expect(ROUND4_QUESTIONS.map((q) => q.id)).toEqual(['R1', 'R2', 'R3', 'R4']);
    expect(Object.fromEntries(ROUND4_QUESTIONS.map((q) => [q.id, q.options[q.default]]))).toEqual({
      R1: 'Aprovadas',
      R2: 'Cor e ícone',
      R3: 'Luvas, braçadeira e joelheiras do time',
      R4: 'Só no tronco',
    });
    for (const q of ROUND4_QUESTIONS) {
      expect(q.default >= 0 && q.default < q.options.length, q.id).toBe(true);
      expect(q.options.length, q.id).toBeGreaterThanOrEqual(2);
      for (const s of q.sets) expect(inRound(s, 'rodada4'), `${q.id} ${s}`).toBe(true);
      expect(q.copies).toEqual([]);
    }
    for (const s of PRINT_SETS.filter((x) => inRound(x.id, 'rodada4'))) {
      expect(
        ROUND4_QUESTIONS.some((q) => q.sets.includes(s.id)),
        s.id,
      ).toBe(true);
    }
    expect(ROUND4_NOTES.length).toBeGreaterThan(0);
    // As perguntas de cada rodada só entram com um conjunto exclusivo dela (a leitura é de todas).
    expect(roundsWithQuestions(filterPlan(plan, ['rodada4']))).toEqual(['rodada4']);
    expect(roundsWithQuestions(filterPlan(plan, ['rodada3']))).toEqual(['rodada3']);
    expect(roundsWithQuestions(filterPlan(plan, ['escolhas']))).toEqual([]);
    expect(roundsWithQuestions(plan)).toEqual(['rodada3', 'rodada4', 'rodada5']);
    expect(questionsFor(filterPlan(plan, ['rodada4'])).map((q) => q.id)).toEqual(['R1', 'R2', 'R3', 'R4']);
  });
});

describe('pasta, URL e folha de contato', () => {
  it('pasta por versão, com marca opcional limpa; a rodada falsa nunca se mistura', () => {
    expect(printDirName('0.0.1', null)).toBe('0.0.1');
    expect(printDirName('0.0.1', 'antes do ajuste/2')).toBe('0.0.1-antes-do-ajuste-2');
    expect(printDirName('', '')).toBe('sem-versao');
    expect(printDirName('0.0.1', fakeTag(null))).toBe('0.0.1-falso');
    expect(printDirName('0.0.1', fakeTag('altura a'))).toBe('0.0.1-falso-altura-a');
  });

  it('a página da cena é um bench parado, numa vista, com nomes do contrato', () => {
    for (const [atlas, bots, profile] of [
      [false, 0, null],
      [true, 0, null],
      [false, 12, 'pc'],
    ] as const) {
      const query = new URLSearchParams(printsQuery('construto', atlas, bots, profile).slice(1));
      expect(query.has('bench')).toBe(true);
      const known = new Set<string>(Object.values(BENCH_PARAMS));
      for (const key of query.keys()) if (key !== 'bench') expect(known, key).toContain(key);
      expect(query.get('views')).toBe('1');
      expect(query.get('bots')).toBe(String(bots));
      expect(query.get('profile')).toBe(profile);
      expect(Number(query.get('view'))).toBeGreaterThan(50);
      expect(query.get(BENCH_PARAMS.textureMode)).toBe(atlas ? '1' : null);
    }
  });

  it('o título da web é a página inicial; a prévia do Switch usa a chave que a casca lê', () => {
    const plan = buildPrintPlan();
    const queries = plan.filter((p) => p.page === 'title').map((p) => shotQuery(p, 'construto'));
    expect(queries).toEqual(['', '', SWITCH_TITLE_QUERY]);
    expect(urlAsksForSwitchTitle(SWITCH_TITLE_QUERY)).toBe(true);
    expect(urlAsksForSwitchTitle('')).toBe(false);
    expect(new URLSearchParams(SWITCH_TITLE_QUERY.slice(1)).has('bench')).toBe(false);
  });

  const sheet = (results: readonly ShotResult[], problems: string[] = []): string =>
    contactSheetHtml({
      version: '0.0.1',
      tag: 'altura-a',
      createdAt: '2026-11-03T00:00:00Z',
      browser: 'Edge 156',
      url: 'http://127.0.0.1/?bench&x=<y>',
      fake: true,
      results,
      problems,
    });

  it('folha de contato das escolhas: seções na ordem, imagens com caminho relativo, falhas visíveis, HTML escapado', () => {
    const plan = filterPlan(buildPrintPlan(), ['escolhas']);
    const html = sheet(
      plan.map((shot, i) =>
        i === 3
          ? { shot, status: 'sem-camera', detail: 'câmera print:dia não existe no mapa' }
          : { shot, status: 'ok' },
      ),
      ['erro no console: <script>'],
    );
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('lang="pt-BR"');
    expect(html).toContain(`<img src="${plan[0]!.file}"`);
    expect(html).toContain('câmera print:dia não existe no mapa');
    expect(html).toContain('PÁGINA FALSA');
    expect(html).toContain('· altura-a');
    expect(html).toContain('&lt;script&gt;');
    // Sem a rodada 3 não há perguntas (nem script na página).
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('id="perguntas"');
    expect(html).toContain('x=&lt;y&gt;');
    const order = PRINT_SETS.filter((s) => inRound(s.id, 'escolhas')).map((s) =>
      html.indexOf(`<section id="${s.id}">`),
    );
    expect(order.every((pos, i) => pos > 0 && (i === 0 || pos > order[i - 1]!))).toBe(true);
    expect(html).toContain(`${plan.length - 1} de ${plan.length} prints`);
  });

  it('folha de contato da rodada 3: as 16 perguntas com o padrão marcado, pendentes e lugares da cópia', () => {
    const plan = filterPlan(buildPrintPlan(), ['rodada3']);
    const results: ShotResult[] = plan.map((shot) =>
      shot.copy !== null
        ? { shot, status: 'copia' }
        : shotNeeds(shot).length > 0
          ? { shot, status: 'pendente', detail: 'o game ainda não expõe setMannequins (passo 5)' }
          : { shot, status: 'ok' },
    );
    const html = sheet(results, ['erro no console: <script>']);
    expect(html).toContain('id="perguntas"');
    expect(html.match(/<fieldset class="pergunta"/g)?.length).toBe(16);
    for (const q of ROUND3_QUESTIONS) {
      expect(html).toContain(`<input type="radio" name="${q.id}" value="${q.default}" checked>`);
      expect(html.match(new RegExp(`name="${q.id}" value="\\d+" checked`, 'g'))?.length, q.id).toBe(1);
    }
    expect(html).toContain('(padrão, já no código)');
    expect(html).toContain(copyCommand('h5').replace('<pasta>', '&lt;pasta&gt;'));
    expect(html).toContain('o game ainda não expõe setMannequins');
    expect(html).toContain('class="miss pendente"');
    // O único <script> é o da página; o texto dos problemas continua escapado.
    expect(html.match(/<script>/g)?.length).toBe(1);
    expect(html).toContain('<li>erro no console: &lt;script&gt;</li>');
    const pending = results.filter((r) => r.status === 'pendente').length;
    const copies = results.filter((r) => r.status === 'copia').length;
    expect(html).toContain(`· ${pending} pendentes · ${copies} na cópia`);
    // Rodada da cópia: sem perguntas (são da árvore principal) e com o aviso da variante.
    const copyHtml = contactSheetHtml({
      version: '0.0.1',
      tag: 'copia-h5',
      createdAt: '2026-11-04T00:00:00Z',
      browser: 'Edge 156',
      url: 'http://127.0.0.1/',
      fake: false,
      copy: 'h5',
      results: copyPlan(buildPrintPlan(), 'h5').map((shot) => ({ shot, status: 'ok' })),
      problems: [],
    });
    expect(copyHtml).toContain('CÓPIA DESCARTÁVEL');
    expect(copyHtml).not.toContain('id="perguntas"');
  });

  it('folha de contato da rodada 4: as 4 perguntas R1–R4 com o padrão marcado, sem as do §G', () => {
    const plan = filterPlan(buildPrintPlan(), ['rodada4']);
    const html = sheet(plan.map((shot) => ({ shot, status: 'ok' })));
    expect(html).toContain('id="perguntas"');
    expect(html.match(/<fieldset class="pergunta"/g)?.length).toBe(4);
    for (const q of ROUND4_QUESTIONS) {
      expect(html).toContain(`<input type="radio" name="${q.id}" value="${q.default}" checked>`);
      expect(html.match(new RegExp(`name="${q.id}" value="\\d+" checked`, 'g'))?.length, q.id).toBe(1);
    }
    expect(html).not.toContain('name="G1"');
    expect(html).toContain('Perguntas da rodada 4 (roupa militar, #58)');
    expect(html.match(/<script>/g)?.length).toBe(1);
    // As duas rodadas juntas: um formulário só, com as 20 perguntas.
    const both = sheet(
      filterPlan(buildPrintPlan(), ['rodada3', 'rodada4'])
        .filter((shot) => shot.copy === null)
        .map((shot) => ({ shot, status: 'ok' })),
    );
    expect(both.match(/<fieldset class="pergunta"/g)?.length).toBe(20);
    expect(both.match(/<script>/g)?.length).toBe(1);
  });

  it('página falsa implementa o gancho inteiro do contrato, a cena e o título', () => {
    const page = fakePrintsPage();
    for (const member of Object.keys(GAME_DEBUG_MEMBERS)) expect(page, member).toContain(`${member}`);
    for (const gone of ['setOutline', 'setSkinDensityTest', 'showFontCompare']) expect(page).not.toContain(gone);
    expect(page).toContain('id="bf-game"');
    expect(page).toContain("screen: scene ? 'scene' : 'title'");
    expect(page).toContain('titulo=switch');
  });
});

describe('argumentos dos scripts', () => {
  it('--chave valor, --chave=valor e bandeiras', () => {
    const args = parseArgs(['--views', '4', '--atlas', '--tod=night', '--falso', '--bots', '24', 'solto', '--']);
    expect([...args]).toEqual([
      ['views', '4'],
      ['atlas', true],
      ['tod', 'night'],
      ['falso', true],
      ['bots', '24'],
    ]);
  });

  it('carimbo de data legível', () => {
    expect(stamp(new Date(2026, 10, 3, 9, 5))).toBe('2026-11-03-0905');
  });
});

describe('rodada 5 (as armas do M2)', () => {
  const plan = buildPrintPlan();
  const round5 = scenes(filterPlan(plan, ['rodada5']));

  it('arsenal na fila e empunhadura a 1 m: as armas novas na mão dos manequins, nos 2 times', () => {
    const arsenal = round5.filter((p) => p.set === 'arsenal');
    expect(arsenal.map((p) => `${p.slug}@${p.settings.camera}`)).toEqual([
      'frente@print:linha-frente',
      '3-4@print:linha-3-4',
      'mirando@print:linha-3-4',
    ]);
    const weapons = new Set(arsenal.flatMap((p) => p.settings.mannequins.map((m) => m.weapon)));
    for (const w of ['pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'rocket', 'knife', 'grenade', 'lmg']) {
      expect(weapons, w).toContain(w);
    }
    const close = round5.filter((p) => p.set === 'empunhadura');
    expect(close.map((p) => p.settings.mannequins.map((m) => m.weapon).join('+'))).toEqual([
      'smg+shotgun',
      'rocket+lmg',
      'knife+grenade',
    ]);
    for (const p of [...arsenal, ...close]) expect([p.bots, p.weapons, p.settings.viewmodel]).toEqual([0, null, false]);
  });

  it('na mão: vista do jogador com HUD e viewmodel, 1 bot e uma primária por página', () => {
    const naMao = round5.filter((p) => p.set === 'na-mao');
    expect(naMao.map((p) => p.weapons)).toEqual(['rifle', 'smg', 'shotgun', 'sniper', 'rocket', 'lmg']);
    for (const p of naMao) {
      expect([p.settings.camera, p.settings.hud, p.settings.viewmodel, p.bots]).toEqual([null, true, true, 1]);
      expect(shotQuery(p, 'construto')).toContain(`&weapons=${p.weapons}`);
    }
  });

  it('as 4 perguntas A1–A4 com o padrão marcado; todo conjunto da rodada responde alguma', () => {
    expect(ROUND5_QUESTIONS.map((q) => q.id)).toEqual(['A1', 'A2', 'A3', 'A4']);
    for (const q of ROUND5_QUESTIONS) {
      expect(q.default >= 0 && q.default < q.options.length, q.id).toBe(true);
      for (const set of q.sets) expect(inRound(set, 'rodada5'), `${q.id} ${set}`).toBe(true);
    }
    for (const set of PRINT_SETS.filter((x) => inRound(x.id, 'rodada5'))) {
      expect(
        ROUND5_QUESTIONS.some((q) => q.sets.includes(set.id)),
        set.id,
      ).toBe(true);
    }
    expect(ROUND5_NOTES.length).toBeGreaterThan(0);
    expect(roundsWithQuestions(filterPlan(plan, ['rodada5']))).toEqual(['rodada5']);
  });
});
