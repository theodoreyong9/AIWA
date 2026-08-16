// public-profile-reducer.js — the missing piece a hyperprofile needs:
// nothing before this let a module declare ANY of its data as visible
// to other domains. ctx.storage (module-sandbox.js) is, and stays,
// strictly private — scoped to (this domain, this module), never
// transported. 'module-data-published' is a genuinely different DAG
// event type: durable, replicated by merge() exactly like every other
// fact in this project, folded here into a materialized view any
// domain can read once reconciled — the real foundation "visiting a
// profile" needs, not a new ad hoc channel bolted on beside H_d.
//
// Unlike module registration (module-registry.js, content-addressed,
// code immutable once bound) or a minted formula
// (formula-registry-reducer.js, permanent forever), published data is
// meant to change — a module's own "status: online" a moment ago
// shouldn't be permanent. This reducer tracks the LATEST value per
// (domain, moduleId, key), in the DAG's own deterministic fold order,
// the same "current state" discipline cadence.js and scarcity.js
// already use, not the immutable-once-set discipline the other two
// reducers use. A published value of exactly `null` retracts that key
// — an explicit, real "unpublish," not merely leaving stale data
// around forever with no way to remove it.

export function initialPublicProfileState() {
  return { data: {} }; // data[domainId][moduleId][key] = { value, publishedAt }
}

export function applyPublicProfileEvent(state, event) {
  const payload = event.payload;
  if (!payload || payload.type !== 'module-data-published') return state;

  const { domain, moduleId, key, value, at } = payload;
  if (typeof domain !== 'string' || !domain || typeof moduleId !== 'string' || !moduleId || typeof key !== 'string' || !key) {
    return state; // malformed — tolerant fold, same discipline as every other reducer in this project
  }

  const domainData = state.data[domain] ?? {};
  const moduleData = { ...(domainData[moduleId] ?? {}) };

  if (value === null) {
    delete moduleData[key]; // explicit unpublish
  } else {
    moduleData[key] = { value, publishedAt: at ?? 0 };
  }

  return { data: { ...state.data, [domain]: { ...domainData, [moduleId]: moduleData } } };
}

/**
 * registry(H_d) for published module data — mirror of
 * materializeModuleRegistry() / materializeFormulas().
 */
export function materializePublicProfiles(orderedEvents) {
  return orderedEvents.reduce(applyPublicProfileEvent, initialPublicProfileState());
}

/**
 * Convenience: everything a given domain's modules have published,
 * flattened for display — what a "visit this profile" screen actually
 * renders. Empty object if the domain has published nothing, never an
 * error — visiting a domain with no public data is a legitimate,
 * common case, not a failure.
 *
 * @param {ReturnType<typeof initialPublicProfileState>} state
 * @param {string} domainId
 * @returns {Record<string, Record<string, { value: any, publishedAt: number }>>}
 */
export function publishedDataForDomain(state, domainId) {
  return state.data[domainId] ?? {};
}
