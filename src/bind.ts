import { type Patch, create } from 'mutative';
import * as Y from 'yjs';
import { JSONArray, JSONObject, JSONValue } from './types';
import {
  applyJsonArray,
  countNullifiedArrayItems,
  isJSONArray,
  isJSONObject,
  notImplemented,
  setOwnValue,
  toPathArray,
  toPlainValue,
  toYArrayItem,
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
          if (key === '__proto__' && change.action === 'add') {
            // Assigning a new `__proto__` key sets the prototype instead.
            notImplemented('Cannot add a __proto__ key to a draft');
          }
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

function isJSONEqual(a: JSONValue, b: JSONValue): boolean {
  if (a === b) return true;

  if (isJSONArray(a) && isJSONArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => isJSONEqual(item, b[index]));
  }

  if (isJSONObject(a) && isJSONObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);

    if (aKeys.length !== bKeys.length) return false;

    return aKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(b, key) &&
        isJSONEqual(a[key], b[key])
    );
  }

  return false;
}

// Replaces the `undefined` elements and holes of arrays with `null`, as Yjs
// holds them. What the previous snapshot holds at the same place is skipped,
// as snapshots never hold them.
function nullifyArrayItems<T extends JSONValue>(
  value: T,
  previous: JSONValue | undefined
): T {
  if (value === previous || value === null || typeof value !== 'object') {
    return value;
  }

  if (isJSONArray(value)) {
    const previousArray = Array.isArray(previous) ? previous : undefined;
    let copy: JSONArray | undefined;
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      const next =
        item === undefined ? null : nullifyArrayItems(item, previousArray?.[i]);
      if (next !== item) {
        copy ??= value.slice();
        copy[i] = next;
      }
    }
    return (copy ?? value) as T;
  }

  const object = value as JSONObject;
  const previousObject =
    previous !== undefined && isJSONObject(previous) ? previous : undefined;
  let copy: JSONObject | undefined;
  for (const key of Object.keys(object)) {
    const item = object[key];
    const next = nullifyArrayItems(item, previousObject?.[key]);
    if (next !== item) {
      if (!copy) {
        copy = {};
        for (const k of Object.keys(object)) {
          setOwnValue(copy, k, object[k]);
        }
      }
      setOwnValue(copy, key, next);
    }
  }
  return (copy ?? value) as T;
}

const PATCH_REPLACE = 'replace';
const PATCH_ADD = 'add';
const PATCH_REMOVE = 'remove';

// The steps of a string path are strings, also for array indices.
function toYKey(base: unknown, step: string | number) {
  return base instanceof Y.Array &&
    typeof step === 'string' &&
    step !== 'length'
    ? Number(step)
    : step;
}

function defaultApplyPatch(target: Y.Map<any> | Y.Array<any>, patch: Patch) {
  const { op, value } = patch;
  const path = toPathArray(patch.path);

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
      applyJsonArray(target, value);
    } else {
      notImplemented(
        `Cannot replace root of type ${target.constructor.name} with value type ${typeof value}`
      );
    }

    return;
  }

  let base = target;
  for (let i = 0; i < path.length - 1; i++) {
    const step = toYKey(base, path[i]);
    base = base.get(step as never);
  }

  const property = toYKey(base, path[path.length - 1]);

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
        base.insert(property, [toYArrayItem(value)]);
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
          base.insert(property, [toYArrayItem(value)]);
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

type SkippedOrigins = readonly unknown[] | ReadonlySet<unknown>;

type PatchPath = (string | number)[];

function getIn(value: unknown, path: PatchPath): unknown {
  let current = value;
  for (const step of path) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string | number, unknown>)[step];
  }
  return current;
}

function isArrayPatchOf(patch: Patch, parent: PatchPath) {
  const path = patch.path as PatchPath;
  const last = path[path.length - 1];
  return (
    path.length === parent.length + 1 &&
    (typeof last === 'number' || last === 'length') &&
    parent.every((step, index) => path[index] === step)
  );
}

// Mutative describes the patches of an array element by element: after
// shift(), every later element is replaced by the next one. Yjs would then
// rewrite every later element, and lose the changes that other clients make
// to them at the same time. When an array grows or shrinks, these patches are
// replaced with the removal or insertion of the elements between the common
// head and tail of the array, so that Yjs keeps the other elements.
function compactArrayPatches(
  run: Patch[],
  parent: PatchPath,
  previous: Snapshot,
  next: Snapshot
): Patch[] {
  const oldArray = getIn(previous, parent);
  const newArray = getIn(next, parent);
  if (
    !Array.isArray(oldArray) ||
    !Array.isArray(newArray) ||
    oldArray.length === newArray.length
  ) {
    return run;
  }

  const oldLength = oldArray.length;
  const newLength = newArray.length;
  // Mutative replaces elements, adds them past the old length, and removes
  // them past the new length.
  const replaced = new Set<number>();
  let hasLengthPatch = false;
  for (const patch of run) {
    const step = patch.path[patch.path.length - 1];
    if (patch.op === PATCH_REPLACE && typeof step === 'number') {
      replaced.add(step);
    } else if (patch.op === PATCH_REPLACE && step === 'length') {
      hasLengthPatch = true;
    } else if (
      !(
        patch.op === PATCH_ADD &&
        typeof step === 'number' &&
        step >= oldLength
      ) &&
      !(
        patch.op === PATCH_REMOVE &&
        typeof step === 'number' &&
        step >= newLength
      )
    ) {
      return run;
    }
  }
  if (replaced.size === 0) {
    return run;
  }

  // What Yjs holds at an old index once the patches of nested drafts, which
  // come before those of the array, are applied.
  const current = (index: number) =>
    index < newLength && !replaced.has(index)
      ? newArray[index]
      : oldArray[index];

  const minLength = Math.min(oldLength, newLength);
  let start = 0;
  while (start < minLength && current(start) === newArray[start]) {
    start++;
  }
  let end = 0;
  while (
    end < minLength - start &&
    current(oldLength - 1 - end) === newArray[newLength - 1 - end]
  ) {
    end++;
  }

  const removed = oldLength - start - end;
  const inserted = newLength - start - end;
  const common = Math.min(removed, inserted);
  const patches: Patch[] = [];
  for (let index = start; index < start + common; index++) {
    if (current(index) !== newArray[index]) {
      patches.push({
        op: PATCH_REPLACE,
        path: parent.concat(index),
        value: newArray[index],
      });
    }
  }
  if (removed > inserted && end === 0) {
    // Remove the tail as Mutative does.
    if (hasLengthPatch) {
      patches.push({
        op: PATCH_REPLACE,
        path: parent.concat('length'),
        value: newLength,
      });
    } else {
      for (let index = oldLength - 1; index >= newLength; index--) {
        patches.push({ op: PATCH_REMOVE, path: parent.concat(index) });
      }
    }
  } else if (removed > inserted) {
    for (let count = common; count < removed; count++) {
      patches.push({ op: PATCH_REMOVE, path: parent.concat(start + common) });
    }
  } else {
    for (let index = start + common; index < start + inserted; index++) {
      patches.push({
        op: PATCH_ADD,
        path: parent.concat(index),
        value: newArray[index],
      });
    }
  }
  return patches;
}

function* toYjsPatches(patches: Patch[], previous: Snapshot, next: Snapshot) {
  for (let index = 0; index < patches.length; ) {
    const path = patches[index].path as PatchPath;
    const last = path[path.length - 1];
    if (typeof last !== 'number' && last !== 'length') {
      yield patches[index];
      index++;
      continue;
    }
    // Mutative emits the patches of an array one after another.
    const parent = path.slice(0, -1);
    let end = index + 1;
    while (end < patches.length && isArrayPatchOf(patches[end], parent)) {
      end++;
    }
    yield* compactArrayPatches(
      patches.slice(index, end),
      parent,
      previous,
      next
    );
    index = end;
  }
}

// Mutative writes a path as a JSON Pointer with `pathAsArray: false`.
function toPathString(path: PatchPath) {
  return path
    .map((step) => `/${String(step).replace(/~/g, '~0').replace(/\//g, '~1')}`)
    .join('');
}

function applyUpdate<S extends Snapshot>(
  source: Y.Map<any> | Y.Array<any>,
  snapshot: S,
  fn: UpdateFn<S>,
  applyPatch: typeof defaultApplyPatch,
  patchesOptions: PatchesOptions
): S {
  // Array paths, which toYjsPatches() reads, are turned into strings after.
  const [nextState, patches] = create(snapshot, fn, {
    enablePatches:
      patchesOptions === true ? true : { ...patchesOptions, pathAsArray: true },
  });
  const hasStringPaths =
    patchesOptions !== true && patchesOptions?.pathAsArray === false;
  const nullifiedArrayItems = countNullifiedArrayItems();
  for (const patch of toYjsPatches(patches, snapshot, nextState)) {
    applyPatch(
      source,
      hasStringPaths
        ? { ...patch, path: toPathString(patch.path as PatchPath) }
        : patch
    );
  }
  // Yjs holds `undefined` array elements and holes as `null`, so the snapshot
  // does as well.
  return countNullifiedArrayItems() === nullifiedArrayItems
    ? nextState
    : nullifyArrayItems(nextState, snapshot);
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
   * The patch value holds the objects of the next snapshot, not copies, so
   * never mutate the patch: pass a changed copy to `applyPatch` instead.
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
  /**
   * Transaction origins whose Yjs events should be reconciled from the final
   * Yjs state instead of applied incrementally.
   * Use when binder.update() is called inside an outer doc.transact() with a
   * known origin. The nested Y.transact gets merged into the outer transaction,
   * so observeDeep fires with the outer origin instead of MUTATIVE_YJS_ORIGIN.
   */
  skippedOrigins?: SkippedOrigins;
};

/**
 * Bind y.js data type.
 * @param source The y.js data type to bind.
 * @param options Change default behavior, can be omitted.
 */
const MUTATIVE_YJS_ORIGIN = Symbol('mutative-yjs');
const MUTATIVE_YJS_TRANSACTION_META = Symbol('mutative-yjs:transaction-meta');

function markBinderUpdate(transaction: Y.Transaction, binder: object) {
  let binders = transaction.meta.get(MUTATIVE_YJS_TRANSACTION_META) as
    | Set<object>
    | undefined;

  if (!binders) {
    binders = new Set();
    transaction.meta.set(MUTATIVE_YJS_TRANSACTION_META, binders);
  }

  binders.add(binder);
}

function hasBinderUpdate(transaction: Y.Transaction, binder: object) {
  return (
    transaction.meta.get(MUTATIVE_YJS_TRANSACTION_META) as
      | Set<object>
      | undefined
  )?.has(binder);
}

function isSet(value: unknown): value is ReadonlySet<unknown> {
  return Object.prototype.toString.call(value) === '[object Set]';
}

function normalizeSkippedOrigins(skippedOrigins: SkippedOrigins | undefined) {
  if (skippedOrigins === undefined) {
    return undefined;
  }

  if (Array.isArray(skippedOrigins)) {
    return new Set(skippedOrigins);
  }

  if (isSet(skippedOrigins)) {
    return skippedOrigins;
  }

  throw new Error('skippedOrigins must be an array or a Set');
}

export function bind<S extends Snapshot>(
  source: Y.Map<any> | Y.Array<any>,
  options?: Options<S>
): Binder<S> {
  let snapshot = toPlainValue(source) as S;
  const binder = {};
  const skippedOrigins = normalizeSkippedOrigins(options?.skippedOrigins);

  const get = () => snapshot;

  const subscription = new Set<ListenerFn<S>>();

  const subscribe = (fn: ListenerFn<S>, options?: SubscribeOptions) => {
    subscription.add(fn);
    if (options?.immediate) {
      fn(get());
    }
    return () => void subscription.delete(fn);
  };

  const reconcileSnapshotFromSource = () => {
    const nextSnapshot = toPlainValue(source) as S;
    if (!isJSONEqual(snapshot, nextSnapshot)) {
      snapshot = nextSnapshot;
    }
  };

  const observer = (events: Y.YEvent<any>[], transaction: Y.Transaction) => {
    const isCurrentBinderUpdate = hasBinderUpdate(transaction, binder);

    if (isCurrentBinderUpdate) {
      if (transaction.origin !== MUTATIVE_YJS_ORIGIN) {
        reconcileSnapshotFromSource();
        subscription.forEach((fn) => fn(get()));
      }
      return;
    }

    if (skippedOrigins?.has(transaction.origin)) {
      reconcileSnapshotFromSource();
      subscription.forEach((fn) => fn(get()));
      return;
    }

    try {
      snapshot = applyYEvents(get(), events);
    } catch {
      // A change that a draft cannot take, such as a new `__proto__` key,
      // is read from the final Yjs state instead.
      reconcileSnapshotFromSource();
    }
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
      snapshot = applyUpdate(
        source,
        get(),
        fn,
        applyPatch,
        patchesOptionsInOption
      );
    };

    if (doc) {
      const isNestedTransaction =
        (doc as unknown as { _transaction: Y.Transaction | null })
          ._transaction !== null;

      try {
        Y.transact(
          doc,
          (transaction) => {
            markBinderUpdate(transaction, binder);
            doApplyUpdate();
          },
          MUTATIVE_YJS_ORIGIN
        );
      } catch (error) {
        // Yjs keeps the patches applied before the error, so read the
        // snapshot back from Yjs to stay in sync with it.
        const previousSnapshot = snapshot;
        reconcileSnapshotFromSource();
        if (!isNestedTransaction && snapshot !== previousSnapshot) {
          subscription.forEach((fn) => fn(get()));
        }
        throw error;
      }

      if (!isNestedTransaction) {
        // Notify subscribers after transaction since observer skips our origin
        subscription.forEach((fn) => fn(get()));
      }
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
