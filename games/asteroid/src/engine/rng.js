export function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randFloat(rng, min, max) {
  return min + (max - min) * rng();
}

export function randInt(rng, min, maxExclusive) {
  return Math.floor(randFloat(rng, min, maxExclusive));
}

export function chooseWeighted(rng, weightedValues) {
  const total = weightedValues.reduce((sum, item) => sum + item.weight, 0);
  let roll = rng() * total;
  for (const item of weightedValues) {
    roll -= item.weight;
    if (roll <= 0) {
      return item.value;
    }
  }
  return weightedValues[weightedValues.length - 1].value;
}
