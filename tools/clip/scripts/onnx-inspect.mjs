// Minimal, dependency-free ONNX ModelProto reader: prints graph inputs/outputs (name, elem_type, shape),
// opset, producer and a node op-type histogram. Parses protobuf wire format by hand (no ML libs needed).
import { readFileSync } from 'node:fs';

const TYPE = {1:'float32',2:'uint8',3:'int8',4:'uint16',5:'int16',6:'int32',7:'int64',8:'string',9:'bool',10:'float16',11:'double',12:'uint32',13:'uint64',14:'complex64',16:'bfloat16',17:'float8e4m3fn',18:'float8e4m3fnuz',19:'float8e5m2',20:'float8e5m2fnuz'};

function readVarint(buf, pos) {
  let result = 0n, shift = 0n;
  for (;;) {
    const b = buf[pos++];
    if (b === undefined) throw new Error(`truncated varint at ${pos - 1}`);
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7n;
  }
  return [result, pos];
}
// Yields [fieldNumber, wireType, value] where value is BigInt for varint/fixed, [start,end] for len-delimited.
function* fields(buf, start, end) {
  let pos = start;
  while (pos < end) {
    let tag; [tag, pos] = readVarint(buf, pos);
    const field = Number(tag >> 3n), wt = Number(tag & 7n);
    if (wt === 0) { let v; [v, pos] = readVarint(buf, pos); yield [field, wt, v]; }
    else if (wt === 1) { yield [field, wt, buf.subarray(pos, pos + 8)]; pos += 8; }
    else if (wt === 2) { let len; [len, pos] = readVarint(buf, pos); yield [field, wt, buf.subarray(pos, pos + Number(len))]; pos += Number(len); }
    else if (wt === 5) { yield [field, wt, buf.subarray(pos, pos + 4)]; pos += 4; }
    else throw new Error(`unsupported wire type ${wt} at ${pos}`);
  }
}
const str = (b) => Buffer.from(b).toString('utf8');
const dimValue = (b) => {
  // TensorShapeProto.Dimension: field 1 = dim_value (varint), field 2 = dim_param (string)
  for (const [f, , v] of fields(b, 0, b.length)) {
    if (f === 1) return Number(v);
    if (f === 2) return str(v);
  }
  return '?';
};
function valueInfo(b) {
  // ValueInfoProto: 1 = name, 2 = TypeProto
  let name = '?', et = '?', dims = [];
  for (const [f, , v] of fields(b, 0, b.length)) {
    if (f === 1) name = str(v);
    if (f === 2) for (const [f2, , v2] of fields(v, 0, v.length)) if (f2 === 1) { // tensor_type
      for (const [f3, , v3] of fields(v2, 0, v2.length)) {
        if (f3 === 1) et = TYPE[Number(v3)] ?? Number(v3);
        if (f3 === 2) for (const [f4, , v4] of fields(v3, 0, v3.length)) if (f4 === 1) dims.push(dimValue(v4));
      }
    }
  }
  return { name, type: et, shape: dims };
}
function shapeStr(vi) { return `${vi.type} [${vi.shape.map((d) => (typeof d === 'number' ? d : `"${d}"`)).join(',')}]`; }

for (const path of process.argv.slice(2)) {
  const buf = readFileSync(path);
  let ir = 0, producer = '', domain = '', opset = 0, graph = null, doc = '';
  for (const [f, , v] of fields(buf, 0, buf.length)) {
    if (f === 1) ir = Number(v);
    if (f === 2) producer = str(v);
    if (f === 8) { for (const [f2, , v2] of fields(v, 0, v.length)) { if (f2 === 1) domain = str(v2); if (f2 === 2) opset = Number(v2); } }
    if (f === 7) graph = v;
    if (f === 6) doc = str(v);
  }
  let inputs = [], outputs = [], nNodes = 0, ops = {}, inits = 0, initTypes = {};
  for (const [f, , v] of fields(graph, 0, graph.length)) {
    if (f === 11) inputs.push(valueInfo(v));
    if (f === 12) outputs.push(valueInfo(v));
    if (f === 5) { inits++; for (const [f2, , v2] of fields(v, 0, v.length)) if (f2 === 2) { const t = TYPE[Number(v2)]; initTypes[t] = (initTypes[t] || 0) + 1; } }
    if (f === 1) { nNodes++; for (const [f2, , v2] of fields(v, 0, v.length)) if (f2 === 4) { const op = str(v2); ops[op] = (ops[op] || 0) + 1; } }
  }
  console.log(`== ${path} (${buf.length} bytes)`);
  console.log(`ir_version=${ir} producer="${producer}" opset ${domain}:${opset} nodes=${nNodes} initializers=${inits} ${JSON.stringify(initTypes)}`);
  console.log('inputs :', inputs.map((i) => `${i.name}: ${shapeStr(i)}`).join(' | '));
  console.log('outputs:', outputs.map((i) => `${i.name}: ${shapeStr(i)}`).join(' | '));
  console.log('ops    :', Object.entries(ops).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}x${n}`).join(' '));
  if (doc.trim()) console.log('doc    :', doc.trim().slice(0, 600));
}
