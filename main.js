/*
 * Photoshop UXP plugin - minimal implementation
 *
 * Scope for this version:
 * - Horizontal direction only
 * - textShape[0] only
 * - Rotation / shear / vertical writing are NOT handled yet
 *
 * Future extension points:
 * - Absorb yy into vertical scale properties
 * - Handle rotation/shear matrix decomposition (xy/yx)
 * - Handle multiple textShape entries
 */

const { entrypoints } = require("uxp");
const { action, core } = require("photoshop");
const { batchPlay } = action;

const EPSILON_IDENTITY = 1e-6;
const EPSILON_ZERO = 1e-4;

function safeStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (e) {
    return `[safeStringify failed] ${String(e)}`;
  }
}

async function getSelectedTextLayerDescriptor() {
  const result = await batchPlay(
    [
      {
        _obj: "get",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
      },
    ],
    {
      synchronousExecution: true,
      modalBehavior: "fail",
    }
  );

  if (!Array.isArray(result) || !result[0]) {
    throw new Error("Failed to get selected layer descriptor.");
  }

  const descriptor = result[0];
  const layerKind = descriptor.layerKind;

  // Photoshop text layer is usually layerKind === 3.
  if (layerKind !== 3 || !descriptor.textKey) {
    throw new Error("Selected layer is not a text layer.");
  }

  const layerId = descriptor.layerID;
  if (typeof layerId !== "number") {
    throw new Error("Failed to resolve selected text layer ID.");
  }

  return { layerId, descriptor };
}

function normalizeHorizontalTransformInDescriptor(descriptor) {
  const textKey = descriptor?.textKey;
  if (!textKey) {
    throw new Error("Descriptor has no textKey.");
  }

  const textShape = textKey.textShape;
  if (!Array.isArray(textShape) || !textShape[0]) {
    throw new Error("textShape[0] is missing.");
  }

  const transform = textShape[0].transform;
  if (!transform || typeof transform.xx !== "number") {
    throw new Error("textShape[0].transform.xx is missing or invalid.");
  }

  const originalXX = transform.xx;
  console.log(`[normalize] original transform.xx = ${originalXX}`);

  if (Math.abs(originalXX - 1) <= EPSILON_IDENTITY) {
    return {
      status: "no_transform",
      reason: `transform.xx is already ~1 (${originalXX})`,
      textKey,
      originalXX,
      normalizedXX: originalXX,
      ranges: [],
    };
  }

  if (Math.abs(originalXX) <= EPSILON_ZERO || originalXX < 0) {
    throw new Error(
      `Unsafe transform.xx (${originalXX}). Negative or near-zero values are not supported in this minimal version.`
    );
  }

  const ranges = textKey.textStyleRange;
  if (!Array.isArray(ranges) || ranges.length === 0) {
    throw new Error("textStyleRange is missing or empty.");
  }

  const updatedRanges = ranges.map((range, index) => {
    const clonedRange = {
      ...range,
      textStyle: {
        ...(range.textStyle || {}),
      },
    };

    const oldHorizontalScale =
      typeof clonedRange.textStyle.horizontalScale === "number"
        ? clonedRange.textStyle.horizontalScale
        : 100;

    const newHorizontalScale = oldHorizontalScale * originalXX;
    clonedRange.textStyle.horizontalScale = newHorizontalScale;

    console.log(
      `[normalize] range[${index}] horizontalScale: ${oldHorizontalScale} -> ${newHorizontalScale}`
    );

    return clonedRange;
  });

  const updatedTextKey = {
    ...textKey,
    textStyleRange: updatedRanges,
    textShape: textShape.map((shape, idx) => {
      if (idx !== 0) return shape;
      return {
        ...shape,
        transform: {
          ...shape.transform,
          // Keep xy / yx / yy / tx / ty as-is for this version.
          xx: 1,
        },
      };
    }),
  };

  const normalizedXX = updatedTextKey.textShape[0].transform.xx;
  console.log(`[normalize] normalized transform.xx = ${normalizedXX}`);

  return {
    status: "success",
    textKey: updatedTextKey,
    originalXX,
    normalizedXX,
    ranges: updatedRanges.map((r, i) => ({
      index: i,
      horizontalScale: r.textStyle?.horizontalScale,
    })),
  };
}

async function applyNormalizedDescriptor(layerId, nextTextKey) {
  const result = await batchPlay(
    [
      {
        _obj: "set",
        _target: [{ _ref: "textLayer", _id: layerId }],
        // `nextTextKey` is already the text layer descriptor shape (`descriptor.textKey`).
        // Avoid wrapping it again as `{ _obj: "textLayer", textKey: ... }`.
        to: nextTextKey,
      },
    ],
    {
      synchronousExecution: true,
      modalBehavior: "execute",
    }
  );

  return result;
}

async function runNormalizeHorizontalCommand() {
  try {
    const { layerId, descriptor } = await getSelectedTextLayerDescriptor();

    const normalized = normalizeHorizontalTransformInDescriptor(descriptor);

    if (normalized.status === "no_transform") {
      console.log(`[normalize] no-op: ${normalized.reason}`);
      return normalized;
    }

    await core.executeAsModal(
      async () => {
        await applyNormalizedDescriptor(layerId, normalized.textKey);
      },
      { commandName: "Normalize Horizontal Transform" }
    );

    console.log("[normalize] success");
    return normalized;
  } catch (error) {
    console.log(`[normalize] error: ${error?.message || String(error)}`);
    console.log(`[normalize] error detail: ${safeStringify(error)}`);
    throw error;
  }
}

entrypoints.setup({
  commands: {
    runNormalizeHorizontalCommand,
  },
});

module.exports = {
  safeStringify,
  getSelectedTextLayerDescriptor,
  normalizeHorizontalTransformInDescriptor,
  applyNormalizedDescriptor,
  runNormalizeHorizontalCommand,
};
