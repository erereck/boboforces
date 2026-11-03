// `npm run eden` (apps/switch): gera uma config de TESTE do Eden em `local/eden/eden-test.ini` (pasta privada, fora
// do git), a partir da config normal, sem nunca editar a original (herdado do MMM). Liga o teclado, desliga a busca de
// atualização e mapeia os botões do primeiro controle no teclado. Para mirar e andar, use um controle de verdade.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL_DIR } from './paths.ts';

const appData = process.env['APPDATA'];
if (!appData) throw new Error('APPDATA não definido (este script é para o Windows do Erick).');
const source = join(appData, 'eden', 'config', 'qt-config.ini');
if (!existsSync(source)) throw new Error(`Config do Eden não encontrada em ${source}`);

let config = readFileSync(source, 'utf8');
const set = (key: string, value: string): void => {
  config = config.replace(new RegExp(`^${key.replace(/\\/g, '\\\\')}=.*$`, 'm'), `${key}=${value}`);
};
set('keyboard_enabled\\default', 'false');
set('keyboard_enabled', 'true');
set('check_for_updates\\default', 'false');
set('check_for_updates', 'false');
// Códigos de tecla do Qt. Botões por posição física do Switch; o + pausa (não sai).
const mapping: Record<string, number> = {
  a: 67, // C
  b: 88, // X
  x: 86, // V
  y: 90, // Z
  l: 81, // Q
  r: 69, // E
  zl: 49, // 1
  zr: 50, // 2
  plus: 77, // M
  minus: 78, // N
  dleft: 16777234,
  dup: 16777235,
  dright: 16777236,
  ddown: 16777237,
};
for (const [name, code] of Object.entries(mapping)) {
  set(`player_0_button_${name}`, `"engine:keyboard,code:${code},toggle:0"`);
}
const dir = join(LOCAL_DIR, 'eden');
mkdirSync(dir, { recursive: true });
const output = join(dir, 'eden-test.ini');
writeFileSync(output, config);
console.log(output);
