// JSON no MESMO formato que o Prettier do repositório imprime (printWidth 120), para os arquivos gerados passarem no
// `format:check` sem ninguém rodar o Prettier depois do gerador (e o `--check` do gerador não brigar com ele):
//   - objeto sempre expandido (uma chave por linha), como o `JSON.stringify(_, null, 2)`;
//   - lista só de números: numa linha se couber (contando o "," que vem depois); senão quebra e preenche as linhas
//     (o `fill` do Prettier: o próximo número entra na linha se "atual," + " " + "próximo" couber);
//   - outra lista: numa linha se couber e não tiver objeto; senão um item por linha.
const WIDTH = 120;
const INDENT = '  ';

function flat(value: unknown): string {
  return JSON.stringify(value);
}

function isNumberList(value: readonly unknown[]): boolean {
  return value.length > 0 && value.every((v) => typeof v === 'number');
}

function hasObject(list: readonly unknown[]): boolean {
  return list.some((v) => typeof v === 'object' && v !== null);
}

/** `column` = coluna onde o valor começa; `tail` = o que vem depois dele na mesma linha ("," ou nada). */
function print(value: unknown, indent: string, column: number, tail: number): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const inner = indent + INDENT;
    const oneLine = '[' + value.map(flat).join(', ') + ']';
    if (!hasObject(value) && column + oneLine.length + tail <= WIDTH) return oneLine;
    if (isNumberList(value)) {
      const items = value.map((n, i) => flat(n) + (i < value.length - 1 ? ',' : ''));
      const lines: string[] = [];
      let line = items[0]!;
      for (let i = 1; i < items.length; i++) {
        // O `fill` decide o separador olhando o par (anterior + próximo) a partir de onde o anterior começou.
        const start = inner.length + line.length - items[i - 1]!.length;
        if (start + items[i - 1]!.length + 1 + items[i]!.length <= WIDTH) line += ' ' + items[i];
        else {
          lines.push(line);
          line = items[i]!;
        }
      }
      lines.push(line);
      return '[\n' + lines.map((l) => inner + l).join('\n') + '\n' + indent + ']';
    }
    const parts = value.map((v, i) => inner + print(v, inner, inner.length, i < value.length - 1 ? 1 : 0));
    return '[\n' + parts.join(',\n') + '\n' + indent + ']';
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return '{}';
    const inner = indent + INDENT;
    const parts = entries.map(([k, v], i) => {
      const key = `${flat(k)}: `;
      return inner + key + print(v, inner, inner.length + key.length, i < entries.length - 1 ? 1 : 0);
    });
    return '{\n' + parts.join(',\n') + '\n' + indent + '}';
  }
  return flat(value);
}

/** Texto do arquivo (com quebra de linha no fim). */
export function prettyJson(value: unknown): string {
  return print(value, '', 0, 0) + '\n';
}
