export class AssetQrMatrixError extends Error {
  constructor(message = 'Payload Asset QR tidak valid.') {
    super(message);
    this.name = 'AssetQrMatrixError';
  }
}

export const ASSET_QR_VERSION = 8;
export const ASSET_QR_SIZE = ASSET_QR_VERSION * 4 + 17;
export const ASSET_QR_QUIET_ZONE = 4;
export const ASSET_QR_ERROR_CORRECTION = 'H' as const;
export const ASSET_QR_MAX_PAYLOAD_BYTES = 84;
export const ASSET_QR_PUBLIC_PATH_PREFIX = '/q/';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function normalizeAssetQrPublicOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new AssetQrMatrixError('Origin public Asset QR tidak valid.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.pathname !== '' && url.pathname !== '/')) {
    throw new AssetQrMatrixError('Origin public Asset QR harus berupa origin HTTP(S) tanpa path, query, atau credential.');
  }
  return url.origin;
}

function configuredAssetQrPublicOrigin(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> }).env ?? {};
  const configured = typeof env.VITE_PUBLIC_SCAN_ORIGIN === 'string' ? env.VITE_PUBLIC_SCAN_ORIGIN.trim() : '';
  if (configured !== '') return normalizeAssetQrPublicOrigin(configured);
  if (env.MODE === 'test') return 'https://smartlab.test';
  if (env.DEV === true && typeof window !== 'undefined' && window.location.origin) {
    return normalizeAssetQrPublicOrigin(window.location.origin);
  }
  throw new AssetQrMatrixError('VITE_PUBLIC_SCAN_ORIGIN wajib dikonfigurasi sebelum QR Asset dapat dicetak.');
}

export function buildAssetQrPublicUrl(publicId: string, origin = configuredAssetQrPublicOrigin()): string {
  if (!isUuid(publicId)) throw new AssetQrMatrixError('Public Asset QR identifier tidak valid.');
  const url = `${normalizeAssetQrPublicOrigin(origin)}${ASSET_QR_PUBLIC_PATH_PREFIX}${publicId.toLowerCase()}`;
  if (new TextEncoder().encode(url).length > ASSET_QR_MAX_PAYLOAD_BYTES) {
    throw new AssetQrMatrixError(`URL public Asset QR melebihi kapasitas QR v${ASSET_QR_VERSION}-H.`);
  }
  return url;
}

function assetQrPayload(value: string): string {
  return isUuid(value) ? buildAssetQrPublicUrl(value) : value;
}

const DATA_CODEWORDS = 86;
const ECC_CODEWORDS_PER_BLOCK = 26;
const DATA_BLOCK_LENGTHS = [14, 14, 14, 14, 15, 15] as const;
const ALIGNMENT_PATTERN_POSITIONS = [6, 24, 42] as const;
const FORMAT_ECC_H = 2;
const MASK_PATTERN = 0;

function appendBits(target: number[], value: number, length: number): void {
  for (let shift = length - 1; shift >= 0; shift -= 1) target.push((value >>> shift) & 1);
}

function gfMultiply(left: number, right: number): number {
  let x = left & 0xff;
  let y = right & 0xff;
  let result = 0;
  for (let i = 0; i < 8; i += 1) {
    if ((y & 1) !== 0) result ^= x;
    const high = (x & 0x80) !== 0;
    x = (x << 1) & 0xff;
    if (high) x ^= 0x1d;
    y >>>= 1;
  }
  return result;
}

function gfPower(value: number, exponent: number): number {
  let result = 1;
  for (let i = 0; i < exponent; i += 1) result = gfMultiply(result, value);
  return result;
}

function reedSolomonGenerator(degree: number): number[] {
  let polynomial = [1];
  for (let i = 0; i < degree; i += 1) {
    const factor = gfPower(2, i);
    const next = Array<number>(polynomial.length + 1).fill(0);
    polynomial.forEach((coefficient, index) => {
      next[index] ^= coefficient;
      next[index + 1] ^= gfMultiply(coefficient, factor);
    });
    polynomial = next;
  }
  return polynomial;
}

function reedSolomonRemainder(data: number[], degree: number): number[] {
  const generator = reedSolomonGenerator(degree);
  let remainder = Array<number>(degree).fill(0);
  data.forEach((byte) => {
    const factor = byte ^ remainder[0];
    remainder = [...remainder.slice(1), 0];
    for (let i = 0; i < degree; i += 1) remainder[i] ^= gfMultiply(generator[i + 1], factor);
  });
  return remainder;
}

function createDataCodewords(value: string): number[] {
  const payload = assetQrPayload(value);
  const bytes = new TextEncoder().encode(payload);
  if (bytes.length === 0) throw new AssetQrMatrixError();
  if (bytes.length > ASSET_QR_MAX_PAYLOAD_BYTES) {
    throw new AssetQrMatrixError(`Payload Asset QR melebihi kapasitas QR v${ASSET_QR_VERSION}-H.`);
  }

  const bits: number[] = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, bytes.length, 8);
  bytes.forEach((byte) => appendBits(bits, byte, 8));

  const capacityBits = DATA_CODEWORDS * 8;
  const terminator = Math.min(4, capacityBits - bits.length);
  for (let i = 0; i < terminator; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords: number[] = [];
  for (let offset = 0; offset < bits.length; offset += 8) {
    let byte = 0;
    for (let i = 0; i < 8; i += 1) byte = (byte << 1) | bits[offset + i];
    codewords.push(byte);
  }

  const pads = [0xec, 0x11];
  let padIndex = 0;
  while (codewords.length < DATA_CODEWORDS) {
    codewords.push(pads[padIndex % pads.length]);
    padIndex += 1;
  }
  if (codewords.length !== DATA_CODEWORDS) {
    throw new AssetQrMatrixError(`Payload Asset QR melebihi kapasitas QR v${ASSET_QR_VERSION}-H.`);
  }
  return codewords;
}

function createInterleavedCodewords(payload: string): number[] {
  const data = createDataCodewords(payload);
  const blocks: { data: number[]; ecc: number[] }[] = [];
  let offset = 0;
  DATA_BLOCK_LENGTHS.forEach((length) => {
    const blockData = data.slice(offset, offset + length);
    offset += length;
    blocks.push({ data: blockData, ecc: reedSolomonRemainder(blockData, ECC_CODEWORDS_PER_BLOCK) });
  });

  const result: number[] = [];
  const maxDataLength = Math.max(...DATA_BLOCK_LENGTHS);
  for (let index = 0; index < maxDataLength; index += 1) {
    blocks.forEach((block) => {
      if (index < block.data.length) result.push(block.data[index]);
    });
  }
  for (let index = 0; index < ECC_CODEWORDS_PER_BLOCK; index += 1) {
    blocks.forEach((block) => result.push(block.ecc[index]));
  }
  return result;
}

function bchDigit(value: number): number {
  let digit = 0;
  let current = value;
  while (current !== 0) {
    digit += 1;
    current >>>= 1;
  }
  return digit;
}

function formatBits(maskPattern: number): number {
  const data = (FORMAT_ECC_H << 3) | maskPattern;
  let remainder = data << 10;
  const generator = 0x537;
  while (bchDigit(remainder) - bchDigit(generator) >= 0) {
    remainder ^= generator << (bchDigit(remainder) - bchDigit(generator));
  }
  return ((data << 10) | remainder) ^ 0x5412;
}

function versionBits(version: number): number {
  let remainder = version << 12;
  const generator = 0x1f25;
  while (bchDigit(remainder) - bchDigit(generator) >= 0) {
    remainder ^= generator << (bchDigit(remainder) - bchDigit(generator));
  }
  return (version << 12) | remainder;
}

function mask(row: number, column: number): boolean {
  return (row + column) % 2 === 0;
}

export function createAssetQrMatrix(payload: string): boolean[][] {
  const size = ASSET_QR_SIZE;
  const modules: Array<Array<boolean | null>> = Array.from({ length: size }, () => Array<boolean | null>(size).fill(null));

  const drawFinder = (row: number, column: number) => {
    for (let r = -1; r <= 7; r += 1) {
      const targetRow = row + r;
      if (targetRow < 0 || targetRow >= size) continue;
      for (let c = -1; c <= 7; c += 1) {
        const targetColumn = column + c;
        if (targetColumn < 0 || targetColumn >= size) continue;
        modules[targetRow][targetColumn] = (
          (r >= 0 && r <= 6 && (c === 0 || c === 6))
          || (c >= 0 && c <= 6 && (r === 0 || r === 6))
          || (r >= 2 && r <= 4 && c >= 2 && c <= 4)
        );
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(size - 7, 0);
  drawFinder(0, size - 7);

  ALIGNMENT_PATTERN_POSITIONS.forEach((row) => {
    ALIGNMENT_PATTERN_POSITIONS.forEach((column) => {
      if (modules[row][column] !== null) return;
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          modules[row + r][column + c] = r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0);
        }
      }
    });
  });

  for (let row = 8; row < size - 8; row += 1) {
    if (modules[row][6] === null) modules[row][6] = row % 2 === 0;
  }
  for (let column = 8; column < size - 8; column += 1) {
    if (modules[6][column] === null) modules[6][column] = column % 2 === 0;
  }

  const typeNumber = versionBits(ASSET_QR_VERSION);
  for (let i = 0; i < 18; i += 1) {
    const dark = ((typeNumber >>> i) & 1) === 1;
    modules[Math.floor(i / 3)][(i % 3) + size - 11] = dark;
    modules[(i % 3) + size - 11][Math.floor(i / 3)] = dark;
  }

  const typeInfo = formatBits(MASK_PATTERN);
  for (let i = 0; i < 15; i += 1) {
    const dark = ((typeInfo >>> i) & 1) === 1;
    if (i < 6) modules[i][8] = dark;
    else if (i < 8) modules[i + 1][8] = dark;
    else modules[size - 15 + i][8] = dark;
  }
  for (let i = 0; i < 15; i += 1) {
    const dark = ((typeInfo >>> i) & 1) === 1;
    if (i < 8) modules[8][size - i - 1] = dark;
    else if (i < 9) modules[8][15 - i] = dark;
    else modules[8][14 - i] = dark;
  }
  modules[size - 8][8] = true;

  const data = createInterleavedCodewords(payload);
  let row = size - 1;
  let direction = -1;
  let byteIndex = 0;
  let bitIndex = 7;

  for (let originalColumn = size - 1; originalColumn > 0; originalColumn -= 2) {
    let column = originalColumn;
    if (column <= 6) column -= 1;
    while (true) {
      [column, column - 1].forEach((targetColumn) => {
        if (modules[row][targetColumn] !== null) return;
        let dark = false;
        if (byteIndex < data.length) dark = ((data[byteIndex] >>> bitIndex) & 1) === 1;
        if (mask(row, targetColumn)) dark = !dark;
        modules[row][targetColumn] = dark;
        bitIndex -= 1;
        if (bitIndex < 0) {
          byteIndex += 1;
          bitIndex = 7;
        }
      });
      row += direction;
      if (row < 0 || row >= size) {
        row -= direction;
        direction = -direction;
        break;
      }
    }
  }

  if (modules.some((line) => line.some((module) => module === null))) throw new AssetQrMatrixError('QR matrix tidak lengkap.');
  return modules.map((line) => line.map((module) => module === true));
}

export function assetQrSvgPath(matrix: boolean[][]): string {
  if (matrix.length !== ASSET_QR_SIZE || matrix.some((row) => row.length !== ASSET_QR_SIZE)) {
    throw new AssetQrMatrixError('Ukuran QR matrix tidak valid.');
  }
  const commands: string[] = [];
  matrix.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) commands.push(`M${x} ${y}h1v1h-1z`);
    });
  });
  return commands.join('');
}
