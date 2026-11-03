import type { Files, PickedFile } from '@boboforces/platform-api';
import type { Disposable } from '@boboforces/shared';

/** Teto do arquivo importado: um backup com todos os bots e presets cabe com folga. */
export const MAX_PICKED_FILE_BYTES = 8 * 1024 * 1024;

interface PendingPick {
  resolve(file: PickedFile | null): void;
  reject(error: Error): void;
}

/**
 * Importar e exportar arquivos (backup e relatório), a exceção técnica de DOM da casca registrada no DECISOES.md
 * ("DOM na web (exceção da #3)"). Nada aqui é UI do jogo: um `<input type=file>` escondido e um link com Blob.
 *
 * O seletor de arquivos só abre dentro de um gesto (clique, tecla, toque); botão de controle não conta como gesto no
 * navegador. Fora de um gesto, `pick` rejeita na hora em vez de ficar pendurado, para o jogo mostrar a dica dele.
 * Arquivo acima de `MAX_PICKED_FILE_BYTES` também rejeita; cancelar resolve `null`.
 */
export function createWebFiles(doc: Document): Files & Disposable {
  const win = doc.defaultView ?? window;
  let input: HTMLInputElement | null = null;
  let pending: PendingPick | null = null;

  function take(): PendingPick | null {
    const current = pending;
    pending = null;
    return current;
  }

  function onChange(this: HTMLInputElement): void {
    const file = this.files?.[0];
    const current = take();
    if (!current) return;
    if (!file) {
      current.resolve(null);
      return;
    }
    if (file.size > MAX_PICKED_FILE_BYTES) {
      current.reject(new Error(`Files.pick: arquivo com ${file.size} bytes passa do teto de ${MAX_PICKED_FILE_BYTES}`));
      return;
    }
    file.arrayBuffer().then(
      (buffer) => current.resolve({ name: file.name, bytes: new Uint8Array(buffer) }),
      (error: unknown) => current.reject(new Error('Files.pick: leitura do arquivo falhou', { cause: error })),
    );
  }

  function onCancel(): void {
    take()?.resolve(null);
  }

  function ensureInput(): HTMLInputElement {
    if (input) return input;
    const el = doc.createElement('input');
    el.type = 'file';
    el.tabIndex = -1;
    el.setAttribute('aria-hidden', 'true');
    // Fora da tela em vez de display:none: o Safari antigo não abre o seletor de um input sem caixa.
    el.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    el.addEventListener('change', onChange);
    // `cancel` existe no Chrome 113+, Firefox 91+ e Safari 16.4+: o jogador fechou o seletor sem escolher.
    el.addEventListener('cancel', onCancel);
    doc.body.appendChild(el);
    input = el;
    return el;
  }

  return {
    pick(accept) {
      take()?.resolve(null);
      const activation = (win.navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
      if (activation && !activation.isActive) {
        return Promise.reject(new Error('Files.pick: o navegador só abre o seletor durante um clique, tecla ou toque'));
      }
      const el = ensureInput();
      el.accept = accept.join(',');
      el.value = ''; // escolher o mesmo arquivo de novo também dispara `change`
      return new Promise<PickedFile | null>((resolve, reject) => {
        pending = { resolve, reject };
        el.click();
      });
    },
    save(name, data, mimeType) {
      try {
        const part: BlobPart = typeof data === 'string' ? data : (data as Uint8Array<ArrayBuffer>);
        const url = URL.createObjectURL(new Blob([part], { type: mimeType }));
        const link = doc.createElement('a');
        link.href = url;
        link.download = name;
        link.rel = 'noopener';
        link.style.display = 'none';
        doc.body.appendChild(link);
        link.click();
        link.remove();
        // O Firefox precisa da URL viva um pouco depois do clique.
        win.setTimeout(() => URL.revokeObjectURL(url), 10_000);
        return Promise.resolve(true);
      } catch {
        return Promise.resolve(false);
      }
    },
    dispose() {
      take()?.resolve(null);
      input?.removeEventListener('change', onChange);
      input?.removeEventListener('cancel', onCancel);
      input?.remove();
      input = null;
    },
  };
}
