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
    return !isJSONArray(v) && typeof v === 'object'
}

export function toYDataType(v: JSONValue, seen = new WeakSet<object>()): any {
    if (isJSONPrimitive(v)) {
        return v
    } else if (isJSONArray(v)) {
        if (seen.has(v)) {
            throw new Error('Circular reference detected in JSON structure')
        }
        seen.add(v)
        const arr = new Y.Array()
        applyJsonArray(arr, v, seen)
        return arr
    } else if (isJSONObject(v)) {
        if (seen.has(v)) {
            throw new Error('Circular reference detected in JSON structure')
        }
        seen.add(v)
        const map = new Y.Map()
        applyJsonObject(map, v, seen)
        return map
    } else {
        return undefined
    }
}

export function applyJsonArray(dest: Y.Array<unknown>, source: JSONArray, seen = new WeakSet<object>()) {
    dest.push(source.map((item) => toYDataType(item, seen)))
}

export function applyJsonObject(dest: Y.Map<unknown>, source: JSONObject, seen = new WeakSet<object>()) {
    Object.entries(source).forEach(([k, v]) => {
        dest.set(k, toYDataType(v, seen))
    })
}

export function toPlainValue(v: Y.Map<any> | Y.Array<any> | JSONValue) {
    if (v instanceof Y.Map || v instanceof Y.Array) {
        return v.toJSON() as JSONObject | JSONArray
    } else {
        return v
    }
}

export function notImplemented(reason: string): never {
    throw new Error(`Not implemented: ${reason}`)
}
