import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import terser from '@rollup/plugin-terser';
import { dts } from 'rollup-plugin-dts';
import pkg from './package.json';

const input = './dist/index.js';

export default [
  {
    input,
    output: [
      {
        format: 'cjs',
        exports: 'auto',
        file: 'dist/index.cjs',
        sourcemap: true,
      },
      {
        format: 'es',
        file: 'dist/index.esm.js',
        sourcemap: true,
      },
      {
        format: 'umd',
        name: pkg.name
          .split('-')
          .map(([s, ...rest]) => [s.toUpperCase(), ...rest].join(''))
          .join(''),
        file: pkg.unpkg,
        sourcemap: true,
        globals: {
          mutative: 'Mutative',
          yjs: 'Yjs',
        },
        exports: 'named',
      },
    ],
    plugins: [
      resolve(),
      commonjs(),
      replace({
        __DEV__: 'false',
        preventAssignment: true,
      }),
      terser(),
    ],
    external: ['mutative', 'yjs'],
  },
  {
    // One declaration file for each module kind, without relative imports,
    // which Node.js resolution would need with extensions.
    input: './dist/types/index.d.ts',
    output: [
      { file: 'dist/index.d.ts', format: 'es' },
      { file: 'dist/index.d.cts', format: 'es' },
    ],
    plugins: [dts()],
    external: ['mutative', 'yjs'],
  },
];
