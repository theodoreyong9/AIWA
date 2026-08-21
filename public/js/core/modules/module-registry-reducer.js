// module-registry-reducer.js — closes a real gap found by the user
// asking a simple, correct question: "la liste doit être accessible là
// où les codes sont accessibles." Until this file, ModuleRegistryState
// was a standalone object with no propagation mechanism at all — Earth
// registering a module told Mars nothing, ever, under any condition.
// Every other piece of durable state in this project (cadence, accrual,
// conservation, identity cost) is a materialized view over H_d,
// propagated for free by EventDag#merge() and folded deterministically
// by topoOrder(). This file makes the module registry the same
// kind of thing, instead of the one piece of state that quietly wasn't.
//
// Three event payload types, dispatched like every other reducer in
// economics/: 'module-register', 'module-update', 'module-audit'. Each
// wraps the corresponding pure function already built and tested in
// module-registry.js — no new validation logic here, only the fold.

import { registerModule, updateModuleCode, setAuditStatus, initialModuleRegistryState } from './module-registry.js';

/**
 * Folds one DAG event into the module registry state. Non-module event
 * types (e.g. 'cadence', 'accrual', 'genesis') pass through unchanged —
 * this reducer, like cadence.js and g.js, only reacts to the payload
 * shapes it owns.
 *
 * Determinism note: registerModule() takes a `now` timestamp used
 * only for the record's informational `registeredAt` field, never for
 * any decision logic. To keep materialization a pure function of H_d
 * alone, `now` here is taken from the EVENT's own declared `at` field
 * (set by whoever submitted it), never from the wall clock at fold
 * time — two replicas folding the same event set in different orders,
 * or at different real times, must still converge to bit-identical
 * state.
 *
 * @param {import('./module-registry.js').ModuleRegistryState} state
 * @param {{ id: string, parents: string[], payload: any }} event
 * @returns {import('./module-registry.js').ModuleRegistryState}
 */
export function applyModuleEvent(state, event) {
  const payload = event.payload;
  if (!payload || typeof payload.type !== 'string') return state;

  if (payload.type === 'module-register') {
    const { type, at, ...entry } = payload;
    const result = registerModule(state, entry, { now: at ?? 0 });
    return result.state; // rejections (duplicate id, bad economic config) leave state unchanged, same as cadence.js's tolerant-fold pattern
  }

  if (payload.type === 'module-update') {
    const result = updateModuleCode(state, { id: payload.id, codeHash: payload.codeHash, codeUrl: payload.codeUrl });
    return result.state;
  }

  if (payload.type === 'module-audit') {
    const result = setAuditStatus(state, payload.id, payload.status);
    return result.state;
  }

  return state;
}

/**
 * A = registry(H_d): folds a topologically-ordered event list (e.g.
 * from EventDag#topoOrder()) into the module registry — the same shape
 * as materializeCadence()/materializeG(), so it composes with the rest
 * of the app identically: build history locally under partition, merge
 * DAGs when reconnected, re-fold, converge deterministically.
 *
 * @param {Array<{ id: string, parents: string[], payload: any }>} orderedEvents
 */
export function materializeModuleRegistry(orderedEvents) {
  return orderedEvents.reduce(applyModuleEvent, initialModuleRegistryState());
}
