/**
 * M12 (fase 6): a sensibilidade da mira no ADS pelo zoom. O FOV do ADS encolhe por `zoom` (`tan(fov/2)` divide por
 * ele), então girar a mira na mesma velocidade angular do quadril anda `zoom` vezes mais rápido na tela: na sniper (4×)
 * o multiplicador fixo antigo de 0,7 deixava a mira 2,8× mais rápida na tela que no quadril. Aqui o multiplicador é
 * `tan(fovADS/2) / tan(fovQuadril/2)` (= `1/zoom`) vezes o ajuste do jogador (`adsMul`, 1 = a mira anda na tela como no
 * quadril), seguindo o quanto o ADS já entrou (`blend` 0..1, o mesmo que encolhe o FOV) e não o botão.
 *
 * Quem chama é o `game` (ele sabe o quanto o ADS entrou e o zoom da arma na mão): o resultado entra no `aimScale` do
 * `InputMapper.update`, junto com a fricção da assistência.
 */
export function adsLookScale(adsMul: number, blend: number, adsZoom: number): number {
  const b = blend <= 0 ? 0 : blend >= 1 ? 1 : blend;
  if (b === 0) return 1;
  const zoom = 1 + (adsZoom - 1) * b;
  return (1 + (adsMul - 1) * b) / (zoom > 0 ? zoom : 1);
}
