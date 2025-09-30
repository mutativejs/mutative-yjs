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

`Y.XmlElement` & `Y.Text` have no equivalent to JSON data types, so they are not supported by default. If you want to use them, please use the Y.js top-level type (e.g. `doc.getText("xxx")`) directly, or see **Customize binding & schema** section below.

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

#### `binder.subscribe(fn)`

Subscribes to state changes. The callback is invoked when:

1. `update()` is called
2. The underlying Yjs data is modified

**Parameters:**

- `fn`: `(snapshot: S) => void` - Callback function that receives the new snapshot

**Returns:** `UnsubscribeFn` - A function to unsubscribe

```typescript
const unsubscribe = binder.subscribe((snapshot) => {
  console.log('State changed:', snapshot);
});

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
    // Inspect or modify the patch before applying
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

Refer to [Mutative patches documentation](https://mutative.js.org/docs/patches) for more details about patches options.

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

## Examples

Check out the [test file](./test/indext.test.ts) for comprehensive examples including:

- Basic binding and updates
- Array operations (splice, push, etc.)
- Nested object updates
- Subscription handling
- Custom patch application
- Collaborative scenarios

## Compatibility

- **Mutative**: >= 1.0.0
- **Yjs**: >= 13.0.0
- **TypeScript**: >= 4.5
- **Node.js**: >= 14

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Related Projects

- [Mutative](https://github.com/unadlibjs/mutative) - Efficient immutable updates with a mutable API
- [Yjs](https://github.com/yjs/yjs) - A CRDT framework for building collaborative applications

## Acknowledgments

This library bridges two powerful tools:

- **Yjs** for CRDT-based conflict-free collaborative editing
- **Mutative** for ergonomic and performant immutable state updates

## Credits

`immer-yjs` is inspired by `https://github.com/sep2/immer-yjs`.

## License

`mutative-yjs` is [MIT licensed](https://github.com/mutativejs/mutative-yjs/blob/main/LICENSE).
