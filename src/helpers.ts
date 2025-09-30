import * as Y from 'yjs';
import { rawReturn } from 'mutative';
import { bind, type Binder, type Options } from './bind';
import type { Snapshot } from './bind';

/**
 * Creates a binder with initial state in one call.
 * This is a convenience function that combines bind() and update().
 *
 * @param source The Yjs data type to bind
 * @param initialState The initial state to set
 * @param options Optional configuration for the binder
 * @returns A binder instance with the initial state applied
 *
 * @example
 * ```ts
 * const doc = new Y.Doc();
 * const map = doc.getMap('data');
 * const binder = createBinder(map, { count: 0, items: [] });
 * ```
 */
export function createBinder<S extends Snapshot>(
  source: Y.Map<any> | Y.Array<any>,
  initialState: S,
  options?: Options<S>
): Binder<S> {
  const binder = bind<S>(source, options);
  binder.update(() => {
    // Use rawReturn for performance when returning non-draft values
    return rawReturn(initialState);
  });
  return binder;
}
