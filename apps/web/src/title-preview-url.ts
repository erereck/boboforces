// As chaves de URL das prévias do Switch na casca web. M9 (fase 0): à parte da `title-preview.ts`, que só chega por
// `import()` quando a URL pede a prévia (o menu normal não paga pela plataforma falsa nem pelos itens de teste).

/** Chave da URL (`?titulo=switch`); o roteiro dos prints usa a mesma (`SWITCH_TITLE_QUERY`). */
export const TITLE_PREVIEW_PARAM = 'titulo';

/** A URL pede a prévia do título do Switch? */
export function urlAsksForSwitchTitle(search: string): boolean {
  const query = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return query.get(TITLE_PREVIEW_PARAM)?.trim().toLowerCase() === 'switch';
}

/** M4 (fase 1): `?edicao=local` ensaia a LOCAL EDITION do Switch (o lobby como casa) no navegador. */
export function urlAsksForLocalEdition(search: string): boolean {
  const query = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return query.get('edicao')?.trim().toLowerCase() === 'local';
}
