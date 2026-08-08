'use strict';

const Pipeline = require('./src/core/pipeline');
const Stage = require('./src/core/stage');
const PipelineContext = require('./src/core/context');

// Algorithm exports
const { EPA } = require('./src/algorithms/epa');
const { ResidualPyramid } = require('./src/algorithms/residual-pyramid');
const { dotProduct, magnitude, normalize, orthogonalize, orthogonalProjection } = require('./src/algorithms/gram-schmidt');
const { clusterTags, computeWeightedPCA, powerIteration, selectBasisDimension } = require('./src/algorithms/svd');

// Utility exports
const { decodeVectorBlob, encodeVectorBlob } = require('./src/utils/vector-codec');
const { prepareTextForEmbedding, extractTags } = require('./src/utils/text-preprocessor');

module.exports = {
  // Core
  Pipeline,
  Stage,
  PipelineContext,
  createMemoryEngine: null, // Phase 5

  // Algorithms
  EPA,
  ResidualPyramid,

  // Gram-Schmidt primitives
  dotProduct,
  magnitude,
  normalize,
  orthogonalize,
  orthogonalProjection,

  // SVD / PCA
  clusterTags,
  computeWeightedPCA,
  powerIteration,
  selectBasisDimension,

  // Utils
  decodeVectorBlob,
  encodeVectorBlob,
  prepareTextForEmbedding,
  extractTags,
};
