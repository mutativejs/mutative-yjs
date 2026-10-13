# mutative-yjs

![Node CI](https://github.com/mutativejs/mutative-yjs/workflows/Node%20CI/badge.svg)
[![npm](https://img.shields.io/npm/v/mutative-yjs.svg)](https://www.npmjs.com/package/mutative-yjs)
![license](https://img.shields.io/npm/l/mutative-yjs)

A library for building Yjs collaborative web applications with Mutative.

[Mutative](https://github.com/unadlib/mutative) is a high-performance immutable data structure library for JavaScript. [Y.js](https://github.com/yjs/yjs) is a CRDT library with mutation-based API. `mutative-yjs` allows manipulating Y.js data types with the API provided by Mutative.

## Features

- 🔄 **Bidirectional Sync**: Seamlessly sync between Yjs CRDT types and plain JavaScript objects
- 🎯 **Immutable Updates**: Use Mutative's intuitive draft-based API for state updates
- 📦 **Type Safe**: Full TypeScript support with type inference
- 🚀 **Performance**: Efficient patch-based updates with structural sharing
- 🔌 **Flexible**: Customizable patch application for advanced use cases
- 📡 **Reactive**: Built-in subscription system for state changes
- ⚡ **Explicit Transactions**: Updates to Y.js are batched in transactions, you control the boundary
- 🪶 **Lightweight**: Simple, small codebase with no magic or vendor lock-in
- 🎨 **Non-intrusive**: Always opt-in by nature (snapshots are just plain objects)

## Why mutative-yjs?

**Do:**

```typescript
// any operation supported by mutative
binder.update((state) => {
  state.nested[0].key = {
    id: 123,
    p1: 'a',
    p2: ['a', 'b', 'c'],
  };
});
```

**Instead of:**

```typescript
Y.transact(state.doc, () => {
  const val = new Y.Map();
  val.set('id', 123);
  val.set('p1', 'a');

  const arr = new Y.Array();
  arr.push(['a', 'b', 'c']);
  val.set('p2', arr);

  state.get('nested').get(0).set('key', val);
});
```

## Installation

```bash
npm install mutative-yjs mutative yjs
# or
yarn add mutative-yjs mutative yjs
# or
pnpm add mutative-yjs mutative yjs
```

`mutative-yjs` requires Mutative 2. If you are upgrading from Mutative 1, see
[Upgrading to Mutative 2](#upgrading-to-mutative-2).

## Quick Start

```typescript
import * as Y from 'yjs';
import { bind } from 'mutative-yjs';

// Create a Yjs document
const doc = new Y.Doc();
const yMap = doc.getMap('data');

// Bind the Yjs data structure
const binder = bind<{ count: number; items: string[] }>(yMap);

// Initialize with data
binder.update((state) => {
  state.count = 0;
  state.items = ['apple', 'banana'];
});

// Update state using Mutative's draft API
binder.update((state) => {
  state.count++;
  state.items.push('orange');
});

// Get current snapshot
console.log(binder.get()); // { count: 1, items: ['apple', 'banana', 'orange'] }

// Subscribe to changes
const unsubscribe = binder.subscribe((snapshot) => {
  console.log('State updated:', snapshot);
});

// Changes from Yjs are automatically reflected
yMap.set('count', 5);
console.log(binder.get().count); // 5

// Clean up
unsubscribe();
binder.unbind();
```

1. `import { bind } from 'mutative-yjs'`.
2. Create a binder: `const binder = bind(doc.getMap("state"))`.
3. Add subscription to the snapshot: `binder.subscribe(listener)`.
   1. Mutations in Y.js data types will trigger snapshot subscriptions.
   2. Calling `update(...)` (similar to `create(...)` in Mutative) will update their corresponding Y.js types and also trigger snapshot subscriptions.
4. Call `binder.get()` to get the latest snapshot.
5. (Optionally) call `binder.unbind()` to release the observer.

`Y.Map` binds to plain object `{}`, `Y.Array` binds to plain array `[]`, and any level of nested `Y.Map`/`Y.Array` binds to nested plain JSON object/array respectively.

`Y.Array` cannot hold `undefined`, so `undefined` array elements and holes become `null` in Y.js and in the snapshot, as `JSON.stringify()` writes them. Other values that JSON cannot hold, such as `bigint` values and functions, make `update()` throw.

A `__proto__` key of a `Y.Map` becomes an own property of the snapshot object, as `JSON.parse()` makes it, and never replaces the prototype of the object.

`Y.XmlElement` & `Y.Text` have no equivalent to JSON data types, so they are not supported by default. If you want to use them, please use the Y.js top-level type (e.g. `doc.getText("xxx")`) directly, or see **Customize binding & schema** section below.

## Demo

[Demo Playground](https://codesandbox.io/p/sandbox/fjrwk3)

## API Reference

### `bind(source, options?)`

Binds a Yjs data type to create a binder instance.

**Parameters:**

- `source`: `Y.Map<any> | Y.Array<any>` - The Yjs data type to bind
- `options?`: `Options<S>` - Optional configuration

**Returns:** `Binder<S>` - A binder instance with methods to interact with the bound data

**Example:**

```typescript
const doc = new Y.Doc();
const yMap = doc.getMap('myData');
const binder = bind<MyDataType>(yMap);
```

### `createBinder(source, initialState, options?)`

Creates a binder with initial state in one call. This is a convenience function that combines `bind()` and initialization.

**Parameters:**

- `source`: `Y.Map<any> | Y.Array<any>` - The Yjs data type to bind
- `initialState`: `S` - The initial state to set
- `options?`: `Options<S>` - Optional configuration

**Returns:** `Binder<S>` - A binder instance with the initial state applied

**Example:**

```typescript
const doc = new Y.Doc();
const yMap = doc.getMap('myData');
const binder = createBinder(yMap, { count: 0, items: [] });
```

### Binder API

#### `binder.get()`

Returns the current snapshot of the data.

```typescript
const snapshot = binder.get();
```

#### `binder.update(fn)`

Updates the state using a Mutative draft function. Changes are applied to both the snapshot and the underlying Yjs data structure.

**Parameters:**

- `fn`: `(draft: S) => void` - A function that receives a draft state to mutate

```typescript
binder.update((state) => {
  state.user.name = 'John';
  state.items.push({ id: 1, title: 'New Item' });
});
```

#### `binder.subscribe(fn, options?)`

Subscribes to state changes. The callback is invoked when:

1. `update()` is called
2. The underlying Yjs data is modified

**Parameters:**

- `fn`: `(snapshot: S) => void` - Callback function that receives the new snapshot
- `options?`: `SubscribeOptions` - Optional subscription configuration
  - `immediate?: boolean` - If true, calls the listener immediately with current snapshot

**Returns:** `UnsubscribeFn` - A function to unsubscribe

```typescript
// Basic subscription
const unsubscribe = binder.subscribe((snapshot) => {
  console.log('State changed:', snapshot);
});

// Subscribe with immediate execution
binder.subscribe((snapshot) => {
  console.log('Current state:', snapshot);
}, { immediate: true });

// Later...
unsubscribe();
```

#### `binder.unbind()`

Releases the binder and removes the Yjs observer. Call this when you're done with the binder.

```typescript
binder.unbind();
```

## Advanced Usage

### Structural Sharing

Like Mutative, `mutative-yjs` provides efficient structural sharing. Unchanged parts of the state maintain the same reference, which is especially beneficial for React re-renders:

```typescript
const snapshot1 = binder.get();

binder.update((state) => {
  state.todos[0].done = true;
});

const snapshot2 = binder.get();

// changed properties have new references
snapshot1.todos !== snapshot2.todos;
snapshot1.todos[0] !== snapshot2.todos[0];

// unchanged properties keep the same reference
snapshot1.todos[1] === snapshot2.todos[1];
snapshot1.todos[2] === snapshot2.todos[2];
```

### Custom Patch Application

You can customize how Mutative patches are applied to Yjs data structures:

```typescript
const binder = bind<MyDataType>(yMap, {
  applyPatch: (target, patch, defaultApplyPatch) => {
    // Inspect the patch before applying
    console.log('Applying patch:', patch);

    // You can conditionally apply patches based on the path
    if (patch.path[0] === 'protected') {
      // Skip protected fields
      return;
    }

    // Delegate to default behavior
    defaultApplyPatch(target, patch);

    // Or implement custom logic
    // ...
  },
});
```

Patch values are the objects of the new snapshot, not copies, so never mutate
`patch` or `patch.value`: a change would also show up in `binder.get()`. To
write a different value to Yjs, pass a changed copy to the default handler,
such as `defaultApplyPatch(target, { ...patch, value: transform(patch.value) })`
where `transform` returns a new value.

Patches arrive in the order that Mutative generates them: the patches of a
nested draft come before those of its parents.

If `applyPatch` throws, `update()` throws the error, and the snapshot is read
back from Y.js, which keeps the patches applied before the error.

When an update inserts or removes array elements, as `shift()`, `unshift()` and
`splice()` do, `applyPatch` receives patches that add or remove these elements
instead of Mutative's patches that replace every later element. Applying them
with Mutative's `apply()` still gives the new snapshot.

### Patches Options

Configure how Mutative generates patches:

```typescript
const binder = bind<MyDataType>(yMap, {
  patchesOptions: {
    pathAsArray: true,
    arrayLengthAssignment: true,
  },
});
```

With `pathAsArray: false`, a custom `applyPatch` receives JSON Pointer paths
such as `/list/0`, which the default handler accepts as well.

Refer to [Mutative patches documentation](https://mutative.js.org/docs/advanced-guides/patches) for more details about patches options.

### Custom Transaction Origins

When `binder.update()` is wrapped in an outer Yjs transaction, Yjs uses the
outer transaction origin. Pass that origin in `skippedOrigins` so the binder can
reconcile from the final Yjs state without re-applying its own update events:

```typescript
const origin = {};
const binder = bind<MyDataType>(yMap, {
  skippedOrigins: new Set([origin]),
});

doc.transact(() => {
  binder.update((state) => {
    state.count++;
  });
}, origin);
```

`skippedOrigins` accepts an array or a `Set`. This is useful when integrating
with Yjs APIs such as `UndoManager.trackedOrigins`.

### Working with Y.Array

The library works with both `Y.Map` and `Y.Array`:

```typescript
const doc = new Y.Doc();
const yArray = doc.getArray('items');

type Item = { id: string; name: string };
const binder = bind<Item[]>(yArray);

binder.update((items) => {
  items.push({ id: '1', name: 'First Item' });
  items.push({ id: '2', name: 'Second Item' });
});

// Array operations work as expected
binder.update((items) => {
  items[0].name = 'Updated Name';
  items.splice(1, 1); // Remove second item
});
```

### Collaborative Editing Example

```typescript
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { bind } from 'mutative-yjs';

// Create document and connect to server
const doc = new Y.Doc();
const provider = new WebsocketProvider('ws://localhost:1234', 'room-name', doc);

const yMap = doc.getMap('shared-data');
const binder = bind<AppState>(yMap);

// Subscribe to remote changes
binder.subscribe((snapshot) => {
  // Update UI with new state
  renderApp(snapshot);
});

// Make local changes
function handleUserAction() {
  binder.update((state) => {
    state.todos.push({
      id: generateId(),
      text: 'New todo',
      completed: false,
    });
  });
}
```

### Integration with React

Use `useSyncExternalStoreWithSelector` for optimal React integration with selective subscriptions:

```tsx
import { bind } from 'mutative-yjs';
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector';
import * as Y from 'yjs';

// define state shape
interface State {
  todos: Array<{ id: string; text: string; done: boolean }>;
  user: { name: string; email: string };
}

const doc = new Y.Doc();

// define store
const binder = bind<State>(doc.getMap('data'));

// define a helper hook
function useMutativeYjs<Selection>(selector: (state: State) => Selection) {
  const selection = useSyncExternalStoreWithSelector(
    binder.subscribe,
    binder.get,
    binder.get,
    selector
  );

  return [selection, binder.update] as const;
}

// optionally set initial data
binder.update((state) => {
  state.todos = [];
  state.user = { name: 'Guest', email: '' };
});

// use in component
function TodoList() {
  const [todos, update] = useMutativeYjs((s) => s.todos);

  const addTodo = (text: string) => {
    update((state) => {
      state.todos.push({
        id: Math.random().toString(),
        text,
        done: false,
      });
    });
  };

  const toggleTodo = (id: string) => {
    update((state) => {
      const todo = state.todos.find((t) => t.id === id);
      if (todo) todo.done = !todo.done;
    });
  };

  // will only rerender when 'todos' array changes
  return (
    <div>
      {todos.map((todo) => (
        <div key={todo.id} onClick={() => toggleTodo(todo.id)}>
          {todo.text} {todo.done ? '✓' : '○'}
        </div>
      ))}
    </div>
  );
}

// when done
binder.unbind();
```

### Integration with Other Frameworks

Contributions welcome! Please submit sample code via PR for Vue, Svelte, Angular, or other frameworks.

## Utility Functions

### `applyJsonArray(dest, source)`

Applies a plain JavaScript array to a Y.Array.

```typescript
import { applyJsonArray } from 'mutative-yjs';
import * as Y from 'yjs';

const yArray = new Y.Array();
applyJsonArray(yArray, [1, 2, 3, { nested: 'object' }]);
```

### `applyJsonObject(dest, source)`

Applies a plain JavaScript object to a Y.Map.

```typescript
import { applyJsonObject } from 'mutative-yjs';
import * as Y from 'yjs';

const yMap = new Y.Map();
applyJsonObject(yMap, {
  key1: 'value1',
  key2: { nested: 'value' },
});
```

## Type Definitions

```typescript
type JSONPrimitive = string | number | boolean | null;
type JSONValue = JSONPrimitive | JSONObject | JSONArray;
type JSONObject = { [member: string]: JSONValue };
interface JSONArray extends Array<JSONValue> {}

type Snapshot = JSONObject | JSONArray;
type UpdateFn<S extends Snapshot> = (draft: S) => void;
type ListenerFn<S extends Snapshot> = (snapshot: S) => void;
type UnsubscribeFn = () => void;
type SkippedOrigins = readonly unknown[] | ReadonlySet<unknown>;

interface Binder<S extends Snapshot> {
  unbind: () => void;
  get: () => S;
  update: (fn: UpdateFn<S>) => void;
  subscribe: (fn: ListenerFn<S>) => UnsubscribeFn;
}

interface Options<S extends Snapshot> {
  applyPatch?: (
    target: Y.Map<any> | Y.Array<any>,
    patch: Patch,
    applyPatch: (target: Y.Map<any> | Y.Array<any>, patch: Patch) => void
  ) => void;
  patchesOptions?:
    | true
    | {
        pathAsArray?: boolean;
        arrayLengthAssignment?: boolean;
      };
  skippedOrigins?: SkippedOrigins;
}
```

## How It Works

`mutative-yjs` creates a bridge between Yjs's CRDT data structures and Mutative's immutable update patterns:

1. **Initialization**: When you bind a Yjs data type, it creates an initial snapshot
2. **Updates**: When you call `update()`, Mutative generates patches describing the changes
3. **Patch Application**: Patches are applied to the Yjs data structure, triggering sync
4. **Event Handling**: When Yjs data changes (locally or remotely), events are converted back to snapshot updates
5. **Structural Sharing**: Only modified parts of the snapshot are recreated, maintaining referential equality for unchanged data

## Performance Tips

- **Batch Updates**: Multiple changes in a single `update()` call are more efficient than multiple separate calls
- **Structural Sharing**: Unchanged parts of the state maintain referential equality, making React re-renders efficient
- **Transactions**: Updates are wrapped in Yjs transactions automatically for optimal performance
- **Unsubscribe**: Always call `unbind()` when done to prevent memory leaks
- **Search Snapshots**: Inside `update()`, every element that a search such as `find()` reads through the draft becomes a draft. To search a large array, search a `current()` snapshot, which holds plain values at the draft's indices, and change the match through the draft
- **Production Builds**: Define `process.env.NODE_ENV` as `'production'` in production bundles, as most bundlers do, so that Mutative leaves out its development checks

```typescript
import { current } from 'mutative';

binder.update((state) => {
  const index = current(state.todos).findIndex((todo) => todo.id === id);
  if (index !== -1) state.todos[index].done = true;
});
```

## Collaboration Semantics

`mutative-yjs` implements smart collaboration semantics to preserve changes from multiple collaborators:

### Array Insertions and Removals

When an update inserts or removes array elements, as `shift()`, `unshift()` and
`splice()` do, only these elements are inserted into or removed from the
`Y.Array`. The Y.js types of the other elements stay in place, so the changes
that other collaborators make to them at the same time are kept:

```typescript
binder.update((state) => {
  state.todos.shift();
});
// → Removes the first element from the Y.Array, and keeps the others
```

### Array Element Replacement

When replacing array elements with objects, the library performs **incremental updates** instead of delete+insert:

```typescript
// If both old and new values are objects
binder.update((state) => {
  state.items[0] = { ...state.items[0], name: 'Updated' };
});
// → Updates properties in-place, preserving other collaborators' changes
```

This prevents the "lost update" problem discussed in [immer-yjs#1](https://github.com/sep2/immer-yjs/issues/1).

### Circular Update Protection

The library uses transaction origins to prevent circular updates:

```typescript
const binder = bind(yMap);

binder.subscribe((snapshot) => {
  // Safe: won't cause infinite loop
  if (snapshot.count < 10) {
    binder.update((state) => {
      state.count++;
    });
  }
});
```

### Circular Reference Detection

The library detects and rejects circular object references:

```typescript
const circular: any = { a: 1 };
circular.self = circular;

binder.update((state) => {
  state.data = circular; // ❌ Throws: "Circular reference detected"
});
```

## Examples

Check out the [test file](./test/indext.test.ts) for comprehensive examples including:

- Basic binding and updates
- Array operations (splice, push, etc.)
- Nested object updates
- Subscription handling
- Custom patch application
- Collaborative scenarios

## Compatibility

- **Mutative**: ^2.0.0
- **Yjs**: >= 13.0.0
- **TypeScript**: >= 5.0, as required by the type declarations of Mutative 2
- **Node.js**: >= 14
- **Browsers**: engines with `Proxy` and ES2018 syntax, as required by Mutative 2

## Upgrading to Mutative 2

`mutative-yjs` declares `mutative@^2.0.0` as its peer dependency, so install
Mutative 2 alongside it:

```bash
npm install mutative-yjs mutative@2 yjs
```

Mutative 2 keeps the API of Mutative 1, so calls to `bind()`, `createBinder()`
and `binder.update()` need no changes. What changes for `mutative-yjs`:

- **Correct patches.** Some recipes produced patches in Mutative 1 that left
  the Y.js document out of sync with the snapshot, such as assigning a draft's
  original object back to the key that holds the draft, which deleted the key
  from Y.js. Mutative 2 fixes these patches.
- **Custom `applyPatch`.** Patch values are now the objects of the new snapshot
  instead of deep copies, and the patches of a nested draft come before those
  of its parents. Never mutate a patch; see
  [Custom Patch Application](#custom-patch-application).
- **Faster array changes.** `shift()`, `unshift()`, `splice()` and `reverse()`
  run natively on drafts, so Y.js array insertions and deletions, which the
  binder applies to the snapshot with `splice()`, are much cheaper for large
  arrays.
- **Development and production builds.** Mutative 2 selects its build from
  `process.env.NODE_ENV`, also when bundled as an ES module, and its production
  build throws coded errors such as `Minified Mutative error #18`.

The [Mutative 2 migration guide](https://mutative.js.org/docs/advanced-guides/migration-v2)
lists every change since Mutative 1.3.0.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Related Projects

- [Mutative](https://github.com/unadlib/mutative) - Efficient immutable updates with a mutable API
- [Yjs](https://github.com/yjs/yjs) - A CRDT framework for building collaborative applications

## Acknowledgments

This library bridges two powerful tools:

- **Yjs** for CRDT-based conflict-free collaborative editing
- **Mutative** for ergonomic and performant immutable state updates

## Credits

`immer-yjs` is inspired by `https://github.com/sep2/immer-yjs`.

## License

`mutative-yjs` is [MIT licensed](https://github.com/mutativejs/mutative-yjs/blob/main/LICENSE).
