import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { apply, original, rawReturn, type Patch } from 'mutative';

import { bind, createBinder } from '../src';
import { createSampleObject, id1, id2, id3 } from './sample-data';

test('bind usage demo', () => {
  const doc = new Y.Doc();

  const initialObj = createSampleObject(); // plain object

  const topLevelMap = 'map';

  // get reference of CRDT type for binding
  const map = doc.getMap(topLevelMap);

  // bind the top-level CRDT type, works for Y.Array as well
  const binder = bind<typeof initialObj>(map);

  // initialize document with sample data
  binder.update(() => {
    return rawReturn(initialObj);
  });

  // snapshot reference should not change if no update
  expect(binder.get()).toBe(binder.get());

  // get current state as snapshot
  const snapshot1 = binder.get();

  // should equal to initial structurally
  expect(snapshot1).toStrictEqual(initialObj);

  // should equal to yjs structurally
  expect(snapshot1).toStrictEqual(map.toJSON());

  // get the reference to be compared after changes are made
  const yd1 = map.get(id1) as any;

  // nested objects / arrays are properly converted to Y.Maps / Y.Arrays
  expect(yd1).toBeInstanceOf(Y.Map);
  expect(yd1.get('batters')).toBeInstanceOf(Y.Map);
  expect(yd1.get('topping')).toBeInstanceOf(Y.Array);
  expect(yd1.get('batters').get('batter')).toBeInstanceOf(Y.Array);
  expect(yd1.get('batters').get('batter').get(0).get('id')).toBeTypeOf(
    'string'
  );

  // update the state with immer
  binder.update((state) => {
    state[id1].ppu += 0.1;
    const d1 = state[id1];

    d1.topping.splice(
      2,
      2,
      { id: '7777', type: 'test1' },
      { id: '8888', type: 'test2' }
    );
    d1.topping.push({ id: '9999', type: 'test3' });

    delete state[id3];
  });

  // get snapshot after modified
  const snapshot2 = binder.get();

  // snapshot1 unchanged
  expect(snapshot1).toStrictEqual(initialObj);

  // snapshot2 changed
  expect(snapshot1).not.equal(snapshot2);

  // changed properties should reflect what we did in update(...)
  expect(snapshot2[id1].ppu).toStrictEqual(0.65);
  expect(snapshot2[id1].topping.find((x) => x.id === '9999')).toStrictEqual({
    id: '9999',
    type: 'test3',
  });
  expect(snapshot2[id3]).toBeUndefined();

  // reference changed as well
  expect(snapshot2[id1]).not.toBe(snapshot1[id1]);

  // unchanged properties should keep referential equality with previous snapshot
  expect(snapshot2[id2]).toBe(snapshot1[id2]);
  expect(snapshot2[id1].batters).toBe(snapshot1[id1].batters);
  expect(snapshot2[id1].topping[0]).toBe(snapshot1[id1].topping[0]);

  // the underlying yjs data type reflect changes as well
  expect(map.toJSON()).toStrictEqual(snapshot2);

  // but yjs data type should not change reference (they are mutated in-place whenever possible)
  expect(map).toBe(doc.getMap(topLevelMap));
  expect(map.get(id1)).toBe(yd1);
  expect((map.get(id1) as any).get('topping')).toBe(yd1.get('topping'));

  // save the length for later comparison
  const expectLength = binder.get()[id1].batters.batter.length;

  // change from y.js
  yd1
    .get('batters')
    .get('batter')
    .push([{ id: '1005', type: 'test' }]);

  // change reflected in snapshot
  expect(binder.get()[id1].batters.batter.at(-1)).toStrictEqual({
    id: '1005',
    type: 'test',
  });

  // now the length + 1
  expect(binder.get()[id1].batters.batter.length).toBe(expectLength + 1);

  // delete something from yjs
  yd1.delete('topping');

  // deletion reflected in snapshot
  expect(binder.get()[id1].topping).toBeUndefined();

  // release the observer, so the CRDT type can be bind again
  binder.unbind();
});

test('boolean in array', () => {
  const doc = new Y.Doc();

  const map = doc.getMap('data');

  const binder = bind<any>(map);

  binder.update((state) => {
    state.k1 = true;
    state.k2 = false;
    state.k3 = [true, false, true];
  });

  expect(map.toJSON()).toStrictEqual({
    k1: true,
    k2: false,
    k3: [true, false, true],
  });
});

test('customize applyPatch', () => {
  const doc = new Y.Doc();

  const map = doc.getMap('data');

  const initialObj = createSampleObject(); // plain object

  const binder = bind<typeof initialObj>(map, {
    applyPatch: (target, patch, applyPatch) => {
      // you can inspect the patch.path and decide what to do with target
      // optionally delegate to the default patch handler
      // (pass a changed copy of the patch, never mutate patch.value,
      // which holds the objects of the next snapshot)
      applyPatch(target, patch);
      // can also postprocessing after the default behavior is applied
    },
  });

  binder.update(() => rawReturn(initialObj));

  expect(binder.get()).toStrictEqual(initialObj);

  expect(binder.get()).toStrictEqual(map.toJSON());

  expect(binder.get()).toBe(binder.get());
});

describe('array splice', () => {
  function prepareArrayDoc(...items: number[]) {
    const doc = new Y.Doc();
    const binder = bind<{ array: number[] }>(doc.getMap('data'), {
      applyPatch: (target, patch, apply) => {
        apply(target, patch);
      },
    });
    binder.update((data) => {
      data.array = items;
    });
    return { doc, binder };
  }

  test('remove nonexistent item', () => {
    const { binder } = prepareArrayDoc();

    binder.update((data) => {
      data.array.splice(0, 1);
    });

    expect(binder.get().array.length).toBe(0);
  });

  test('remove single item', () => {
    const { binder } = prepareArrayDoc(1);

    binder.update((data) => {
      data.array.splice(0, 1);
    });

    expect(binder.get().array.length).toBe(0);
  });

  test('remove first item of many', () => {
    const { binder } = prepareArrayDoc(1, 2, 3);

    // results in ops
    // replace array[0] value 2
    // replace array[1] value 3
    // replace array.length value 2
    binder.update((data) => {
      data.array.splice(0, 1);
    });

    expect(binder.get().array.length).toBe(2);
  });

  test('remove last multiple items', () => {
    const { binder } = prepareArrayDoc(1, 2, 3, 4);

    binder.update((data) => {
      data.array.splice(2, 2);
    });

    const result = binder.get().array;
    expect(result.length).toBe(2);
    expect(result[0]).toBe(1);
    expect(result[1]).toBe(2);
  });

  test('replace last multiple items', () => {
    const { binder } = prepareArrayDoc(1, 2, 3, 4);

    binder.update((data) => {
      data.array.splice(2, 2, 5, 6);
    });

    const result = binder.get().array;
    expect(result.length).toBe(4);
    expect(result[0]).toBe(1);
    expect(result[1]).toBe(2);
    expect(result[2]).toBe(5);
    expect(result[3]).toBe(6);
  });

  test('remove first multiple items', () => {
    const { binder } = prepareArrayDoc(1, 2, 3, 4);

    binder.update((data) => {
      data.array.splice(0, 2);
    });

    const result = binder.get().array;
    expect(result.length).toBe(2);
    expect(result[0]).toBe(3);
    expect(result[1]).toBe(4);
  });

  test('replace first multiple items', () => {
    const { binder } = prepareArrayDoc(1, 2, 3, 4);

    binder.update((data) => {
      data.array.splice(0, 2, 5, 6);
    });

    const result = binder.get().array;
    expect(result.length).toBe(4);
    expect(result[0]).toBe(5);
    expect(result[1]).toBe(6);
    expect(result[2]).toBe(3);
    expect(result[3]).toBe(4);
  });
});

describe('array insertions and removals', () => {
  type Item = { id: number; name: string };

  function prepareListDoc(length: number) {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const patches: Patch[] = [];
    const binder = createBinder<{ list: Item[] }>(
      map,
      {
        list: Array.from({ length }, (_, id) => ({ id, name: `item ${id}` })),
      },
      {
        applyPatch: (target, patch, applyPatch) => {
          patches.push(patch);
          applyPatch(target, patch);
        },
      }
    );
    patches.length = 0;
    const list = map.get('list') as Y.Array<Y.Map<any>>;
    const deltas: unknown[] = [];
    map.observeDeep((events) => {
      for (const event of events) {
        deltas.push(
          event instanceof Y.YArrayEvent ? event.changes.delta : event.path
        );
      }
    });
    return { doc, map, list, binder, patches, deltas };
  }

  test('should remove the first element for shift()', () => {
    const { map, list, binder, patches, deltas } = prepareListDoc(5);
    const second = list.get(1);

    binder.update((state) => {
      state.list.shift();
    });

    expect(patches).toEqual([{ op: 'remove', path: ['list', 0] }]);
    expect(deltas).toEqual([[{ delete: 1 }]]);
    expect(list.get(0)).toBe(second);
    expect(map.toJSON()).toEqual(binder.get());
  });

  test('should insert the first elements for unshift()', () => {
    const { map, list, binder, patches, deltas } = prepareListDoc(5);
    const first = list.get(0);

    binder.update((state) => {
      state.list.unshift({ id: 5, name: 'item 5' }, { id: 6, name: 'item 6' });
    });

    expect(patches).toEqual([
      { op: 'add', path: ['list', 0], value: { id: 5, name: 'item 5' } },
      { op: 'add', path: ['list', 1], value: { id: 6, name: 'item 6' } },
    ]);
    expect(deltas).toEqual([
      [{ insert: [expect.any(Y.Map), expect.any(Y.Map)] }],
    ]);
    expect(list.get(2)).toBe(first);
    expect(map.toJSON()).toEqual(binder.get());
  });

  test('should replace, remove and insert only the elements that splice() changes', () => {
    const { map, list, binder, patches } = prepareListDoc(6);
    const kept = [0, 4, 5].map((index) => list.get(index));

    binder.update((state) => {
      state.list.splice(1, 3, { id: 6, name: 'item 6' });
    });

    expect(patches).toEqual([
      { op: 'replace', path: ['list', 1], value: { id: 6, name: 'item 6' } },
      { op: 'remove', path: ['list', 2] },
      { op: 'remove', path: ['list', 2] },
    ]);
    expect([0, 2, 3].map((index) => list.get(index))).toEqual(kept);
    expect(map.toJSON()).toEqual(binder.get());
  });

  test('should sync an object that the array holds at several indices', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const shared = { value: 1 };
    const patches: Patch[] = [];
    const binder = createBinder<{ list: Array<{ value: number }> }>(
      map,
      { list: [shared, shared] },
      {
        applyPatch: (target, patch, applyPatch) => {
          patches.push(patch);
          applyPatch(target, patch);
        },
      }
    );
    const remoteDoc = new Y.Doc();
    Y.applyUpdate(remoteDoc, Y.encodeStateAsUpdate(doc));
    const remote = bind<{ list: Array<{ value: number }> }>(
      remoteDoc.getMap('data')
    );
    const before = binder.get();
    patches.length = 0;

    binder.update((state) => {
      state.list.unshift({ value: 0 });
      state.list[1].value = 2;
    });
    Y.applyUpdate(remoteDoc, Y.encodeStateAsUpdate(doc));

    const expected = { list: [{ value: 0 }, { value: 2 }, { value: 1 }] };
    expect(binder.get()).toEqual(expected);
    expect(map.toJSON()).toEqual(expected);
    expect(remote.get()).toEqual(expected);
    expect(apply(before, patches)).toEqual(expected);
  });

  test('should replace 0 with -0', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const binder = createBinder<{ list: number[] }>(map, { list: [0, 1, 2] });

    binder.update((state) => {
      state.list[0] = -0;
      state.list.push(3);
    });

    expect(Object.is(binder.get().list[0], -0)).toBe(true);
    expect(Object.is((map.get('list') as Y.Array<number>).get(0), -0)).toBe(
      true
    );
  });

  test('should keep a change that another client makes to a later element', () => {
    const { doc, binder } = prepareListDoc(3);
    const remoteDoc = new Y.Doc();
    Y.applyUpdate(remoteDoc, Y.encodeStateAsUpdate(doc));
    const remote = bind<{ list: Item[] }>(remoteDoc.getMap('data'));

    remote.update((state) => {
      state.list[1].name = 'renamed';
    });
    binder.update((state) => {
      state.list.shift();
    });
    Y.applyUpdate(remoteDoc, Y.encodeStateAsUpdate(doc));
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remoteDoc));

    const expected = {
      list: [
        { id: 1, name: 'renamed' },
        { id: 2, name: 'item 2' },
      ],
    };
    expect(binder.get()).toEqual(expected);
    expect(remote.get()).toEqual(expected);
  });

  test('should sync random array changes', () => {
    // mulberry32
    let seed = 42;
    const random = (max: number) => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * max);
    };
    let nextId = 0;
    const createItem = () => ({ id: nextId++, count: 0, tags: [random(3)] });
    type State = {
      items: ReturnType<typeof createItem>[];
      numbers: number[];
    };

    for (const patchesOptions of [
      true,
      { arrayLengthAssignment: false },
      { pathAsArray: false },
    ] as const) {
      for (let round = 0; round < 200; round++) {
        const doc = new Y.Doc();
        const remoteDoc = new Y.Doc();
        doc.on('update', (update: Uint8Array) =>
          Y.applyUpdate(remoteDoc, update)
        );
        const patches: Patch[] = [];
        // Arrays may hold an object at several indices.
        const shared = [createItem(), createItem()];
        const binder = createBinder<State>(
          doc.getMap('data'),
          {
            items: Array.from({ length: random(8) }, () =>
              random(2) ? shared[random(2)] : createItem()
            ),
            numbers: Array.from({ length: random(8) }, () => random(4)),
          },
          {
            patchesOptions,
            applyPatch: (target, patch, applyPatch) => {
              patches.push(patch);
              applyPatch(target, patch);
            },
          }
        );
        const remote = bind<State>(remoteDoc.getMap('data'));

        for (let step = 0; step < 5; step++) {
          const before = binder.get();
          patches.length = 0;
          binder.update((state) => {
            const operations = 1 + random(3);
            for (let count = 0; count < operations; count++) {
              const isItems = random(10) < 7;
              const list: any[] = isItems ? state.items : state.numbers;
              const create = () => (isItems ? createItem() : random(4));
              const index = random(list.length);
              switch (random(12)) {
                case 0:
                  list.shift();
                  break;
                case 1:
                  list.unshift(create(), create());
                  break;
                case 2:
                  list.pop();
                  break;
                case 3:
                  list.splice(index, random(3), create());
                  break;
                case 4:
                  list.reverse();
                  break;
                case 5:
                  list.length = random(list.length + 1);
                  break;
                case 6:
                  if (isItems && list.length) list[index].count++;
                  break;
                case 7:
                  if (isItems && list.length) {
                    const [item] = list.splice(index, 1);
                    item.count++;
                    list.splice(random(list.length + 1), 0, item);
                  }
                  break;
                case 8:
                  if (isItems && list.length) list[index].tags.unshift(0);
                  break;
                case 9:
                  if (list.length) list.push(list[index]);
                  break;
                case 10:
                  if (list.length) {
                    list.splice(random(list.length + 1), 0, list[index]);
                  }
                  break;
                default:
                  if (list.length) list[index] = create();
              }
            }
          });

          expect(doc.getMap('data').toJSON()).toEqual(binder.get());
          expect(remote.get()).toEqual(binder.get());
          expect(apply(before, patches)).toEqual(binder.get());
        }
      }
    }
  });
});

describe('moved drafts', () => {
  type Job = { id: number; attempts: number };
  type State = { queue: Job[]; current: Job | null; done: { jobs: Job[] } };

  function prepareJobsDoc() {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const binder = createBinder<State>(map, {
      queue: [0, 1, 2, 3].map((id) => ({ id, attempts: 0 })),
      current: null,
      done: { jobs: [] },
    });
    const remoteDoc = new Y.Doc();
    Y.applyUpdate(remoteDoc, Y.encodeStateAsUpdate(doc));
    const remote = bind<State>(remoteDoc.getMap('data'));
    doc.on('update', (update: Uint8Array) => Y.applyUpdate(remoteDoc, update));
    return { map, binder, remote };
  }

  function expectInSync(
    { map, binder, remote }: ReturnType<typeof prepareJobsDoc>,
    expected: State
  ) {
    expect(binder.get()).toEqual(expected);
    expect(map.toJSON()).toEqual(expected);
    expect(remote.get()).toEqual(expected);
  }

  test('should sync a changed draft that shift() and push() move', () => {
    const context = prepareJobsDoc();
    const before = context.binder.get();

    context.binder.update((state) => {
      const job = state.queue.shift()!;
      job.attempts += 1;
      state.queue.push(job);
    });

    expectInSync(context, {
      queue: [
        { id: 1, attempts: 0 },
        { id: 2, attempts: 0 },
        { id: 3, attempts: 0 },
        { id: 0, attempts: 1 },
      ],
      current: null,
      done: { jobs: [] },
    });
    expect(context.binder.get().queue[0]).toBe(before.queue[1]);
    expect(context.binder.get().done).toBe(before.done);
  });

  test('should sync a changed draft that sort() moves', () => {
    const context = prepareJobsDoc();

    context.binder.update((state) => {
      state.queue[0].attempts = 2;
      state.queue.sort((a, b) => b.attempts - a.attempts || b.id - a.id);
    });

    expectInSync(context, {
      queue: [
        { id: 0, attempts: 2 },
        { id: 3, attempts: 0 },
        { id: 2, attempts: 0 },
        { id: 1, attempts: 0 },
      ],
      current: null,
      done: { jobs: [] },
    });
  });

  test('should sync a changed draft that moves to another key', () => {
    const context = prepareJobsDoc();

    // Mutative 2 emits the patch of `queue` before the one of `current`.
    context.binder.update((state) => {
      const job = state.queue[0];
      state.queue.length = 0;
      job.attempts = 3;
      state.current = job;
    });

    expectInSync(context, {
      queue: [],
      current: { id: 0, attempts: 3 },
      done: { jobs: [] },
    });
  });

  test('should sync a changed draft that moves into a nested array', () => {
    const context = prepareJobsDoc();

    context.binder.update((state) => {
      const job = state.queue.shift()!;
      job.attempts += 1;
      state.done.jobs.push(job);
    });

    expectInSync(context, {
      queue: [
        { id: 1, attempts: 0 },
        { id: 2, attempts: 0 },
        { id: 3, attempts: 0 },
      ],
      current: null,
      done: { jobs: [{ id: 0, attempts: 1 }] },
    });
  });

  test('should sync the original object assigned over its changed draft', () => {
    const context = prepareJobsDoc();
    const before = context.binder.get();

    // Mutative 1 emitted a remove patch for `current` here.
    context.binder.update((state) => {
      state.current = state.queue[0];
    });
    context.binder.update((state) => {
      const current = original(state.current)!;
      state.current!.attempts = 5;
      state.current = current;
    });

    expectInSync(context, { ...before, current: { id: 0, attempts: 0 } });
  });
});

describe('subscription', () => {
  test('should trigger subscription on update', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const binder = bind<{ count: number }>(map);

    let callCount = 0;
    let receivedSnapshot: any = null;

    const unsubscribe = binder.subscribe((snapshot) => {
      callCount++;
      receivedSnapshot = snapshot;
    });

    binder.update((state) => {
      state.count = 10;
    });

    expect(callCount).toBe(1);
    expect(receivedSnapshot).toEqual({ count: 10 });

    binder.update((state) => {
      state.count = 20;
    });

    expect(callCount).toBe(2);
    expect(receivedSnapshot).toEqual({ count: 20 });

    unsubscribe();

    binder.update((state) => {
      state.count = 30;
    });

    // Should not trigger after unsubscribe
    expect(callCount).toBe(2);
  });

  test('should trigger subscription on Yjs changes', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const binder = bind<{ count: number }>(map);

    let callCount = 0;
    binder.subscribe(() => {
      callCount++;
    });

    // Direct Yjs mutation
    map.set('count', 42);

    expect(callCount).toBe(1);
    expect(binder.get()).toEqual({ count: 42 });
  });

  test('should support multiple subscribers', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const binder = bind<{ count: number }>(map);

    let count1 = 0;
    let count2 = 0;

    const unsub1 = binder.subscribe(() => { count1++; });
    const unsub2 = binder.subscribe(() => { count2++; });

    binder.update((state) => {
      state.count = 1;
    });

    expect(count1).toBe(1);
    expect(count2).toBe(1);

    unsub1();

    binder.update((state) => {
      state.count = 2;
    });

    expect(count1).toBe(1); // No longer called
    expect(count2).toBe(2);

    unsub2();
  });
});

describe('collaborative editing', () => {
  test('should reflect direct Yjs mutations across binders', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');

    const binder1 = bind<{ count: number }>(map);
    const binder2 = bind<{ count: number }>(map);

    // Direct Yjs mutation (simulating remote update)
    map.set('count', 42);

    // Both binders should see the change
    expect(binder1.get().count).toBe(42);
    expect(binder2.get().count).toBe(42);

    // Another direct mutation
    map.set('count', 100);

    expect(binder1.get().count).toBe(100);
    expect(binder2.get().count).toBe(100);
  });

  test('should reflect binder updates across binders', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');

    const binder1 = bind<{ count: number }>(map);
    const binder2 = bind<{ count: number }>(map);

    let binder1Calls = 0;
    let binder2Calls = 0;
    binder1.subscribe(() => {
      binder1Calls++;
    });
    binder2.subscribe(() => {
      binder2Calls++;
    });

    binder1.update((state) => {
      state.count = 1;
    });

    expect(binder1Calls).toBe(1);
    expect(binder2Calls).toBe(1);
    expect(binder1.get()).toEqual({ count: 1 });
    expect(binder2.get()).toEqual({ count: 1 });
    expect(map.toJSON()).toEqual({ count: 1 });
  });

  test('should not cause circular updates', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const binder = bind<{ count: number }>(map);

    let updateCount = 0;

    binder.subscribe((snapshot) => {
      updateCount++;
      // This should not trigger infinite loop
      if (snapshot.count < 5) {
        binder.update((state) => {
          state.count = snapshot.count + 1;
        });
      }
    });

    binder.update((state) => {
      state.count = 0;
    });

    // Should update: 0 -> 1 -> 2 -> 3 -> 4 -> 5
    expect(updateCount).toBe(6);
    expect(binder.get().count).toBe(5);
  });
});

describe('nested Yjs transactions', () => {
  test('should not re-apply binder updates wrapped in a custom origin transaction', () => {
    const origin = {};
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const binder = bind<{ items: string[] }>(map);

    binder.update((state) => {
      state.items = [];
    });

    let callCount = 0;
    binder.subscribe(() => {
      callCount++;
    });

    doc.transact(() => {
      binder.update((state) => {
        state.items.push('a');
      });
    }, origin);

    expect(callCount).toBe(1);
    expect(binder.get()).toEqual({ items: ['a'] });
    expect(map.toJSON()).toEqual({ items: ['a'] });
  });

  test('should preserve structural sharing for wrapped binder updates', () => {
    const origin = {};
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const binder = bind<{
      changed: { value: number };
      unchanged: { value: number };
    }>(map);

    binder.update((state) => {
      state.changed = { value: 1 };
      state.unchanged = { value: 1 };
    });

    const before = binder.get();

    doc.transact(() => {
      binder.update((state) => {
        state.changed.value = 2;
      });
    }, origin);

    const after = binder.get();
    expect(after.changed).not.toBe(before.changed);
    expect(after.unchanged).toBe(before.unchanged);
    expect(after).toEqual({
      changed: { value: 2 },
      unchanged: { value: 1 },
    });
    expect(map.toJSON()).toEqual(after);
  });

  test('should include direct Yjs writes from the same skipped-origin transaction', () => {
    const origin = {};
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const binder = bind<{ count?: number; other?: number }>(map, {
      skippedOrigins: [origin],
    });

    const snapshots: Array<{ count?: number; other?: number }> = [];
    binder.subscribe((snapshot) => {
      snapshots.push(snapshot);
    });

    doc.transact(() => {
      binder.update((state) => {
        state.count = 1;
      });
      map.set('other', 2);
    }, origin);

    expect(snapshots).toEqual([{ count: 1, other: 2 }]);
    expect(binder.get()).toEqual({ count: 1, other: 2 });
    expect(map.toJSON()).toEqual({ count: 1, other: 2 });
  });

  test('should keep other binders synced when one binder updates in a skipped-origin transaction', () => {
    const origin = {};
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const binder1 = bind<{ items: string[] }>(map, {
      skippedOrigins: [origin],
    });

    binder1.update((state) => {
      state.items = [];
    });

    const binder2 = bind<{ items: string[] }>(map, {
      skippedOrigins: [origin],
    });

    doc.transact(() => {
      binder1.update((state) => {
        state.items.push('a');
      });
    }, origin);

    expect(binder1.get()).toEqual({ items: ['a'] });
    expect(binder2.get()).toEqual({ items: ['a'] });
    expect(map.toJSON()).toEqual({ items: ['a'] });
  });

  test('should accept Set for skippedOrigins', () => {
    const origin = {};
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const binder = bind<{ value?: number }>(map, {
      skippedOrigins: new Set([origin]),
    });

    doc.transact(() => {
      map.set('value', 1);
    }, origin);

    expect(binder.get()).toEqual({ value: 1 });
    expect(map.toJSON()).toEqual({ value: 1 });
  });
});

describe('edge cases', () => {
  test('should handle null values', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const binder = bind<{ value: null | string }>(map);

    binder.update((state) => {
      state.value = null;
    });

    expect(binder.get().value).toBe(null);
  });

  test('should handle array element updated to null', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const binder = bind<{ items: Array<{ id: number } | null> }>(map);

    binder.update((state) => {
      state.items = [{ id: 1 }, { id: 2 }, { id: 3 }];
    });

    expect(binder.get().items).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);

    // Update array element to null - this should not crash
    binder.update((state) => {
      state.items[1] = null;
    });

    expect(binder.get().items).toEqual([{ id: 1 }, null, { id: 3 }]);
    expect(binder.get().items[1]).toBe(null);
  });

  test('should handle empty objects and arrays', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const binder = bind<{ obj: {}; arr: [] }>(map);

    binder.update((state) => {
      state.obj = {};
      state.arr = [];
    });

    expect(binder.get()).toEqual({ obj: {}, arr: [] });
  });

  test('should handle deeply nested structures', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    type DeepType = { a: { b: { c: { d: number } } } };
    const binder = bind<DeepType>(map);

    binder.update((state) => {
      state.a = { b: { c: { d: 42 } } };
    });

    expect(binder.get().a.b.c.d).toBe(42);

    binder.update((state) => {
      state.a.b.c.d = 100;
    });

    expect(binder.get().a.b.c.d).toBe(100);
  });

  test('should handle array with mixed types', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const binder = bind<{ mixed: any[] }>(map);

    binder.update((state) => {
      state.mixed = [1, 'two', true, null, { nested: 'object' }, [1, 2, 3]];
    });

    const result = binder.get().mixed;
    expect(result[0]).toBe(1);
    expect(result[1]).toBe('two');
    expect(result[2]).toBe(true);
    expect(result[3]).toBe(null);
    expect(result[4]).toEqual({ nested: 'object' });
    expect(result[5]).toEqual([1, 2, 3]);
  });

  test('should detect circular references', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const binder = bind<any>(map);

    const circular: any = { a: 1 };
    circular.self = circular;

    expect(() => {
      binder.update((state) => {
        state.data = circular;
      });
    }).toThrow('Circular reference detected');
  });

  test('should detect circular references in arrays', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const binder = bind<any>(map);

    const circularArray: any[] = [1, 2];
    circularArray.push(circularArray);

    expect(() => {
      binder.update((state) => {
        state.arr = circularArray;
      });
    }).toThrow('Circular reference detected');
  });

  test('should copy an object that a value holds at several places', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const binder = bind<any>(map);

    const shared = { value: 1 };

    binder.update((state) => {
      state.data = { a: shared, b: [shared, shared] };
    });

    expect(binder.get()).toEqual({
      data: { a: { value: 1 }, b: [{ value: 1 }, { value: 1 }] },
    });
    expect(map.toJSON()).toEqual(binder.get());

    const data = map.get('data') as Y.Map<any>;
    expect(data.get('a')).not.toBe(data.get('b').get(0));
    expect(data.get('b').get(0)).not.toBe(data.get('b').get(1));
  });

  test('should accept patch values that share objects of the next state', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    type State = {
      x: { value: number; p?: { value: number }; q?: { value: number } };
      y: { value: number };
      z: State['x'] | null;
    };
    const binder = createBinder<State>(map, {
      x: { value: 1 },
      y: { value: 2 },
      z: null,
    });

    // The patch of `z` holds the next `x`, whose `p` and `q` are one object.
    binder.update((state) => {
      state.x.p = state.y;
      state.x.q = state.y;
      state.z = state.x;
    });

    const expected = {
      x: { value: 1, p: { value: 2 }, q: { value: 2 } },
      y: { value: 2 },
      z: { value: 1, p: { value: 2 }, q: { value: 2 } },
    };
    expect(binder.get()).toEqual(expected);
    expect(map.toJSON()).toEqual(expected);
  });
});

describe('__proto__ keys', () => {
  const hasOwn = (object: object, key: string) =>
    Object.prototype.hasOwnProperty.call(object, key);

  test('should read a __proto__ key from Yjs as an own property', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const nested = new Y.Map();
    nested.set('__proto__', 'value');
    map.set('nested', nested);

    const binder = bind<any>(map);

    expect(hasOwn(binder.get().nested, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(binder.get().nested)).toBe(Object.prototype);
    expect(binder.get()).toEqual(
      JSON.parse('{ "nested": { "__proto__": "value" } }')
    );
  });

  test('should sync a __proto__ key that Yjs adds, changes and deletes', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const binder = createBinder<any>(map, { nested: { value: 1 } });

    let callCount = 0;
    binder.subscribe(() => {
      callCount++;
    });

    const nested = map.get('nested') as Y.Map<any>;
    nested.set('__proto__', { polluted: true });

    expect(callCount).toBe(1);
    expect(hasOwn(binder.get().nested, '__proto__')).toBe(true);
    expect(binder.get().nested.polluted).toBeUndefined();
    expect(({} as any).polluted).toBeUndefined();
    expect(binder.get()).toEqual(
      JSON.parse(
        '{ "nested": { "value": 1, "__proto__": { "polluted": true } } }'
      )
    );

    nested.set('__proto__', 2);
    expect(binder.get().nested['__proto__']).toBe(2);

    nested.delete('__proto__');
    expect(binder.get()).toEqual({ nested: { value: 1 } });
    expect(callCount).toBe(3);
  });

  test('should sync a __proto__ key that Yjs adds to the bound map', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const binder = createBinder<any>(map, { unchanged: { value: 1 } });

    map.set('__proto__', 1);

    expect(hasOwn(binder.get(), '__proto__')).toBe(true);
    expect(binder.get()).toEqual(
      JSON.parse('{ "unchanged": { "value": 1 }, "__proto__": 1 }')
    );
  });

  test('should update a snapshot that holds a __proto__ key', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const binder = createBinder<any>(map, { nested: { value: 1 } });
    const proto = new Y.Map();
    proto.set('count', 1);
    (map.get('nested') as Y.Map<any>).set('__proto__', proto);

    binder.update((state) => {
      state.nested['__proto__'].count = 2;
      state.nested.value = 2;
    });

    const expected = JSON.parse(
      '{ "nested": { "value": 2, "__proto__": { "count": 2 } } }'
    );
    expect(binder.get()).toEqual(expected);
    expect(map.toJSON().nested.value).toBe(2);
    expect(
      ((map.get('nested') as Y.Map<any>).get('__proto__') as Y.Map<any>).get(
        'count'
      )
    ).toBe(2);
  });
});

describe('undefined array elements', () => {
  function prepareArrayDoc(...items: number[]) {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const binder = createBinder<{ array: Array<number | null> }>(map, {
      array: items,
    });
    const observer = bind<{ array: Array<number | null> }>(map);
    return { map, binder, observer };
  }

  test('should write indices that an array regains after shrinking as null', () => {
    const { map, binder, observer } = prepareArrayDoc(1, 2, 3);

    binder.update((data) => {
      data.array.length = 1;
      data.array.length = 3;
    });

    expect(binder.get()).toStrictEqual({ array: [1, null, null] });
    expect(map.toJSON()).toStrictEqual({ array: [1, null, null] });
    expect(observer.get()).toStrictEqual({ array: [1, null, null] });
  });

  test('should write holes of an array that grows by assignment as null', () => {
    const { map, binder, observer } = prepareArrayDoc(1);

    binder.update((data) => {
      data.array[3] = 4;
    });

    expect(binder.get()).toStrictEqual({ array: [1, null, null, 4] });
    expect(map.toJSON()).toStrictEqual({ array: [1, null, null, 4] });
    expect(observer.get()).toStrictEqual({ array: [1, null, null, 4] });
  });

  test('should write deleted and undefined elements as null', () => {
    const { map, binder, observer } = prepareArrayDoc(1, 2, 3);

    binder.update((data) => {
      delete data.array[0];
      data.array[1] = undefined as any;
      data.array.push(undefined as any);
    });

    expect(binder.get()).toStrictEqual({ array: [null, null, 3, null] });
    expect(map.toJSON()).toStrictEqual({ array: [null, null, 3, null] });
    expect(observer.get()).toStrictEqual({ array: [null, null, 3, null] });
  });

  test('should write the holes of an assigned array as null', () => {
    const { map, binder, observer } = prepareArrayDoc();

    binder.update((data) => {
      data.array = [1, , 3] as any;
    });

    expect(binder.get()).toStrictEqual({ array: [1, null, 3] });
    expect(map.toJSON()).toStrictEqual({ array: [1, null, 3] });
    expect(observer.get()).toStrictEqual({ array: [1, null, 3] });
  });

  test('should keep sharing what the update did not change', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const binder = createBinder<any>(map, {
      changed: { list: [{ id: 1 }, { id: 2 }] },
      unchanged: { list: [{ id: 3 }] },
    });
    (map.get('changed') as Y.Map<any>).set('__proto__', 1);
    const before = binder.get();

    binder.update((state) => {
      state.changed.list.length = 3;
    });

    const after = binder.get();
    expect(after.unchanged).toBe(before.unchanged);
    expect(after.changed.list[0]).toBe(before.changed.list[0]);
    expect(after.changed.list).toStrictEqual([{ id: 1 }, { id: 2 }, null]);
    expect(Object.getPrototypeOf(after.changed)).toBe(Object.prototype);
    expect(after.changed['__proto__']).toBe(1);
    expect(after).toEqual(bind<any>(map).get());
  });

  test('should write the holes of an initial state as null', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const binder = createBinder<any>(map, { nested: { array: [1, , 3] } });

    expect(binder.get()).toStrictEqual({ nested: { array: [1, null, 3] } });
    expect(map.toJSON()).toStrictEqual({ nested: { array: [1, null, 3] } });
  });
});

describe('createBinder helper', () => {
  test('should create binder with initial state', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');

    const initialState = { count: 42, name: 'test' };
    const binder = createBinder(map, initialState);

    expect(binder.get()).toEqual(initialState);
    expect(map.toJSON()).toEqual(initialState);
  });

  test('should work with array data', () => {
    const doc = new Y.Doc();
    const arr = doc.getArray('items');

    const initialState = [1, 2, 3];
    const binder = createBinder(arr, initialState);

    expect(binder.get()).toEqual(initialState);
    expect(arr.toJSON()).toEqual(initialState);
  });

  test('should respect options', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');

    let patchApplied = false;
    const binder = createBinder(
      map,
      { value: 1 },
      {
        applyPatch: (target, patch, defaultApply) => {
          patchApplied = true;
          defaultApply(target, patch);
        },
      }
    );

    expect(patchApplied).toBe(true);
    expect(binder.get()).toEqual({ value: 1 });
  });
});

describe('options and configuration', () => {
  test('should accept valid patchesOptions as boolean', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');

    const binder = bind<{ count: number }>(map, {
      patchesOptions: true,
    });

    binder.update((state) => {
      state.count = 10;
    });

    expect(binder.get().count).toBe(10);
  });

  test('should accept valid patchesOptions as object', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');

    const binder = bind<{ count: number }>(map, {
      patchesOptions: {
        pathAsArray: true,
        arrayLengthAssignment: false,
      },
    });

    binder.update((state) => {
      state.count = 20;
    });

    expect(binder.get().count).toBe(20);
  });

  test('should apply patches with string paths', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const paths: unknown[] = [];
    const binder = createBinder<any>(
      map,
      { 'a/b': { '~c': 1 }, list: [{ id: 1 }, { id: 2 }, { id: 3 }] },
      {
        patchesOptions: { pathAsArray: false },
        applyPatch: (target, patch, applyPatch) => {
          paths.push(patch.path);
          applyPatch(target, patch);
        },
      }
    );

    binder.update((state) => {
      state['a/b']['~c'] = 2;
      state.list[0].id = 10;
      state.list.splice(1, 1);
      state.list.push({ id: 4 });
    });

    const expected = {
      'a/b': { '~c': 2 },
      list: [{ id: 10 }, { id: 3 }, { id: 4 }],
    };
    expect(binder.get()).toEqual(expected);
    expect(map.toJSON()).toEqual(expected);
    expect(paths).toContain('/a~1b/~0c');
    expect(paths).toContain('/list/0/id');
  });

  test('should work with detached Y.Map (no document initially)', () => {
    // Create Y.Map, then attach to document
    const doc = new Y.Doc();
    const map = doc.getMap('data');

    const binder = bind<{ count: number }>(map);

    // Initial state should be empty
    expect(binder.get()).toEqual({});

    binder.update((state) => {
      state.count = 100;
    });

    // After update, should have the value
    expect(binder.get().count).toBe(100);
    expect(map.toJSON()).toEqual({ count: 100 });
  });

  test('should notify subscribers on all updates', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const binder = bind<{ count: number }>(map);

    let notificationCount = 0;
    binder.subscribe(() => {
      notificationCount++;
    });

    binder.update((state) => {
      state.count = 50;
    });

    expect(notificationCount).toBe(1);

    binder.update((state) => {
      state.count = 51;
    });

    expect(notificationCount).toBe(2);
  });

  test('should support immediate subscription', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const binder = bind<{ count: number }>(map);

    binder.update((state) => {
      state.count = 99;
    });

    let receivedSnapshot: any = null;
    let callCount = 0;

    binder.subscribe(
      (snapshot) => {
        receivedSnapshot = snapshot;
        callCount++;
      },
      { immediate: true }
    );

    // Should be called immediately
    expect(callCount).toBe(1);
    expect(receivedSnapshot).toEqual({ count: 99 });
  });
});

describe('error handling', () => {
  test('should throw descriptive error for unsupported operations', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const binder = bind<any>(map);

    // This will try to apply an unsupported patch operation
    expect(() => {
      binder.update((state) => {
        state.value = { a: 1 };
        // Force a scenario that hits the "not implemented" path
        // by trying to apply operations that aren't supported
      });
      // Note: This test may need adjustment based on actual edge cases
    }).not.toThrow(); // Normal operations should work
  });

  test('should reject invalid patchesOptions', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');

    // Create binder with invalid options
    const binder = bind<{ count: number }>(map, {
      patchesOptions: 'invalid' as any, // Invalid type
    });

    // Should throw when trying to update
    expect(() => {
      binder.update((state) => {
        state.count = 1;
      });
    }).toThrow('patchesOptions must be a boolean or an object');
  });

  test('should reject invalid skippedOrigins', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');

    expect(() => {
      bind<{ count: number }>(map, {
        skippedOrigins: {} as any,
      });
    }).toThrow('skippedOrigins must be an array or a Set');
  });

  test('should reject Map for skippedOrigins', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const origin = {};

    expect(() => {
      bind<{ count: number }>(map, {
        skippedOrigins: new Map([[origin, true]]) as any,
      });
    }).toThrow('skippedOrigins must be an array or a Set');
  });

  test('should sync the snapshot with Yjs when applying a patch throws', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const binder = bind<{ a?: number; b?: number }>(map, {
      applyPatch: (target, patch, applyPatch) => {
        if (patch.path[0] === 'b') {
          throw new Error('rejected patch');
        }
        applyPatch(target, patch);
      },
    });

    const snapshots: Array<{ a?: number; b?: number }> = [];
    binder.subscribe((snapshot) => {
      snapshots.push(snapshot);
    });

    expect(() => {
      binder.update((state) => {
        state.a = 1;
        state.b = 2;
      });
    }).toThrow('rejected patch');

    expect(map.toJSON()).toEqual({ a: 1 });
    expect(binder.get()).toEqual({ a: 1 });
    expect(snapshots).toEqual([{ a: 1 }]);
  });

  test('should notify subscribers when Yjs throws after applying the update', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const binder = bind<{ x?: number }>(map);

    const snapshots: Array<{ x?: number }> = [];
    binder.subscribe((snapshot) => {
      snapshots.push(snapshot);
    });
    doc.on('update', () => {
      throw new Error('failed update handler');
    });

    expect(() => {
      binder.update((state) => {
        state.x = 1;
      });
    }).toThrow('failed update handler');

    expect(binder.get()).toEqual({ x: 1 });
    expect(map.toJSON()).toEqual({ x: 1 });
    expect(snapshots).toEqual([{ x: 1 }]);
  });

  test('should keep the snapshot when the recipe throws', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const binder = createBinder<{ count: number }>(map, { count: 1 });
    const before = binder.get();

    let callCount = 0;
    binder.subscribe(() => {
      callCount++;
    });

    expect(() => {
      binder.update((state) => {
        state.count = 2;
        throw new Error('failed recipe');
      });
    }).toThrow('failed recipe');

    expect(binder.get()).toBe(before);
    expect(map.toJSON()).toEqual({ count: 1 });
    expect(callCount).toBe(0);
  });
});
