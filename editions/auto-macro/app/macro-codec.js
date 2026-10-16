function writeUnsigned(value, output) {
  let current = Math.max(0, Math.round(Number(value) || 0));
  do {
    let byte = current % 128;
    current = Math.floor(current / 128);
    if (current) byte |= 128;
    output.push(byte);
  } while (current);
}

function readUnsigned(buffer, cursor) {
  let value = 0;
  let multiplier = 1;
  for (let count = 0; count < 8; count += 1) {
    if (cursor.index >= buffer.length) throw new Error('Packed mouse path ended unexpectedly.');
    const byte = buffer[cursor.index++];
    value += (byte & 127) * multiplier;
    if (!(byte & 128)) return value;
    multiplier *= 128;
  }
  throw new Error('Packed mouse path contains an invalid number.');
}

const zigzag = value => {
  const integer = Math.round(Number(value) || 0);
  return integer >= 0 ? integer * 2 : (-integer * 2) - 1;
};
const unzigzag = value => value % 2 ? -((value + 1) / 2) : value / 2;

function packPoints(points) {
  const output = [];
  let previousX = 0;
  let previousY = 0;
  for (const point of points) {
    const delay = Math.max(0, Math.round(Number(point?.[0]) || 0));
    const x = Math.round(Number(point?.[1]) || 0);
    const y = Math.round(Number(point?.[2]) || 0);
    writeUnsigned(delay, output);
    writeUnsigned(zigzag(x - previousX), output);
    writeUnsigned(zigzag(y - previousY), output);
    previousX = x;
    previousY = y;
  }
  return Buffer.from(output).toString('base64');
}

function unpackPoints(encoded, count) {
  const buffer = Buffer.from(String(encoded || ''), 'base64');
  const cursor = { index: 0 };
  const points = [];
  let x = 0;
  let y = 0;
  const total = Math.min(1000000, Math.max(0, Math.round(Number(count) || 0)));
  for (let index = 0; index < total; index += 1) {
    const delay = readUnsigned(buffer, cursor);
    x += unzigzag(readUnsigned(buffer, cursor));
    y += unzigzag(readUnsigned(buffer, cursor));
    points.push([delay, x, y]);
  }
  if (cursor.index !== buffer.length) throw new Error('Packed mouse path contains unused data.');
  return points;
}

function packMacroActions(actions) {
  return (Array.isArray(actions) ? actions : []).map(action => {
    if (action?.type !== 'move_path' || !Array.isArray(action.points) || action.points.length < 4) return action;
    const { points, ...rest } = action;
    return { ...rest, pointEncoding: 'delta-varint-v1', pointCount: points.length, packedPoints: packPoints(points) };
  });
}

function unpackMacroActions(actions) {
  return (Array.isArray(actions) ? actions : []).map(action => {
    if (action?.type !== 'move_path' || action.pointEncoding !== 'delta-varint-v1') return action;
    const { pointEncoding, pointCount, packedPoints, ...rest } = action;
    return { ...rest, points: unpackPoints(packedPoints, pointCount) };
  });
}

module.exports = { packMacroActions, unpackMacroActions };
