/** Algo que segura recursos e precisa ser liberado por inteiro (regra "dispose() total"). */
export interface Disposable {
  dispose(): void;
}

/** Cancela uma inscrição feita com `onX(callback)`. */
export type Unsubscribe = () => void;
