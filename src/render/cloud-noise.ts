/** Deterministic, tileable multiscale value noise used by simulated clouds. */
export function cloudNoiseBytes(
  size = 128,
  seed = 0x6d2b79f5,
): Uint8Array {
  if (!Number.isInteger(size) || size < 2 || size > 512) {
    throw new RangeError('cloud noise size must be an integer in [2, 512]');
  }

  const bytes = new Uint8Array(size * size * 4);
  let state = seed >>> 0;
  if (state === 0) state = 0x6d2b79f5;
  const randomByte = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 24;
  };

  // Each channel owns a periodic lattice at a different spatial frequency.
  // Sampling the lattice with smooth interpolation produces coherent cloud
  // texture and, crucially, no hard seam when GL_REPEAT crosses an edge.
  const frequencies = [8, 16, 32, 64];
  for (let channel = 0; channel < 4; channel += 1) {
    const frequency = Math.min(frequencies[channel], Math.max(2, size / 2));
    const lattice = new Uint8Array(frequency * frequency);
    for (let i = 0; i < lattice.length; i += 1) lattice[i] = randomByte();
    const read = (x: number, y: number): number =>
      lattice[((y % frequency) + frequency) % frequency * frequency + ((x % frequency) + frequency) % frequency];
    for (let y = 0; y < size; y += 1) {
      const gy = (y / (size - 1)) * frequency;
      const y0 = Math.floor(gy);
      const ty0 = gy - y0;
      const ty = ty0 * ty0 * (3 - 2 * ty0);
      for (let x = 0; x < size; x += 1) {
        const gx = (x / (size - 1)) * frequency;
        const x0 = Math.floor(gx);
        const tx0 = gx - x0;
        const tx = tx0 * tx0 * (3 - 2 * tx0);
        const top = read(x0, y0) * (1 - tx) + read(x0 + 1, y0) * tx;
        const bottom = read(x0, y0 + 1) * (1 - tx) + read(x0 + 1, y0 + 1) * tx;
        bytes[(y * size + x) * 4 + channel] = Math.round(top * (1 - ty) + bottom * ty);
      }
    }
  }
  return bytes;
}
