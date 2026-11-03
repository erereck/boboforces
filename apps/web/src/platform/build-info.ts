/**
 * Identidade do build, injetada pelo `define` do Vite (vite.config.ts lê o version.json e o commit do git). Fora do
 * Vite (testes) as constantes não existem e caem nos valores de desenvolvimento.
 */
export interface BuildInfo {
  readonly version: string;
  readonly codename: string;
  /** Hash curto do commit, ou `dev` quando não há git ou commit. */
  readonly build: string;
}

export const BUILD_INFO: BuildInfo = {
  version: typeof __BF_VERSION__ === 'string' ? __BF_VERSION__ : '0.0.0-dev',
  codename: typeof __BF_CODENAME__ === 'string' ? __BF_CODENAME__ : 'dev',
  build: typeof __BF_BUILD__ === 'string' ? __BF_BUILD__ : 'dev',
};
