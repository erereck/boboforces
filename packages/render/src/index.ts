// @boboforces/render: o ÚNICO pacote que importa three (regra 7). Recebe a GraphicsSurface da plataforma e desenha
// mundo, atores, viewports e a DrawList da UI. Quem só precisa do contrato importa os TIPOS (`import type`), e o que
// não depende do three (ActorBuffer, presets de céu, texture arrays) também sai por `@boboforces/render/data`.
export * from './data.ts';
export * from './actor-instances.ts';
export * from './ui-pass.ts';
export * from './renderer.ts';
// Passe de UI (programa 7), feito pela frente da UI em `src/ui/` sobre a costura `UiPassFactory` de `ui-pass.ts`.
export * from './ui/index.ts';
