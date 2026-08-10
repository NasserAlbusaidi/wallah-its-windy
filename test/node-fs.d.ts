/**
 * node-fs.d.ts — minimal ambient typing for the one Node builtin the file-reading
 * tests use (e.g. test/integration-bins.test.ts, test/texture-fit.test.ts, and
 * others). The project deliberately does NOT depend on
 * @types/node (dev deps are capped at vite/typescript/vitest), so this declares
 * only the `node:fs` surface those tests need. `readFileSync`
 * returns a Uint8Array (Node's Buffer is a Uint8Array subclass), which exposes the
 * `.buffer/.byteOffset/.byteLength` a test needs to hand parseBin an ArrayBuffer.
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
