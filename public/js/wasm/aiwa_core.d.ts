/* tslint:disable */
/* eslint-disable */
/**
* Thin wasm-bindgen wrapper around EventDagCore. Its only job is
* converting between JsValue and serde_json::Value at the JS/Rust
* boundary — all actual logic lives in core.rs, where it is unit
* tested natively. This wrapper is intentionally untested here: it has
* no logic of its own, and JsValue calls require a real JS/wasm host to
* run, which is not available in a plain `cargo test`.
*
* Must remain interchangeable with the pure JavaScript EventDag
* (public/js/core/event-dag.js): same API contract, same
* content-addressed id for the same inputs.
*/
export class EventDag {
  free(): void;
/**
* @returns {string}
*/
  topoOrderJson(): string;
/**
*/
  constructor();
/**
* @returns {number}
*/
  size(): number;
/**
* @param {EventDag} other
*/
  merge(other: EventDag): void;
/**
* @param {(string)[]} parents
* @param {any} payload
* @returns {string}
*/
  addEvent(parents: (string)[], payload: any): string;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_eventdag_free: (a: number) => void;
  readonly eventdag_addEvent: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly eventdag_merge: (a: number, b: number) => void;
  readonly eventdag_new: () => number;
  readonly eventdag_size: (a: number) => number;
  readonly eventdag_topoOrderJson: (a: number, b: number) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_exn_store: (a: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {SyncInitInput} module
*
* @returns {InitOutput}
*/
export function initSync(module: SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {InitInput | Promise<InitInput>} module_or_path
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: InitInput | Promise<InitInput>): Promise<InitOutput>;
