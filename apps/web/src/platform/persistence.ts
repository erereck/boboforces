/** O pedaço do `navigator` que a persistência usa (permite testar com objetos sintéticos). */
export interface PersistenceNavigator {
  readonly storage?: {
    persisted?(): Promise<boolean>;
    persist?(): Promise<boolean>;
  };
  readonly userActivation?: { readonly isActive: boolean };
}

export interface StoragePersistence {
  /** Último estado conhecido (vai no relatório); `null` quando a API não existe (ex.: http sem TLS). */
  readonly persisted: boolean | null;
  /** Consulta sem pedir nada ao jogador. */
  refresh(): Promise<boolean | null>;
  /** Chama `navigator.storage.persist()` uma única vez. Deve vir de um gesto (o Firefox mostra um pedido). */
  request(): Promise<boolean | null>;
  /** Pede só se a página estiver com ativação de usuário agora (clique/tecla/toque em andamento). */
  requestIfGesture(): void;
}

/**
 * `navigator.storage.persist()` (tecnico.md §14.4): nunca no boot (o Firefox perguntaria ao abrir o jogo); a casca
 * pede na primeira gravação feita dentro de um gesto do jogador. O resultado aparece no relatório.
 */
export function createStoragePersistence(nav: PersistenceNavigator): StoragePersistence {
  const api = nav.storage;
  let persisted: boolean | null = null;
  let requested: Promise<boolean | null> | null = null;

  async function refresh(): Promise<boolean | null> {
    if (!api?.persisted) return persisted;
    try {
      persisted = await api.persisted();
    } catch {
      // Alguns navegadores rejeitam em contexto restrito; fica o último valor conhecido.
    }
    return persisted;
  }

  function request(): Promise<boolean | null> {
    if (requested) return requested;
    if (!api?.persist) return (requested = refresh());
    requested = api.persist().then(
      (granted) => (persisted = granted),
      () => persisted,
    );
    return requested;
  }

  return {
    get persisted() {
      return persisted;
    },
    refresh,
    request,
    requestIfGesture() {
      if (requested || persisted === true) return;
      // Sem a API de ativação não dá para saber se é gesto: melhor não pedir do que perguntar fora de hora.
      if (nav.userActivation?.isActive !== true) return;
      void request();
    },
  };
}
