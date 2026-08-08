'use strict';

const path = require('path');

/**
 * KnowledgeBaseAdapter — drop-in compatibility surface for
 * KnowledgeBaseManager consumers.
 *
 * Call sites found by grepping the repository (server.js, Plugin/,
 * modules/, routes/):
 *
 *   server.js:1524                     await kbm.initialize()
 *   server.js:1832                     await kbm.shutdown()
 *   routes/admin/system.js:227         kbm.getMemoryProfile()
 *   routes/admin/rag.js                kbm.getHealthStatus()
 *   Plugin/DailyNote/*                 kbm.runExternalFileMutation(owner, fn, opts)  [guarded]
 *   Plugin/AgentDream/*                kbm.initialized, kbm.search(diary, vec, k, tagBoost)
 *   modules/vcpLoop/toolExecutor.js    kbm.db.prepare(...), kbm.search(diary, vec, n),
 *                                      kbm.config?.rootPath
 *
 * The TagMemoEngine-only surface (requestRustWriteLease, ...) is NOT
 * provided: every call site guards with `typeof x === 'function'` and
 * falls back gracefully when the method is absent.
 *
 * The legacy search(diaryName, vec, k, tagBoost) vector path is a plain
 * per-index KNN + hydration pass; TagMemo rerank / geodesic rerank are
 * outside the standalone library's scope. Text queries (`search(str)`)
 * delegate to the MemoryEngine search pipeline.
 */
class KnowledgeBaseAdapter {
  /**
   * @param {object} options
   * @param {import('../engine').MemoryEngine} options.engine
   */
  constructor({ engine } = {}) {
    if (!engine) {
      throw new TypeError('KnowledgeBaseAdapter requires an engine');
    }
    this.name = 'knowledgeBaseAdapter';
    this.engine = engine;

    // ── Call-site passthroughs ──────────────────────────────────────
    this.flush = (files) => engine.flush(files);
    this.flushBatch = (files) => engine.flushBatch(files);
    this.handleDelete = (input) => engine.handleDelete(input);
    this.deleteFile = (filePath) => engine.deleteFile(filePath);
    this.getStats = () => engine.getStats();
    this.close = () => engine.close();

    // Serialization tail for runExternalFileMutation.
    this._mutationTail = Promise.resolve();
  }

  /** KBM call sites read `kbm.initialized` before initialize(). */
  get initialized() {
    return !!(this.engine && this.engine.initialized);
  }

  /** toolExecutor surface: raw SQLite handle (guard: `if (!kbm.db)`). */
  get db() {
    const store = this.engine && this.engine.metadataStore;
    return (store && store.db) || null;
  }

  /** toolExecutor / DreamWaveEngine surface: merged engine config. */
  get config() {
    return (this.engine && this.engine.config) || {};
  }

  async initialize() {
    return this.engine.initialize();
  }

  /** server.js shutdown hook. */
  async shutdown() {
    return this.engine.close();
  }

  /**
   * DailyNote/DailyNoteManager surface: serialize a long-running file
   * mutation behind the watcher batch, mirroring databaseCoordinator's
   * external mutation gate (a simple FIFO mutex in the standalone lib).
   * @param {string} owner
   * @param {Function} operation - () => Promise<any>
   * @param {object} [options]
   * @returns {Promise<any>} operation result
   */
  runExternalFileMutation(owner, operation, options = {}) {
    if (typeof operation !== 'function') {
      return Promise.reject(new TypeError('runExternalFileMutation requires an operation function'));
    }
    const run = this._mutationTail.then(async () => {
      this._mutationOwner = owner;
      try {
        return await operation();
      } finally {
        this._mutationOwner = null;
      }
    });
    // The tail swallows failures so one mutation never wedges the queue.
    this._mutationTail = run.catch(() => {});
    return run;
  }

  /**
   * system/raven monitor: `{ available, estimatedBytes, ... }`.
   * Synchronous (routes/admin/system.js does not await it). Estimate:
   * resident vectors × dimension × 4 bytes (+ SQLite page baseline),
   * mirroring buildMemoryProfile's diagnostic estimate.
   */
  getMemoryProfile() {
    const engine = this.engine;
    if (!engine || !engine.initialized) {
      return { available: false, estimatedBytes: 0 };
    }
    let vectors = 0;
    let indices = 0;
    const vectorStore = engine.vectorStore;
    if (vectorStore && vectorStore.indices instanceof Map) {
      for (const index of vectorStore.indices.values()) {
        indices += 1;
        if (!index || typeof index.stats !== 'function') continue;
        try {
          const stats = index.stats();
          vectors += Number(stats && stats.totalVectors) || 0;
        } catch (e) {
          // A single index must not break the whole profile.
        }
      }
    }
    const dimension = Number(engine.config && engine.config.dimension) || 0;
    return {
      available: true,
      estimatedBytes: vectors * dimension * 4,
      vectors,
      indices,
      dimension
    };
  }

  /**
   * routes/admin/rag.js reads getHealthStatus() synchronously.
   * @returns {{status:string, healthy:boolean, issues:string[]}}
   */
  getHealthStatus() {
    const store = this.engine && this.engine.metadataStore;
    if (!store) {
      return { status: 'unavailable', healthy: false, issues: [] };
    }
    const issues = [];
    try {
      if (store.db && typeof store.db.prepare === 'function') {
        store.db.prepare('SELECT 1').get();
      }
    } catch (e) {
      issues.push((e && e.message) || String(e));
    }
    return {
      status: issues.length === 0 ? 'healthy' : 'degraded',
      healthy: issues.length === 0,
      issues
    };
  }

  /**
   * KnowledgeBaseManager.search(...args) compatibility.
   *
   * Legacy dispatch rules (mirror SearchService.search):
   *   search(diaryName|string[], queryVec, k, tagBoost,...) → raw index
   *     KNN on the named diaries, hydrated to chunk rows.
   *   search(queryString)                                  → engine text
   *     pipeline (formatted results envelope).
   *   search(vector, k, ...)                → all-indices KNN hydration.
   */
  async search(...args) {
    const [arg1, arg2] = args;
    const isDiaryNameArray = Array.isArray(arg1) && arg1.every(name => typeof name === 'string');
    if ((typeof arg1 === 'string' || isDiaryNameArray) && this._isVectorLike(arg2)) {
      return this._vectorSearch(
        isDiaryNameArray ? arg1 : [arg1],
        arg2,
        Number(args[2]) || 5,
        args[3] || 0
      );
    }
    if (this._isVectorLike(arg1)) {
      const names = await this._vectorIndexNames();
      return this._vectorSearch(names, arg1, Number(args[1]) || 5, args[2] || 0);
    }
    // Text search falls back to the engine pipeline.
    return this.engine.search(String(arg1 || ''), typeof arg2 === 'object' && arg2 !== null ? arg2 : {});
  }

  /**
   * Resolve the set of vector index names searchable for a legacy query.
   * @private
   */
  async _vectorIndexNames() {
    const engine = this.engine;
    if (engine.vectorStore && engine.vectorStore.indices instanceof Map && engine.vectorStore.indices.size > 0) {
      return [...engine.vectorStore.indices.keys()];
    }
    try {
      const names = await engine.metadataStore.getDistinctDiaryNames();
      return names && names.length ? names : ['Root'];
    } catch (e) {
      return ['Root'];
    }
  }

  _isVectorLike(value) {
    return Array.isArray(value)
      || value instanceof Float32Array
      || (ArrayBuffer.isView(value) && typeof value.length === 'number');
  }

  /**
   * KNN over the given diary indices, deduped by chunkId, hydrated
   * into the KnowledgeBaseManager result shape:
   *   { chunkId, text, score, sourceFile, fullPath, matchedTags,
   *     tagMatchCount, coreTagsMatched, boostFactor, tagMatchScore }
   * @param {string[]} indexNames
   * @param {Array|Float32Array} queryVector
   * @param {number} k
   * @param {number|string} tagBoost
   * @returns {Promise<Array<object>>}
   */
  async _vectorSearch(indexNames, queryVector, k, tagBoost) {
    const engine = this.engine;
    const vectorStore = engine.vectorStore;
    const store = engine.metadataStore;
    if (!vectorStore || typeof vectorStore.search !== 'function') return [];

    const query = queryVector instanceof Float32Array
      ? queryVector
      : new Float32Array(queryVector);

    const bestById = new Map();
    for (const indexName of indexNames) {
      let results = [];
      try {
        results = await vectorStore.search(indexName, query, Math.max(1, Math.round(k)));
      } catch (e) {
        continue;
      }
      for (const hit of results || []) {
        const chunkId = Number(hit && hit.id);
        if (!Number.isFinite(chunkId)) continue;
        const score = Number(hit && hit.score) || 0;
        const previous = bestById.get(chunkId);
        if (!previous || score > previous.score) {
          bestById.set(chunkId, { chunkId, score });
        }
      }
    }

    const hydrated = [];
    for (const { chunkId, score } of bestById.values()) {
      let chunk = null;
      try {
        chunk = await store.getChunkById(chunkId);
      } catch (e) {
        continue;
      }
      const row = chunk && chunk.fileId != null
        ? await store.getFileByChunkId(chunk.id)
        : null;
      const fullPath = row && row.path ? row.path : '';
      let tagNames = [];
      if (row) {
        try {
          const tags = await store.getFileTags(row.id);
          tagNames = Array.isArray(tags) ? tags.map(t => (t && t.name) || String(t)) : [];
        } catch (e) {
          tagNames = [];
        }
      }
      hydrated.push({
        chunkId,
        text: chunk ? chunk.content : '',
        score,
        sourceFile: fullPath ? path.basename(fullPath) : '',
        fullPath,
        matchedTags: tagNames,
        tagMatchCount: tagNames.length,
        coreTagsMatched: [],
        boostFactor: 0,
        tagMatchScore: 0
      });
    }

    hydrated.sort((a, b) => (b.score - a.score) || (a.chunkId - b.chunkId));
    return hydrated.slice(0, Math.max(1, Math.round(k)));
  }
}

module.exports = KnowledgeBaseAdapter;