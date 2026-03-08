export function createRng(seed = 0x9e3779b9) {
  let state = seed >>> 0;

  return {
    nextUint32() {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return (value ^ (value >>> 14)) >>> 0;
    },
    nextFloat() {
      return this.nextUint32() / 4294967296;
    },
    nextRange(min, max) {
      return min + (max - min) * this.nextFloat();
    },
    pick(items) {
      if (!Array.isArray(items) || items.length === 0) {
        return null;
      }
      return items[Math.floor(this.nextFloat() * items.length)] ?? items[items.length - 1];
    },
    getState() {
      return state >>> 0;
    },
  };
}
