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
    * @param {import('../algorithms/epa').EPA} [opts.epa] - Pre-built EPA basis for the memo pipeline
    */
  constructor({ config, embeddingProvider, vectorStore, metadataStore, vexusIndex, epa }) {
    this.config = config;
    this.embeddingProvider = embeddingProvider;
    this.vectorStore = vectorStore;
    this.metadataStore = metadataStore;
    this.vexusIndex = vexusIndex;
    this.epa = epa;
  }
}

module.exports = PipelineContext;
