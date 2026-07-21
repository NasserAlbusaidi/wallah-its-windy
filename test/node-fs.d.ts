/**
 * node-fs.d.ts — minimal ambient typing for the one Node builtin the integration
 * tests use. The project deliberately does NOT depend on
 * @types/node (dev deps are capped at vite/typescript/vitest), so this declares
 * only the `node:fs` surface used by test/integration-bins.test.ts. `readFileSync`
 * returns a Uint8Array (Node's Buffer is a Uint8Array subclass), which exposes the
 * `.buffer/.byteOffset/.byteLength` the test needs to hand parseBin an ArrayBuffer.
 */
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
  export function readFileSync(path: string, encoding: 'utf8'): string;
}

declare module 'node:crypto' {
  interface Hash {
    update(data: string): Hash;
    digest(encoding: 'hex'): string;
  }
  export function createHash(algorithm: 'sha256'): Hash;
}
