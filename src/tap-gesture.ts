/**
 * tap-gesture.ts — distinguish an intentional map tap from drag/pinch input.
 */

interface PointerSample {
  id: number;
  x: number;
  y: number;
  atMs: number;
  moved: boolean;
}

export class TapGesture {
  private pointers = new Map<number, PointerSample>();

  constructor(
    private readonly moveTolerancePx = 10,
    private readonly maxDurationMs = 600,
  ) {}

  start(id: number, x: number, y: number, atMs: number): void {
    // A second contact means pinch/zoom or multi-touch, never storm genesis.
    if (this.pointers.size > 0) {
      for (const pointer of this.pointers.values()) pointer.moved = true;
    }
    this.pointers.set(id, { id, x, y, atMs, moved: this.pointers.size > 0 });
  }

  move(id: number, x: number, y: number): void {
    const pointer = this.pointers.get(id);
    if (!pointer) return;
    if (Math.hypot(x - pointer.x, y - pointer.y) > this.moveTolerancePx) {
      pointer.moved = true;
    }
  }

  end(id: number, x: number, y: number, atMs: number): boolean {
    const pointer = this.pointers.get(id);
    this.pointers.delete(id);
    if (!pointer) return false;
    const moved =
      pointer.moved ||
      Math.hypot(x - pointer.x, y - pointer.y) > this.moveTolerancePx;
    return !moved && atMs - pointer.atMs <= this.maxDurationMs;
  }

  cancel(id: number): void {
    this.pointers.delete(id);
  }
}

