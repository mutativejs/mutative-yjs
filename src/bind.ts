import { type Patch, create } from 'mutative';
import * as Y from 'yjs';

import { JSONArray, JSONObject, JSONValue } from './types';
import {
  isJSONArray,
  isJSONObject,
  notImplemented,
  toPlainValue,
  toYDataType,
} from './util';

export type Snapshot = JSONObject | JSONArray;

/**
 * Applies Yjs events to a base object.
 * IMPORTANT: `base` must be a Mutative draft object. Direct mutations
 * are safe only within a Mutative draft context.
 * @param base The draft object to mutate (from Mutative's create)
 * @param event The Yjs event describing the change
 */
function applyYEvent<T extends JSONValue>(base: T, event: Y.YEvent<any>) {
  if (event instanceof Y.YMapEvent && isJSONObject(base)) {
    const source = event.target as Y.Map<any>;

    event.changes.keys.forEach((change, key) => {
      switch (change.action) {
        case 'add':
        case 'update':
          base[key] = toPlainValue(source.get(key));
          break;
        case 'delete':
          delete base[key];
          break;
      }
    });
  } else if (event instanceof Y.YArrayEvent && isJSONArray(base)) {
    const arr = base as unknown as any[];

    let retain = 0;
    event.changes.delta.forEach((change) => {
      if (change.retain) {
        retain += change.retain;
      }
      if (change.delete) {
        arr.splice(retain, change.delete);
      }
      if (change.insert) {
        if (Array.isArray(change.insert)) {
          arr.splice(retain, 0, ...change.insert.map(toPlainValue));
        } else {
          arr.splice(retain, 0, toPlainValue(change.insert));
        }
        retain += change.insert.length;
      }
    });
  }
}

function applyYEvents<S extends Snapshot>(
  snapshot: S,
  events: Y.YEvent<any>[]
) {
  return create(snapshot, (target) => {
    for (const event of events) {
      const base = event.path.reduce((obj, step) => {
        return (obj as Record<string, any>)[step];
      }, target);

      applyYEvent(base, event);
    }
  });
}

const PATCH_REPLACE = 'replace';
const PATCH_ADD = 'add';
const PATCH_REMOVE = 'remove';

function defaultApplyPatch(target: Y.Map<any> | Y.Array<any>, patch: Patch) {
  const { path, op, value } = patch;

  if (!path.length) {
    if (op !== PATCH_REPLACE) {
      notImplemented(`Cannot apply ${op} operation to root level`);
    }

    if (target instanceof Y.Map && isJSONObject(value)) {
      target.clear();
      for (const k in value) {
        target.set(k, toYDataType(value[k]));
      }
    } else if (target instanceof Y.Array && isJSONArray(value)) {
      target.delete(0, target.length);
      target.push(value.map((v) => toYDataType(v)));
    } else {
      notImplemented(
        `Cannot replace root of type ${target.constructor.name} with value type ${typeof value}`
      );
    }

    return;
  }

  let base = target;
  for (let i = 0; i < path.length - 1; i++) {
    const step = path[i];
    base = base.get(step as never);
  }

  const property = path[path.length - 1];

  if (base instanceof Y.Map && typeof property === 'string') {
    switch (op) {
      case PATCH_ADD:
      case PATCH_REPLACE:
        base.set(property, toYDataType(value));
        break;
      case PATCH_REMOVE:
        base.delete(property);
        break;
    }
  } else if (base instanceof Y.Array && typeof property === 'number') {
    switch (op) {
      case PATCH_ADD:
        base.insert(property, [toYDataType(value)]);
        break;
      case PATCH_REPLACE:
        // If both old and new values are objects, try incremental update
        // to preserve other collaborators' changes
        const oldValue = base.get(property);
        if (oldValue instanceof Y.Map && isJSONObject(value)) {
          // Incremental update: update properties instead of replacing
          oldValue.clear();
          Object.entries(value).forEach(([k, v]) => {
            oldValue.set(k, toYDataType(v));
          });
        } else {
          // For primitives or type changes, do full replacement
          base.delete(property, 1);
          base.insert(property, [toYDataType(value)]);
        }
        break;
      case PATCH_REMOVE:
        base.delete(property, 1);
        break;
    }
  } else if (base instanceof Y.Array && property === 'length') {
    if (value < base.length) {
      // Shrink array
      const diff = base.length - value;
      base.delete(value, diff);
    } else if (value > base.length) {
      // Expand array with null values
      const toAdd = new Array(value - base.length).fill(null);
      base.push(toAdd);
    }
  } else {
    notImplemented(
      `Unsupported patch operation: ${op} on ${base?.constructor?.name ?? 'unknown'}.${String(property)}`
    );
  }
}

export type UpdateFn<S extends Snapshot> = (draft: S) => void;

type PatchesOptions =
  | true
  | {
      pathAsArray?: boolean;
      arrayLengthAssignment?: boolean;
    };

function applyUpdate<S extends Snapshot>(
  source: Y.Map<any> | Y.Array<any>,
  snapshot: S,
  fn: UpdateFn<S>,
  applyPatch: typeof defaultApplyPatch,
  patchesOptions: PatchesOptions
): S {
  const [nextState, patches] = create(snapshot, fn, {
    enablePatches: patchesOptions,
  });
  for (const patch of patches) {
    applyPatch(source, patch);
  }
  return nextState;
}

export type ListenerFn<S extends Snapshot> = (snapshot: S) => void;
export type UnsubscribeFn = () => void;

export type SubscribeOptions = {
  /**
   * If true, the listener will be called immediately with the current snapshot.
   * @default false
   */
  immediate?: boolean;
};

export type Binder<S extends Snapshot> = {
  /**
   * Release the binder.
   */
  unbind: () => void;

  /**
   * Return the latest snapshot.
   */
  get: () => S;

  /**
   * Update the snapshot as well as the corresponding y.js data.
   * Same usage as `create` from `Mutative`.
   */
  update: (fn: UpdateFn<S>) => void;

  /**
   * Subscribe to snapshot update, fired when:
   *   1. User called update(fn).
   *   2. y.js source.observeDeep() fired.
   * @param fn Listener function that receives the new snapshot
   * @param options Optional configuration for subscription behavior
   */
  subscribe: (fn: ListenerFn<S>, options?: SubscribeOptions) => UnsubscribeFn;
};

export type Options<S extends Snapshot> = {
  /**
   * Customize Mutative patch application.
   * Should apply patch to the target y.js data.
   * @param target The y.js data to be modified.
   * @param patch The patch that should be applied, please refer to 'Mutative' patch documentation.
   * @param applyPatch the default behavior to apply patch, call this to handle the normal case.
   */
  applyPatch?: (
    target: Y.Map<any> | Y.Array<any>,
    patch: Patch,
    applyPatch: typeof defaultApplyPatch
  ) => void;
  /**
   * Customize Mutative patches options.
   * @param options The options that should be applied, please refer to 'Mutative' patches options documentation.
   */
  patchesOptions?: PatchesOptions;
};

/**
 * Bind y.js data type.
 * @param source The y.js data type to bind.
 * @param options Change default behavior, can be omitted.
 */
const MUTATIVE_YJS_ORIGIN = Symbol('mutative-yjs');

export function bind<S extends Snapshot>(
  source: Y.Map<any> | Y.Array<any>,
  options?: Options<S>
): Binder<S> {
  let snapshot = source.toJSON() as S;

  const get = () => snapshot;

  const subscription = new Set<ListenerFn<S>>();

  const subscribe = (fn: ListenerFn<S>, options?: SubscribeOptions) => {
    subscription.add(fn);
    if (options?.immediate) {
      fn(get());
    }
    return () => void subscription.delete(fn);
  };

  const observer = (events: Y.YEvent<any>[], transaction: Y.Transaction) => {
    // Skip events originated from this binder to prevent circular updates
    if (transaction.origin === MUTATIVE_YJS_ORIGIN) return;

    snapshot = applyYEvents(get(), events);
    subscription.forEach((fn) => fn(get()));
  };

  source.observeDeep(observer);
  const unbind = () => source.unobserveDeep(observer);

  const applyPatchInOption = options ? options.applyPatch : undefined;

  const applyPatch = applyPatchInOption
    ? (target: Y.Map<any> | Y.Array<any>, patch: Patch) =>
        applyPatchInOption(target, patch, defaultApplyPatch)
    : defaultApplyPatch;

  const update = (fn: UpdateFn<S>) => {
    const doc = source.doc;

    const patchesOptionsInOption = options
      ? (options.patchesOptions ?? true)
      : true;

    if (
      patchesOptionsInOption !== true &&
      patchesOptionsInOption !== null &&
      typeof patchesOptionsInOption !== 'object'
    ) {
      throw new Error('patchesOptions must be a boolean or an object');
    }

    const doApplyUpdate = () => {
      snapshot = applyUpdate(source, get(), fn, applyPatch, patchesOptionsInOption);
    };

    if (doc) {
      Y.transact(doc, doApplyUpdate, MUTATIVE_YJS_ORIGIN);
      // Notify subscribers after transaction since observer skips our origin
      subscription.forEach((fn) => fn(get()));
    } else {
      // Without doc, manually update snapshot and notify subscribers
      doApplyUpdate();
      subscription.forEach((fn) => fn(get()));
    }
  };

  return {
    unbind,
    get,
    update,
    subscribe,
  };
}
