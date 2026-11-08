// `map@1` (`.bfmap`): tipos em `types.ts` (contrato do M1); codificador e decodificador em `codec.ts`, validador em
// `validate.ts` (frente "mapa-nav"). As assinaturas públicas abaixo são o contrato.
import { decodeMap as decodeMapImpl, encodeMap as encodeMapImpl } from './codec.ts';
import type { MapDocument } from './types.ts';
import { validateMapImpl } from './validate.ts';

export * from './types.ts';
export * from './props.ts';
export {
  BFMAP_NAV_SECTION,
  BFMAP_SECTIONS,
  MAP_CELL_BLOCK_MASK,
  MAP_CELL_RESERVED_MASK,
  MAP_CHUNK_SIZE,
  MAP_CHUNK_VOLUME,
  MAP_MAX_BLOCK_TYPES,
  MAP_MAX_DENSE_CHUNKS,
  MAP_MAX_GRID_XZ,
  MAP_MAX_GRID_Y,
  MAP_MAX_INFLATED_BYTES,
  MAP_MAX_PROPS,
  type BfmapSection,
} from './codec.ts';
export {
  MAX_DECLARED_SIGHT_LINE_M,
  MIN_DOMINATION_POINTS,
  MIN_FFA_SPAWNS,
  MIN_TDM_SPAWNS_PER_TEAM,
} from './validate.ts';

/**
 * Layout do `.bfmap` (little-endian), TODO o arquivo comprimido com deflate (fflate, nível 9):
 *
 *   u32 magia `BFMAP_MAGIC` · u16 versão (1) · u16 nº de seções
 *   seções, nesta ordem, cada uma: u32 etiqueta ASCII · u32 tamanho em bytes · conteúdo
 *     'META'  JSON UTF-8: { id, meta }            (`MapMeta`)
 *     'BLKS'  JSON UTF-8: string[]                (tabela de blocos; [0] = "air")
 *     'GRID'  binário: u16 sizeX · u16 sizeY · u16 sizeZ · varuint nº de chunks · por chunk u16 cx · u16 cy · u16 cz ·
 *             varuint nº de corridas · (u16 célula, varuint comprimento) × corridas, na ordem do índice da célula
 *             (o mesmo RLE do `encodeGrid` do world, sem o deflate interno)
 *     'PROP'  binário: varuint nº de modelos distintos · (varuint tamanho, UTF-8 do ID) × n · varuint nº de props ·
 *             por prop: varuint índice do modelo · i32 x · i32 y · i32 z (texels) · u8 yaw · u8 escala · u8 dose
 *     'MARK'  JSON UTF-8: `MapMarkers`
 *     'LITE'  JSON UTF-8: `MapLight`
 *     'NAV '  reservado (navegação pré-calculada; no M1 a grade de navegação é montada no loading)
 *   Etiqueta desconhecida é pulada (campos novos não quebram arquivos velhos). Versão maior é recusada.
 *
 * O decodificador não confia no arquivo: teto de tamanho da grade (`MAX_GRID_SIZE_*` do world) antes de alocar,
 * inflate com teto de saída, célula com bit reservado recusada, índice de bloco além da tabela recusado.
 */
export function encodeMap(doc: MapDocument): Uint8Array {
  return encodeMapImpl(doc);
}

/** Lê um `.bfmap`. Versão 0 (arquivo provisório da etapa de contratos) é recusada com "rode npm run mapc". */
export function decodeMap(bytes: Uint8Array): MapDocument {
  return decodeMapImpl(bytes);
}

export interface MapValidationOptions {
  /** IDs de bloco conhecidos (sem prefixo); ausente = os do registro de conteúdo. */
  readonly knownBlocks?: ReadonlySet<string>;
  /** IDs de modelo conhecidos (sem prefixo); ausente = os do registro de conteúdo. */
  readonly knownModels?: ReadonlySet<string>;
  /** Exigir as câmeras dos prints, as rotas do bench e os manequins (o Construto do M1 exige). */
  readonly requirePrintMarkers?: boolean;
}

/**
 * Confere o documento (tecnico.md §15.3, parte que não precisa do world nem da navegação): tabela de blocos e
 * modelos registrados, modos registrados, spawns por modo (TDM ≥ 6 por time, FFA ≥ 16), câmeras e rotas com nome
 * único, pose de manequim conhecida (`slide` incluída), nomes de print reservados (`altura:`, `linha:`, `close:`,
 * `print:linha`, `print:close`, `print:altura-`) só os do contrato, sol com y > 0. Com `requirePrintMarkers`: marcadores obrigatórios,
 * a pose fixa dos de print (a régua com em pé, agachado e `slide`; fila e close em pé) e os grupos opcionais inteiros
 * ou ausentes. Devolve as mensagens (pt-BR) dos problemas; vazio = ok. Alcance dos spawns e linha de visão o `mapc`
 * confere com o world e o nav.
 */
export function validateMap(doc: MapDocument, options: MapValidationOptions = {}): readonly string[] {
  return validateMapImpl(doc, options);
}
