// Small numeric helpers shared by the offline scripts and the evaluation.
export const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

export const norm = (a) => Math.sqrt(dot(a, a));

/** @returns {Float32Array} a new unit-length copy of `a` */
export const normalize = (a) => {
  const n = norm(a);
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = n > 0 ? a[i] / n : 0;
  return out;
};

export const cosine = (a, b) => {
  const na = norm(a), nb = norm(b);
  return na > 0 && nb > 0 ? dot(a, b) / (na * nb) : 0;
};

/** numerically stable softmax */
export const softmax = (xs) => {
  const m = Math.max(...xs);
  const es = xs.map((x) => Math.exp(x - m));
  const s = es.reduce((a, b) => a + b, 0);
  return es.map((e) => e / s);
};

/** round every element to `d` decimals */
export const roundAll = (xs, d = 6) => xs.map((x) => Math.round(x * 10 ** d) / 10 ** d);

const f = (x, d = 4) => (Number.isInteger(x) ? x.toFixed(d) : x.toFixed(d));

export const fmt = f;
