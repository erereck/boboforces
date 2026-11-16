# Roteiro do console no M4: a LOCAL EDITION no Switch (16/11/2026)

> Para o Erick seguir quando o Switch voltar (fase 8 do `PLANO_M4.md`, em lote). Vale o NRO mais novo que mandei (o
> `BoboForces-0.0.1-m4-*-nro.zip`). O NSP fica para depois do roteiro (P7). Anote ao lado de cada item: **ok**,
> **estranho** (com uma frase) ou **quebrou**, e mande no fim o `sdmc:/switch/boboforces/runtime.log` (e o
> `runtime.old.log`, se houver; se algo fechar sozinho, os arquivos de `sdmc:/atmosphere/crash_reports/`).
> O roteiro do M3 que ficou sem log (`ROTEIRO_M3.md` §2) entra aqui, nos itens 2, 3 e 7.

## 1. Antes

- Copiar o `BoboForces.nro` para `sdmc:/switch/boboforces/BoboForces.nro` (o mesmo lugar de sempre) e abrir pelo
  homebrew menu **segurando R**. O ícone agora é um bobo de capacete.
- Para testar a pasta `oficina/` (item 6): no PC (o site), criar um bot no Laboratório e salvar um preset, e em
  Ajustes → Dados → Exportar backup baixar o arquivo; pôr o `.json` em `sdmc:/switch/boboforces/oficina/`. Do
  backup só entram os bots e os presets salvos (os ajustes e as estatísticas do Switch ficam). Um arquivo qualquer
  que não seja do jogo também, para ver o aviso no log.

## 2. Roteiro

| # | O que fazer | O que esperar |
|---|---|---|
| 1 | Abrir o jogo | Abre direto no lobby "aperte A" (sem título); o 1º controle que apertar A vira o P1 |
| 2 | Na dock, 4 controles apertam A; o P1 escolhe **Sofá Zombies** e COMEÇAR; jogar **20 min** | 30 fps ou mais, sem fechar sozinho; no log, uma linha `[mem]` por minuto (o heap não sobe minuto a minuto) |
| 3 | O mesmo no portátil (1 ou 2 jogadores) e depois tirar da dock no meio de uma partida | Pausa sozinho; no portátil, 1 vista se estiver sozinho; a partida continua |
| 4 | HOME e voltar; dormir e acordar; desconectar e reconectar um controle | A pausa abre na página **Jogadores** e volta sem perder a partida nem a música; o assento de quem desconectou espera ele |
| 4b | Numa partida com 2, encaixar os Joy-Cons do P2 no console (ele vira outro controle) e apertar A neles | Na página Jogadores, o P2 passa para o controle novo; Continuar e ele joga |
| 4c | Fora da dock, olhar a pausa (e, se der, jogar com a bateria abaixo de 20%) | "Bateria NN%" na pausa; abaixo de 20%, um aviso só na partida |
| 5 | Do lobby: Modos, Ajustes, Laboratório, Meu Bobo e Testes, e voltar de cada um | Toda volta cai no lobby, com os mesmos jogadores sentados |
| 6 | Com arquivos na `oficina/`, abrir o Laboratório | O bot (ou o preset) do PC aparece; no log, `[save] oficina: …` (o arquivo estranho como "ignorado") |
| 7 | Solo, no portátil, Bobo Zombies o quanto der | Sem travar; anote se esquentar e em que onda parou |
| 8 | Abrir o jogo a frio 3 vezes e anotar quanto o lobby demora; depois a 1ª partida | O `[boot] menu-ready` e o `loading` no log (a 1ª cena ainda deve ficar perto de 5 s: a 5a espera este número) |
| 9 | Sair: apertar Sair uma vez, ver o aviso; apertar de novo | O 1º aperto só avisa (linha vermelha); o 2º fecha o jogo |
| 10 | Mandar o `runtime.log` (e o resto do "Antes") | Boot, `[mem]`, `[save]`, loading, erros |

## 3. O que ainda é risco conhecido

- O loading da 1ª cena perto de 5 s com o JIT frio (#60; a fase 5a espera o número do item 8).
- O decodificador de MP3 do nx.js nas emendas das músicas (as do Zombies foram medidas só no Edge).
- A bateria: o jogo só sonda; se o console devolver o nível, o aviso abaixo de 20% entra (P5).
- O NSP (instalar pelo HOME, sem segurar R) é o último passo do M4: você roda o `npm run nsp` com o seu `prod.keys`
  (P7) e me conta o `verify:nsp`.
