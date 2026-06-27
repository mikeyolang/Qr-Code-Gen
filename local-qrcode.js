(function () {
  const EC_LEVEL_BITS = { L: 1, M: 0, Q: 3, H: 2 };
  const ALIGNMENT_POSITIONS = {
    1: [],
    2: [6, 18],
    3: [6, 22],
    4: [6, 26],
    5: [6, 30],
    6: [6, 34],
    7: [6, 22, 38],
    8: [6, 24, 42],
    9: [6, 26, 46],
    10: [6, 28, 50]
  };

  const RS_BLOCKS = {
    1: { L: [[1, 26, 19]], M: [[1, 26, 16]], Q: [[1, 26, 13]], H: [[1, 26, 9]] },
    2: { L: [[1, 44, 34]], M: [[1, 44, 28]], Q: [[1, 44, 22]], H: [[1, 44, 16]] },
    3: { L: [[1, 70, 55]], M: [[1, 70, 44]], Q: [[2, 35, 17]], H: [[2, 35, 13]] },
    4: { L: [[1, 100, 80]], M: [[2, 50, 32]], Q: [[2, 50, 24]], H: [[4, 25, 9]] },
    5: { L: [[1, 134, 108]], M: [[2, 67, 43]], Q: [[2, 33, 15], [2, 34, 16]], H: [[2, 33, 11], [2, 34, 12]] },
    6: { L: [[2, 86, 68]], M: [[4, 43, 27]], Q: [[4, 43, 19]], H: [[4, 43, 15]] },
    7: { L: [[2, 98, 78]], M: [[4, 49, 31]], Q: [[2, 32, 14], [4, 33, 15]], H: [[4, 39, 13], [1, 40, 14]] },
    8: { L: [[2, 121, 97]], M: [[2, 60, 38], [2, 61, 39]], Q: [[4, 40, 18], [2, 41, 19]], H: [[4, 40, 14], [2, 41, 15]] },
    9: { L: [[2, 146, 116]], M: [[3, 58, 36], [2, 59, 37]], Q: [[4, 36, 16], [4, 37, 17]], H: [[4, 36, 12], [4, 37, 13]] },
    10: { L: [[2, 86, 68], [2, 87, 69]], M: [[4, 69, 43], [1, 70, 44]], Q: [[6, 43, 19], [2, 44, 20]], H: [[6, 43, 15], [2, 44, 16]] }
  };

  const EXP_TABLE = new Array(512);
  const LOG_TABLE = new Array(256);

  let value = 1;
  for (let index = 0; index < 255; index += 1) {
    EXP_TABLE[index] = value;
    LOG_TABLE[value] = index;
    value <<= 1;
    if (value & 0x100) {
      value ^= 0x11d;
    }
  }

  for (let index = 255; index < EXP_TABLE.length; index += 1) {
    EXP_TABLE[index] = EXP_TABLE[index - 255];
  }

  function toCanvas(canvas, text, options) {
    const settings = options || {};
    const width = Math.max(64, Number(settings.width) || 256);
    const margin = Math.max(0, Number(settings.margin ?? 4));
    const foreground = settings.color?.dark || '#000000';
    const background = settings.color?.light || '#ffffff';
    const level = normalizeLevel(settings.errorCorrectionLevel);
    const qr = createQrCode(String(text), level);
    const context = canvas.getContext('2d');
    const totalModules = qr.size + margin * 2;
    const scale = width / totalModules;

    canvas.width = width;
    canvas.height = width;

    context.fillStyle = background;
    context.fillRect(0, 0, width, width);
    context.fillStyle = foreground;

    for (let y = 0; y < qr.size; y += 1) {
      for (let x = 0; x < qr.size; x += 1) {
        if (!qr.modules[y][x]) {
          continue;
        }

        const left = Math.round((x + margin) * scale);
        const top = Math.round((y + margin) * scale);
        const right = Math.round((x + margin + 1) * scale);
        const bottom = Math.round((y + margin + 1) * scale);
        context.fillRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
      }
    }

    return Promise.resolve(canvas);
  }

  function normalizeLevel(level) {
    const normalized = String(level || 'M').toUpperCase().charAt(0);
    return EC_LEVEL_BITS[normalized] === undefined ? 'M' : normalized;
  }

  function createQrCode(text, level) {
    const bytes = utf8Bytes(text);
    const version = chooseVersion(bytes.length, level);
    const blocks = expandBlocks(version, level);
    const dataCodewords = makeDataCodewords(bytes, version, totalDataCodewords(blocks));
    const codewords = makeCodewords(dataCodewords, blocks);
    const base = createBaseMatrix(version);

    placeDataCodewords(base.modules, base.reserved, codewords);

    let bestMatrix = null;
    let bestPenalty = Infinity;

    for (let mask = 0; mask < 8; mask += 1) {
      const matrix = cloneMatrix(base.modules);
      applyMask(matrix, base.reserved, mask);
      setFormatInfo(matrix, level, mask);
      setVersionInfo(matrix, version);

      const penalty = getPenaltyScore(matrix);
      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        bestMatrix = matrix;
      }
    }

    return {
      size: base.modules.length,
      modules: bestMatrix
    };
  }

  function utf8Bytes(text) {
    if (typeof TextEncoder !== 'undefined') {
      return Array.from(new TextEncoder().encode(text));
    }

    return unescape(encodeURIComponent(text))
      .split('')
      .map((char) => char.charCodeAt(0));
  }

  function chooseVersion(byteLength, level) {
    for (let version = 1; version <= 10; version += 1) {
      const capacityBits = totalDataCodewords(expandBlocks(version, level)) * 8;
      const countBits = version < 10 ? 8 : 16;
      const neededBits = 4 + countBits + byteLength * 8;

      if (neededBits <= capacityBits) {
        return version;
      }
    }

    throw new Error('QR content is too long for this generator. Try a shorter promo code.');
  }

  function expandBlocks(version, level) {
    return RS_BLOCKS[version][level].flatMap(([count, totalCount, dataCount]) => {
      return Array.from({ length: count }, () => ({ totalCount, dataCount }));
    });
  }

  function totalDataCodewords(blocks) {
    return blocks.reduce((total, block) => total + block.dataCount, 0);
  }

  function makeDataCodewords(bytes, version, capacity) {
    const bits = [];
    appendBits(bits, 0x4, 4);
    appendBits(bits, bytes.length, version < 10 ? 8 : 16);

    bytes.forEach((byte) => appendBits(bits, byte, 8));

    const capacityBits = capacity * 8;
    appendBits(bits, 0, Math.min(4, capacityBits - bits.length));

    while (bits.length % 8 !== 0) {
      bits.push(false);
    }

    const data = [];
    for (let index = 0; index < bits.length; index += 8) {
      let codeword = 0;
      for (let offset = 0; offset < 8; offset += 1) {
        codeword = (codeword << 1) | (bits[index + offset] ? 1 : 0);
      }
      data.push(codeword);
    }

    for (let pad = 0xec; data.length < capacity; pad = pad === 0xec ? 0x11 : 0xec) {
      data.push(pad);
    }

    return data;
  }

  function appendBits(bits, data, length) {
    for (let shift = length - 1; shift >= 0; shift -= 1) {
      bits.push(((data >>> shift) & 1) !== 0);
    }
  }

  function makeCodewords(dataCodewords, blocks) {
    const dataBlocks = [];
    const errorBlocks = [];
    let offset = 0;

    blocks.forEach((block) => {
      const data = dataCodewords.slice(offset, offset + block.dataCount);
      const ecCount = block.totalCount - block.dataCount;
      dataBlocks.push(data);
      errorBlocks.push(computeErrorCorrection(data, ecCount));
      offset += block.dataCount;
    });

    const result = [];
    const maxDataLength = Math.max(...dataBlocks.map((block) => block.length));
    const maxErrorLength = Math.max(...errorBlocks.map((block) => block.length));

    for (let index = 0; index < maxDataLength; index += 1) {
      dataBlocks.forEach((block) => {
        if (index < block.length) {
          result.push(block[index]);
        }
      });
    }

    for (let index = 0; index < maxErrorLength; index += 1) {
      errorBlocks.forEach((block) => {
        if (index < block.length) {
          result.push(block[index]);
        }
      });
    }

    return result;
  }

  function computeErrorCorrection(data, degree) {
    const generator = makeGeneratorPolynomial(degree);
    const result = new Array(degree).fill(0);

    data.forEach((byte) => {
      const factor = byte ^ result.shift();
      result.push(0);

      for (let index = 0; index < degree; index += 1) {
        result[index] ^= multiply(generator[index + 1], factor);
      }
    });

    return result;
  }

  function makeGeneratorPolynomial(degree) {
    let polynomial = [1];

    for (let degreeIndex = 0; degreeIndex < degree; degreeIndex += 1) {
      const next = new Array(polynomial.length + 1).fill(0);
      polynomial.forEach((coefficient, index) => {
        next[index] ^= multiply(coefficient, 1);
        next[index + 1] ^= multiply(coefficient, EXP_TABLE[degreeIndex]);
      });
      polynomial = next;
    }

    return polynomial;
  }

  function multiply(a, b) {
    if (a === 0 || b === 0) {
      return 0;
    }

    return EXP_TABLE[LOG_TABLE[a] + LOG_TABLE[b]];
  }

  function createBaseMatrix(version) {
    const size = 21 + (version - 1) * 4;
    const modules = Array.from({ length: size }, () => new Array(size).fill(false));
    const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

    addFinderPattern(modules, reserved, 0, 0);
    addFinderPattern(modules, reserved, size - 7, 0);
    addFinderPattern(modules, reserved, 0, size - 7);
    addAlignmentPatterns(modules, reserved, version);
    addTimingPatterns(modules, reserved);
    reserveFormatAreas(reserved);
    reserveVersionAreas(reserved, version);
    setFunctionModule(modules, reserved, 8, size - 8, true);

    return { modules, reserved };
  }

  function addFinderPattern(modules, reserved, left, top) {
    for (let y = -1; y <= 7; y += 1) {
      for (let x = -1; x <= 7; x += 1) {
        const xx = left + x;
        const yy = top + y;

        if (!isInside(modules, xx, yy)) {
          continue;
        }

        const isFinder =
          x >= 0 &&
          x <= 6 &&
          y >= 0 &&
          y <= 6 &&
          (x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4));

        setFunctionModule(modules, reserved, xx, yy, isFinder);
      }
    }
  }

  function addAlignmentPatterns(modules, reserved, version) {
    const positions = ALIGNMENT_POSITIONS[version];
    const size = modules.length;

    positions.forEach((centerY) => {
      positions.forEach((centerX) => {
        const overlapsFinder =
          (centerX === 6 && centerY === 6) ||
          (centerX === 6 && centerY === size - 7) ||
          (centerX === size - 7 && centerY === 6);

        if (overlapsFinder) {
          return;
        }

        for (let y = -2; y <= 2; y += 1) {
          for (let x = -2; x <= 2; x += 1) {
            const distance = Math.max(Math.abs(x), Math.abs(y));
            setFunctionModule(modules, reserved, centerX + x, centerY + y, distance === 2 || distance === 0);
          }
        }
      });
    });
  }

  function addTimingPatterns(modules, reserved) {
    const size = modules.length;

    for (let index = 8; index < size - 8; index += 1) {
      const isDark = index % 2 === 0;
      setFunctionModule(modules, reserved, index, 6, isDark);
      setFunctionModule(modules, reserved, 6, index, isDark);
    }
  }

  function reserveFormatAreas(reserved) {
    const size = reserved.length;

    for (let index = 0; index <= 8; index += 1) {
      if (index !== 6) {
        reserved[8][index] = true;
        reserved[index][8] = true;
      }
    }

    for (let index = size - 8; index < size; index += 1) {
      reserved[8][index] = true;
      reserved[index][8] = true;
    }
  }

  function reserveVersionAreas(reserved, version) {
    if (version < 7) {
      return;
    }

    const size = reserved.length;
    for (let index = 0; index < 6; index += 1) {
      for (let offset = 0; offset < 3; offset += 1) {
        reserved[index][size - 11 + offset] = true;
        reserved[size - 11 + offset][index] = true;
      }
    }
  }

  function setFunctionModule(modules, reserved, x, y, isDark) {
    modules[y][x] = isDark;
    reserved[y][x] = true;
  }

  function isInside(modules, x, y) {
    return y >= 0 && y < modules.length && x >= 0 && x < modules.length;
  }

  function placeDataCodewords(modules, reserved, codewords) {
    const size = modules.length;
    const bits = [];
    codewords.forEach((codeword) => appendBits(bits, codeword, 8));

    let bitIndex = 0;
    let upward = true;

    for (let right = size - 1; right > 0; right -= 2) {
      if (right === 6) {
        right -= 1;
      }

      for (let vertical = 0; vertical < size; vertical += 1) {
        const y = upward ? size - 1 - vertical : vertical;

        for (let column = 0; column < 2; column += 1) {
          const x = right - column;

          if (reserved[y][x]) {
            continue;
          }

          modules[y][x] = bitIndex < bits.length ? bits[bitIndex] : false;
          bitIndex += 1;
        }
      }

      upward = !upward;
    }
  }

  function applyMask(modules, reserved, mask) {
    for (let y = 0; y < modules.length; y += 1) {
      for (let x = 0; x < modules.length; x += 1) {
        if (!reserved[y][x] && maskApplies(mask, x, y)) {
          modules[y][x] = !modules[y][x];
        }
      }
    }
  }

  function maskApplies(mask, x, y) {
    switch (mask) {
      case 0:
        return (x + y) % 2 === 0;
      case 1:
        return y % 2 === 0;
      case 2:
        return x % 3 === 0;
      case 3:
        return (x + y) % 3 === 0;
      case 4:
        return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
      case 5:
        return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6:
        return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      case 7:
        return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      default:
        return false;
    }
  }

  function setFormatInfo(modules, level, mask) {
    const size = modules.length;
    const bits = getBchTypeInfo((EC_LEVEL_BITS[level] << 3) | mask);

    for (let index = 0; index < 15; index += 1) {
      const isDark = ((bits >>> index) & 1) === 1;

      if (index < 6) {
        modules[index][8] = isDark;
      } else if (index < 8) {
        modules[index + 1][8] = isDark;
      } else {
        modules[size - 15 + index][8] = isDark;
      }
    }

    for (let index = 0; index < 15; index += 1) {
      const isDark = ((bits >>> index) & 1) === 1;

      if (index < 8) {
        modules[8][size - index - 1] = isDark;
      } else if (index < 9) {
        modules[8][15 - index] = isDark;
      } else {
        modules[8][14 - index] = isDark;
      }
    }

    modules[size - 8][8] = true;
  }

  function setVersionInfo(modules, version) {
    if (version < 7) {
      return;
    }

    const size = modules.length;
    const bits = getBchTypeNumber(version);

    for (let index = 0; index < 18; index += 1) {
      const isDark = ((bits >>> index) & 1) === 1;
      modules[Math.floor(index / 3)][(index % 3) + size - 11] = isDark;
      modules[(index % 3) + size - 11][Math.floor(index / 3)] = isDark;
    }
  }

  function getBchTypeInfo(data) {
    let d = data << 10;
    const generator = 0x537;

    while (getBchDigit(d) - getBchDigit(generator) >= 0) {
      d ^= generator << (getBchDigit(d) - getBchDigit(generator));
    }

    return ((data << 10) | d) ^ 0x5412;
  }

  function getBchTypeNumber(data) {
    let d = data << 12;
    const generator = 0x1f25;

    while (getBchDigit(d) - getBchDigit(generator) >= 0) {
      d ^= generator << (getBchDigit(d) - getBchDigit(generator));
    }

    return (data << 12) | d;
  }

  function getBchDigit(data) {
    let digit = 0;

    while (data !== 0) {
      digit += 1;
      data >>>= 1;
    }

    return digit;
  }

  function cloneMatrix(matrix) {
    return matrix.map((row) => row.slice());
  }

  function getPenaltyScore(matrix) {
    return (
      getSameColorPenalty(matrix) +
      getBlockPenalty(matrix) +
      getFinderPatternPenalty(matrix) +
      getBalancePenalty(matrix)
    );
  }

  function getSameColorPenalty(matrix) {
    const size = matrix.length;
    let penalty = 0;

    for (let y = 0; y < size; y += 1) {
      let runColor = matrix[y][0];
      let runLength = 1;

      for (let x = 1; x < size; x += 1) {
        if (matrix[y][x] === runColor) {
          runLength += 1;
          continue;
        }

        if (runLength >= 5) {
          penalty += 3 + (runLength - 5);
        }

        runColor = matrix[y][x];
        runLength = 1;
      }

      if (runLength >= 5) {
        penalty += 3 + (runLength - 5);
      }
    }

    for (let x = 0; x < size; x += 1) {
      let runColor = matrix[0][x];
      let runLength = 1;

      for (let y = 1; y < size; y += 1) {
        if (matrix[y][x] === runColor) {
          runLength += 1;
          continue;
        }

        if (runLength >= 5) {
          penalty += 3 + (runLength - 5);
        }

        runColor = matrix[y][x];
        runLength = 1;
      }

      if (runLength >= 5) {
        penalty += 3 + (runLength - 5);
      }
    }

    return penalty;
  }

  function getBlockPenalty(matrix) {
    let penalty = 0;

    for (let y = 0; y < matrix.length - 1; y += 1) {
      for (let x = 0; x < matrix.length - 1; x += 1) {
        const color = matrix[y][x];
        if (matrix[y][x + 1] === color && matrix[y + 1][x] === color && matrix[y + 1][x + 1] === color) {
          penalty += 3;
        }
      }
    }

    return penalty;
  }

  function getFinderPatternPenalty(matrix) {
    const pattern = [true, false, true, true, true, false, true, false, false, false, false];
    const reverse = pattern.slice().reverse();
    let penalty = 0;

    for (let y = 0; y < matrix.length; y += 1) {
      const row = matrix[y];
      for (let x = 0; x <= matrix.length - pattern.length; x += 1) {
        if (matchesPattern(row, x, pattern) || matchesPattern(row, x, reverse)) {
          penalty += 40;
        }
      }
    }

    for (let x = 0; x < matrix.length; x += 1) {
      const column = matrix.map((row) => row[x]);
      for (let y = 0; y <= matrix.length - pattern.length; y += 1) {
        if (matchesPattern(column, y, pattern) || matchesPattern(column, y, reverse)) {
          penalty += 40;
        }
      }
    }

    return penalty;
  }

  function matchesPattern(line, start, pattern) {
    return pattern.every((value, index) => line[start + index] === value);
  }

  function getBalancePenalty(matrix) {
    const size = matrix.length;
    const total = size * size;
    let dark = 0;

    matrix.forEach((row) => {
      row.forEach((module) => {
        if (module) {
          dark += 1;
        }
      });
    });

    return Math.floor(Math.abs((dark * 20) - (total * 10)) / total) * 10;
  }

  window.QRCode = { toCanvas };
})();
