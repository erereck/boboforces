# Plano do refino antes do M4 (16/11/2026)

> Pedido do Erick (#79): antes das próximas coisas, refinar o que já existe — menus mais claros, atirar andando menos
> esquisito e mais arcade, a granada melhor e o que mais aparecer — e depois voltar a adicionar coisas novas.
> `docs/DECISOES.md` manda sobre este plano. Cada fase termina verde e commitada; sigo no padrão sem perguntar e junto
> as perguntas numa rodada de prints no fim.

## O que achei no levantamento

- **Atirar andando:** no perfil Bobo a mira abre 1,5× andando e 2,5× no ar; correndo, o gatilho não faz nada, e ao
  parar de correr o tiro ainda espera 0,15 s; no controle a corrida é "segurar o L3" (alternar vem desligado); e a
  retícula da HUD abre até 60% só pela velocidade, abrindo e fechando a cada passo mesmo sem atirar.
- **Granada:** o G (e o RB no controle, e o botão do toque) manda o botão "granada", mas **a sim não lê esse botão**:
  para jogar é preciso trocar para a granada (tecla 4), segurar o gatilho e soltar. Não há arco de mira, nem o tempo do
  pavio na tela, nem aviso de granada perto.
- **Menus:** a levantar com capturas (fase R3). O menu está em 347,7 de 350 KB: mexer nele pede abrir espaço antes.

## Fases

1. **R1. Atirar andando, arcade** (feita em 16/11/2026, ARCHITECTURE §14.1; perfil Bobo; o Tático continua como o CS): o gatilho corta a corrida e atira quase na
   hora; a mira quase não abre andando; no ar abre menos; mira andando mais rápida; no controle, correr alterna com o
   L3 e solta quando o jogador para; a retícula da HUD segue a dispersão de verdade.
2. **R2. Granada** (feita em 16/11/2026, ARCHITECTURE §14.2): arremesso rápido no G / RB / botão do toque (de qualquer arma, sem trocar: segura cozinha, solta
   joga, volta para a arma); o pavio na tela enquanto cozinha; o arco da trajetória; aviso de granada perto.
3. **R3. Menus:** levantar o caminho de cada opção e reorganizar para ficar o mais claro possível. R3a (feita em
   16/11/2026, ARCHITECTURE §14.3): os textos da partida fora do menu, para abrir espaço. R3b (feita em 16/11/2026,
   §14.4): o título como centro (sem o "Mudar"), os Modos como o lugar de escolher o que jogar, a tela Testes. R3c (feita
   em 16/11/2026, §14.5): os Ajustes, com a Tela (câmera e gráficos juntos) e a frase de ajuda da linha com o foco.
4. **R4. Outros refinos** achados jogando e nas capturas. R4a (feita em 16/11/2026, ARCHITECTURE §14.6): a pausa com
   nomes claros e a frase do item; a arma menor na tela com 1–2 jogadores.
5. **R5. Prints e perguntas** (feita em 16/11/2026): a rodada 17 (N1–N7, seções 71–77) é a versão 19 da página das
   rodadas, montada por `local/m2/montar-pagina-r17.mjs` com as capturas de `local/refino/`; o NRO do refino foi
   junto. Sigo no padrão de todas; a N7 é seguir para o M4 (o plano em `docs/PLANO_M4.md`). Depois da rodada entrou
   ainda a R4c (a Partida personalizada explica cada regra).
