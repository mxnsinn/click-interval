const { packMacroActions, unpackMacroActions } = require('./macro-codec');

const points = Array.from({ length: 565 }, (_, index) => [index % 3, 500 + Math.round(Math.sin(index / 12) * 260), 350 + Math.round(Math.cos(index / 15) * 180)]);
const actions = [{ type: 'move_path', relative: false, quality: 'ultra', playback_hz: 240, points }];
const oldPrettyBytes = Buffer.byteLength(JSON.stringify({ actions }, null, 2));
const packed = packMacroActions(actions);
const packedBytes = Buffer.byteLength(JSON.stringify({ actions: packed }));
const unpacked = unpackMacroActions(packed);
if (JSON.stringify(unpacked) !== JSON.stringify(actions)) throw new Error('Packed mouse path did not round-trip exactly.');
if (packedBytes >= oldPrettyBytes * 0.2) throw new Error(`Packed path is not compact enough: ${packedBytes}/${oldPrettyBytes}`);
console.log(JSON.stringify({ passed: true, points: points.length, oldPrettyBytes, packedBytes, reductionPercent: Math.round((1 - packedBytes / oldPrettyBytes) * 100) }, null, 2));
