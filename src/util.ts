import * as Y from 'yjs'
import { JSONArray, JSONObject, JSONPrimitive, JSONValue } from './types'

export function isJSONPrimitive(v: JSONValue): v is JSONPrimitive {
    const t = typeof v
    return t === 'string' || t === 'number' || t === 'boolean' || v === null
}

export function isJSONArray(v: JSONValue): v is JSONArray {
    return Array.isArray(v)
}

export function isJSONObject(v: JSONValue): v is JSONObject {
    return v !== null && !isJSONArray(v) && typeof v === 'object'
}

// `ancestors` holds the objects above `v`: an object may appear at several
// places, as in Mutative patch values, which share the next state's objects.
export function toYDataType(v: JSONValue, ancestors = new WeakSet<object>()): any {
    if (isJSONPrimitive(v)) {
        return v
    } else if (isJSONArray(v)) {
        if (ancestors.has(v)) {
            throw new Error('Circular reference detected in JSON structure')
        }
        ancestors.add(v)
        const arr = new Y.Array()
        applyJsonArray(arr, v, ancestors)
        ancestors.delete(v)
        return arr
    } else if (isJSONObject(v)) {
        if (ancestors.has(v)) {
            throw new Error('Circular reference detected in JSON structure')
        }
        ancestors.add(v)
        const map = new Y.Map()
        applyJsonObject(map, v, ancestors)
        ancestors.delete(v)
        return map
    } else if (v === undefined) {
        return undefined
    } else {
        throw new Error(`Unsupported value type: ${typeof v}`)
    }
}

let nullifiedArrayItems = 0

// Y.Array cannot hold `undefined`, so `undefined` elements and holes are
// written as `null`, as JSON.stringify() writes them.
export function toYArrayItem(v: JSONValue, ancestors?: WeakSet<object>): any {
    const item = toYDataType(v, ancestors)
    if (item !== undefined) {
        return item
    }
    nullifiedArrayItems += 1
    return null
}

// The number of array items written as `null` so far, which tells whether a
// snapshot may hold `undefined` where Yjs holds `null`.
export function countNullifiedArrayItems() {
    return nullifiedArrayItems
}

export function applyJsonArray(dest: Y.Array<unknown>, source: JSONArray, ancestors = new WeakSet<object>()) {
    dest.push(Array.from(source, (item) => toYArrayItem(item, ancestors)))
}

export function applyJsonObject(dest: Y.Map<unknown>, source: JSONObject, ancestors = new WeakSet<object>()) {
    Object.entries(source).forEach(([k, v]) => {
        dest.set(k, toYDataType(v, ancestors))
    })
}

// Assigning a `__proto__` key replaces the prototype, so it is defined as an
// own property, as JSON.parse() makes it.
export function setOwnValue(object: JSONObject, key: string, value: JSONValue) {
    if (key === '__proto__') {
        Object.defineProperty(object, key, {
            value,
            writable: true,
            enumerable: true,
            configurable: true,
        })
    } else {
        object[key] = value
    }
}

// Like toJSON() of Yjs types, except that a `__proto__` key becomes an own
// property instead of replacing the prototype.
export function toPlainValue(v: Y.Map<any> | Y.Array<any> | JSONValue): JSONValue {
    if (v instanceof Y.Map) {
        const object: JSONObject = {}
        v.forEach((value, key) => {
            setOwnValue(object, key, toPlainValue(value))
        })
        return object
    } else if (v instanceof Y.Array) {
        return v.map(toPlainValue)
    } else if (v instanceof Y.AbstractType) {
        return v.toJSON()
    } else {
        return v
    }
}

// With `pathAsArray: false`, Mutative writes a patch path as a JSON Pointer.
export function toPathArray(path: string | readonly (string | number)[]) {
    if (typeof path !== 'string') {
        return path
    }
    return path
        .split('/')
        .slice(1)
        .map((step) => step.replace(/~1/g, '/').replace(/~0/g, '~'))
}

export function notImplemented(reason: string): never {
    throw new Error(`Not implemented: ${reason}`)
}
