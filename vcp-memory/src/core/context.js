'use strict';

/**
 * Dependency injection container shared across all stages in a pipeline.
 */
class PipelineContext {
  /**
   * @param {object} opts
   * @param {object} opts.config - RAG parameters
   * @param {import('../interfaces/embedding-provider')} [opts.embeddingProvider]
   * @param {import('../interfaces/vector-store')} [opts.vectorStore]
   * @param {import('../interfaces/metadata-store')} [opts.metadataStore]
   * @param {object} [opts.vexusIndex] - Raw Rust N-API handle for algorithm layer
   */
  constructor({ config, embeddingProvider, vectorStore, metadataStore, vexusIndex }) {
    this.config = config;
    this.embeddingProvider = embeddingProvider;
    this.vectorStore = vectorStore;
    this.metadataStore = metadataStore;
    this.vexusIndex = vexusIndex;
  }
}

module.exports = PipelineContext;
