# VCPToolBox 记忆系统提取设计文档

**日期:** 2026-08-08  
**主题:** 将 VCPToolBox 的记忆系统提取为独立 npm 库（管道式 IPO 架构）  
**状态:** 设计已确认，待实现

---

## 1. 背景与目标

### 1.1 当前状态

VCPToolBox 拥有一套先进的 AI 记忆系统，包含 TagMemo 浪潮算法、RiverMemo 拓扑 V3、EPA 语义分析、残差金字塔等核心算法。当前这些组件深度耦合在 VCPToolBox 主项目中：

- `KnowledgeBaseManager.js`（2355 行）作为单例中心枢纽，编排所有记忆操作
- `TagMemoEngine.js`（4137 行）、`TagMemoV10Engine.js`（1777 行）、`RiverMemoEngine.js`（839 行）实现核心算法
- `EPAModule.js`（742 行）、`ResidualPyramid.js`（395 行）、`ResultDeduplicator.js`（417 行）提供数学基础
- `modules/knowledgeBase/`（14 文件）和 `modules/tagmemoV10/`（17 文件）提供基础设施
- `rust-vexus-lite/` 提供 Rust N-API 向量引擎和 RiverMemo 拓扑数学
- `TDBKnowledge.js`（1290 行）管理冷知识库
- 记忆系统通过 `server.js` 单例初始化，通过 `Plugin.js` 依赖注入到插件

总计约 15,000+ 行 JS 代码 + Rust 原生组件。

### 1.2 目标

将记忆系统提取为独立 npm 库 `vcp-memory`，采用管道式输入-处理-输出（IPO）架构，使每个记忆操作成为显式管道，每个处理阶段可独立替换、重组和测试。

### 1.3 设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 目标形态 | 独立 npm 库 | 可被任何 Node.js 应用 require 使用 |
| Rust 引擎 | 必需依赖，打包 | 保持算法完整性，性能最佳 |
| 提取范围 | 核心引擎 + 冷知识库 | 不含上层插件（RAGDiaryPlugin、DailyNote 等） |
| 嵌入层 | 接口 + 默认实现 | 定义 EmbeddingProvider 接口，内置 OpenAI 兼容实现 |
| 架构方案 | 管道式完整 IPO 重构 | 最大可复用性和可组合性 |

---

## 2. 整体架构 - 管道式 IPO 模型

### 2.1 核心思想

每个记忆操作是一条显式管道（Pipeline），由若干阶段（Stage）组成。每个阶段是纯粹的输入 -> 处理 -> 输出单元，可独立替换、重组和测试。

```
Pipeline (管道)
  ┌──────┐   ┌──────┐   ┌──────┐   ┌──────┐
  │Stage1│──▶│Stage2│──▶│Stage3│──▶│Stage4│──▶ Output
  └──────┘   └──────┘   └──────┘   └──────┘
    输入       处理       处理       输出
```

### 2.2 三条核心管道

1. **IngestPipeline（摄入管道）**：`文件 -> 读取 -> 提取Tag -> 分块 -> 嵌入 -> 写DB -> 更新索引 -> 构建共现矩阵`
2. **SearchPipeline（检索管道）**：`查询 -> 嵌入 -> EPA投影 -> 残差金字塔 -> 向量检索 -> Tag扩展 -> TagMemo/RiverMemo增强 -> 去重 -> Rerank -> 截断 -> 格式化`
3. **TDBSearchPipeline（冷知识检索管道）**：`查询 -> 嵌入 -> BM25 -> 向量检索 -> 图扩散 -> 合并 -> Rerank -> 去重`

### 2.3 Stage 契约

每个阶段实现统一接口：

```js
class Stage {
  /**
   * @param {any} input - 上一阶段的输出
   * @param {PipelineContext} ctx - 共享上下文（依赖、配置）
   * @returns {Promise<any>} output - 传给下一阶段
   */
  async process(input, ctx) {}
}
```

- `input`/`output` 是强类型数据对象（JSDoc 标注）
- `context` 携带配置、EmbeddingProvider、VectorStore 等共享依赖
- 阶段之间通过明确的数据对象传递，不共享可变状态

### 2.4 可组合性

用户可以自定义管道——插入、移除或替换任何阶段：

```js
const pipeline = createSearchPipeline({
  stages: [embed, epaProject, vectorSearch, tagMemoV9, dedup, myCustomReranker, format]
});
```

---

## 3. 模块结构

### 3.1 目录布局

```
vcp-memory/
├── package.json
├── index.js                              # 公开 API 入口
│
├── src/
│   ├── engine.js                         # MemoryEngine 工厂 + 管道编排
│   ├── types.js                          # JSDoc 类型定义
│   │
│   ├── core/                             # 管道基础设施
│   │   ├── pipeline.js                   # Pipeline 组合器
│   │   ├── stage.js                      # Stage 基类/接口
│   │   └── context.js                    # PipelineContext（携带依赖和配置）
│   │
│   ├── interfaces/                       # 可替换接口（契约）
│   │   ├── embedding-provider.js         # embed(texts) -> vectors
│   │   ├── vector-store.js               # add/search/remove 向量操作
│   │   └── metadata-store.js             # 文件/chunk/tag 的 CRUD
│   │
│   ├── providers/                        # 默认实现
│   │   ├── openai-embedding-provider.js  # ← EmbeddingUtils.js 改造
│   │   ├── vexus-vector-store.js         # ← Rust VexusIndex 封装
│   │   └── sqlite-metadata-store.js      # ← modules/knowledgeBase/ 合并
│   │
│   ├── pipelines/                        # 管道定义（组合阶段）
│   │   ├── ingest-pipeline.js            # 摄入管道
│   │   ├── search-pipeline.js            # 检索管道
│   │   ├── delete-pipeline.js            # 删除管道
│   │   └── tdb-search-pipeline.js        # 冷知识检索管道
│   │
│   ├── stages/                           # 可复用管道阶段（含 I/O）
│   │   ├── ingestion/
│   │   │   ├── file-reader.js            # ← fileWatcher.js
│   │   │   ├── tag-extractor.js          # ← textPreprocessor.js
│   │   │   ├── text-chunker.js           # ← TextChunker.js
│   │   │   ├── chunk-embedder.js         # 调用 EmbeddingProvider
│   │   │   ├── tag-embedder.js
│   │   │   ├── metadata-writer.js        # 写 SQLite
│   │   │   ├── vector-indexer.js         # 写 VexusIndex
│   │   │   └── cooccurrence-builder.js
│   │   │
│   │   ├── retrieval/
│   │   │   ├── query-embedder.js
│   │   │   ├── vector-searcher.js        # KNN 检索
│   │   │   ├── bm25-searcher.js          # BM25 稀疏检索
│   │   │   └── candidate-merger.js       # 多源候选合并
│   │   │
│   │   ├── memo/                         # TagMemo/RiverMemo 增强阶段
│   │   │   ├── epa-projector.js          # EPA 投影（调用算法层）
│   │   │   ├── residual-pyramid.js       # 残差金字塔（调用算法层）
│   │   │   ├── tag-expander.js           # 核心标签补全 + 关联扩展
│   │   │   ├── vector-reshaper.js        # 向量融合
│   │   │   ├── tagmemo-v9.js             # ← TagMemoEngine.js (4137行)
│   │   │   ├── tagmemo-v10.js            # ← TagMemoV10Engine.js (1777行)
│   │   │   ├── rivermemo.js              # ← RiverMemoEngine.js (839行)
│   │   │   └── geodesic-reranker.js      # 测地线重排
│   │   │
│   │   ├── postprocess/
│   │   │   ├── result-deduplicator.js    # ← ResultDeduplicator.js
│   │   │   ├── external-reranker.js      # 外部 Rerank API
│   │   │   ├── time-decay.js
│   │   │   ├── truncator.js
│   │   │   ├── expander.js
│   │   │   └── associator.js
│   │   │
│   │   └── output/
│   │       └── result-formatter.js
│   │
│   ├── algorithms/                       # 纯算法（无 I/O，可独立测试）
│   │   ├── epa.js                        # ← EPAModule.js (加权 PCA + 熵)
│   │   ├── residual-pyramid.js           # ← ResidualPyramid.js (Gram-Schmidt)
│   │   ├── gram-schmidt.js               # 正交化原语
│   │   ├── svd.js                        # 加权 PCA / SVD
│   │   ├── wave-propagation.js           # 浪潮传播 (Spike/LIF)
│   │   └── topology/                     # ← modules/tagmemoV10/ (17文件)
│   │       ├── field-solver.js
│   │       ├── path-geometry.js
│   │       ├── relative-topology.js
│   │       ├── dstc-observables.js
│   │       ├── candidate-superset.js
│   │       ├── direct-anchor.js
│   │       ├── omega-functional.js
│   │       └── ... (其余拓扑组件)
│   │
│   ├── tdb/                              # 冷知识库（独立子系统）
│   │   ├── tdb-engine.js                 # ← TDBKnowledge.js
│   │   ├── tdb-pipelines.js              # 冷知识检索管道
│   │   └── triviumdb-adapter.js          # TriviumDB 适配器
│   │
│   ├── config/
│   │   ├── default-config.js             # 默认配置
│   │   └── rag-params-loader.js          # ← rag_params.json 加载器
│   │
│   └── utils/
│       ├── worker-pool.js                # ← WorkerPool.js
│       ├── sqlite-health.js              # ← sqliteHealthManager.js
│       ├── vector-codec.js               # ← vectorCodec.js
│       ├── text-preprocessor.js          # ← textPreprocessor.js
│       └── memory-profiler.js            # ← memoryProfiler.js
│
├── rust-vexus-lite/                      # Rust N-API（原样打包）
│   └── ... (现有文件不动)
│
└── tests/
    ├── algorithms/                       # 纯算法单测
    ├── stages/                           # 阶段单测
    └── pipelines/                        # 管道集成测试
```

### 3.2 设计原则

- `algorithms/` 是纯数学，零 I/O 依赖，可独立测试和复用
- `stages/` 包装算法并处理 I/O（调用 providers）
- `interfaces/` 定义契约，`providers/` 提供默认实现
- `modules/tagmemoV10/` 的 17 个文件归入 `algorithms/topology/`，作为 RiverMemo 拓扑 V3 的内部实现
- `modules/knowledgeBase/` 的 14 个文件拆分：基础设施归入 `providers/` 和 `utils/`，管线逻辑归入 `pipelines/` 和 `stages/`
- TDB 冷知识库作为独立子系统 `tdb/`，复用同样的接口但有自己的管道

---

## 4. 接口契约与数据类型

### 4.1 核心数据类型

```js
// 摄入相关
/** @typedef {{ path: string, content: string, diaryName: string, mtime: number }} FileInput */
/** @typedef {{ text: string, tags: string[], diaryName: string, filePath: string }} ParsedDocument */
/** @typedef {{ index: number, content: string, vector: Float32Array|null }} Chunk */
/** @typedef {{ name: string, vector: Float32Array|null }} Tag */

// 检索相关
/** @typedef {{ text: string, diaryNames: string[], k: number, modifiers: SearchModifiers }} SearchRequest */
/** @typedef {{ boost?: number, tagMemo?: 'v9'|'v10'|'riverMemo', rerank?: boolean, truncate?: number, expand?: boolean, timeDecay?: object }} SearchModifiers */
/** @typedef {{ chunkId: number, content: string, score: number, filePath: string, diaryName: string, vector: Float32Array|null, tags: string[] }} SearchResult */
/** @typedef {{ queryVector: Float32Array, epaResult: EpaResult, pyramidFeatures: PyramidFeatures, candidates: SearchResult[], reshapedVector: Float32Array|null }} SearchContext */
```

### 4.2 EmbeddingProvider 接口

```js
class EmbeddingProvider {
  /** @param {string[]} texts @returns {Promise<Float32Array[]>} */
  async embedBatch(texts) {}

  /** @param {string} text @returns {Promise<Float32Array>} */
  async embed(text) {}

  /** @returns {number} */
  getDimension() {}
}
```

### 4.3 VectorStore 接口

```js
class VectorStore {
  /** 添加向量到指定索引 @param {string} indexName @param {number} id @param {Float32Array} vector */
  async add(indexName, id, vector) {}

  /** 批量添加 */
  async addBatch(indexName, ids, vectors) {}

  /** KNN 搜索 @returns {Array<{id:number, score:number}>} */
  async search(indexName, queryVector, k) {}

  /** 删除向量 */
  async remove(indexName, id) {}

  /** 加载/保存/统计 */
  async loadIndex(indexName, path) {}
  async saveIndex(indexName, path) {}
  async getIndexStats(indexName) {}
}
```

### 4.4 MetadataStore 接口

```js
class MetadataStore {
  // 文件 CRUD
  async upsertFile(fileMeta) {}
  async getFileByPath(path) {}
  async deleteFile(fileId) {}

  // Chunk CRUD
  async insertChunks(fileId, chunks) {}
  async getChunksByFileId(fileId) {}
  async getChunkById(id) {}

  // Tag CRUD
  async upsertTags(tags) {}
  async getTagByName(name) {}
  async getAllTags() {}
  async setFileTags(fileId, tagIds) {}
  async getFileTags(fileId) {}

  // 共现矩阵
  async buildCooccurrenceMatrix() {}

  // 健康检查与恢复
  async checkpoint() {}
  async healthCheck() {}
}
```

### 4.5 Stage 与 Pipeline 契约

```js
class Stage {
  /**
   * @param {any} input - 上一阶段的输出
   * @param {PipelineContext} ctx - 共享上下文（依赖、配置）
   * @returns {Promise<any>} output - 传给下一阶段
   */
  async process(input, ctx) {}
}

class Pipeline {
  constructor(stages) { this.stages = stages; }

  /**
   * @param {any} initialInput - 管道初始输入
   * @param {PipelineContext} ctx - 共享上下文
   * @returns {Promise<any>} 最终输出
   */
  async run(initialInput, ctx) {
    let data = initialInput;
    for (const stage of this.stages) {
      data = await stage.process(data, ctx);
    }
    return data;
  }

  /** 链式添加阶段，返回新 Pipeline（不可变） */
  pipe(stage) { return new Pipeline([...this.stages, stage]); }

  /** 替换指定阶段 */
  replace(stageName, newStage) {}
}

class PipelineContext {
  constructor({ config, embeddingProvider, vectorStore, metadataStore, vexusIndex }) {
    this.config = config;
    this.embeddingProvider = embeddingProvider;
    this.vectorStore = vectorStore;
    this.metadataStore = metadataStore;
    this.vexusIndex = vexusIndex;  // Rust 原生句柄（算法层直接调用）
  }
}
```

### 4.6 设计要点

- 三个可替换接口（EmbeddingProvider、VectorStore、MetadataStore）覆盖所有 I/O 依赖
- Stage 只做一次转换：`input -> output`，通过 `ctx` 访问共享依赖
- Pipeline 不可变组合：`pipe()` 返回新管道，支持灵活重组
- `PipelineContext` 是依赖注入容器，避免阶段间隐式耦合
- `vexusIndex` 直接暴露给算法层，因为 RiverMemo 拓扑 V3 需要直接调用 Rust 原生函数

---

## 5. 管道详细设计

### 5.1 IngestPipeline（摄入管道）

```
输入: FileInput { path, content, diaryName, mtime }
    │
    ▼
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│  FileReader     │──▶│  TagExtractor   │──▶│  TextChunker    │
│  读取文件内容    │   │  提取 Tag 行     │   │  分块           │
└─────────────────┘   └─────────────────┘   └────────┬────────┘
                                                     │
                           ┌─────────────────────────┴──────────┐
                           ▼                                    ▼
                   ┌─────────────────┐              ┌─────────────────┐
                   │ ChunkEmbedder   │              │  TagEmbedder    │
                   │ 嵌入文本块      │              │  嵌入标签       │
                   └────────┬────────┘              └────────┬────────┘
                            │                                │
                            ▼                                ▼
                   ┌─────────────────┐              ┌─────────────────┐
                   │ MetadataWriter  │◀─────────────│  (共享 fileId)   │
                   │ 写 SQLite       │              │                 │
                   └────────┬────────┘              └─────────────────┘
                            │
                            ▼
                   ┌─────────────────┐   ┌─────────────────────────┐
                   │ VectorIndexer   │──▶│ CooccurrenceBuilder     │
                   │ 写 VexusIndex   │   │ 重建 Tag 共现矩阵       │
                   └─────────────────┘   └─────────────────────────┘
                            │
                            ▼
输出: IngestResult { success, fileId, chunkCount, tagCount }
```

**阶段说明：**

| 阶段 | 输入 | 输出 | 依赖 |
|------|------|------|------|
| FileReader | FileInput | { content, diaryName, mtime } | fs |
| TagExtractor | { content } | { content, tags: string[] } | textPreprocessor |
| TextChunker | { content } | { chunks: Chunk[] (无向量) } | @dqbd/tiktoken |
| ChunkEmbedder | { chunks } | { chunks: Chunk[] (含向量) } | EmbeddingProvider |
| TagEmbedder | { tags } | { tags: Tag[] (含向量) } | EmbeddingProvider |
| MetadataWriter | { fileMeta, chunks, tags } | { fileId, chunkIds, tagIds } | MetadataStore |
| VectorIndexer | { chunkIds, chunkVectors, diaryName } | { indexed: true } | VectorStore |
| CooccurrenceBuilder | { fileId, tagIds } | { cooccurrenceUpdated: true } | MetadataStore |

### 5.2 SearchPipeline（检索管道）

分为**核心阶段**（始终执行）和**可选阶段**（由 modifiers 控制）：

```
输入: SearchRequest { text, diaryNames, k, modifiers }
    │
    ▼  ──── 核心阶段 ────
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────────┐
│ QueryEmbedder   │──▶│ EPAProjector    │──▶│ ResidualPyramid     │
│ 嵌入查询向量     │   │ 逻辑深度+共振    │   │ 特征提取(覆盖率等)  │
└─────────────────┘   └─────────────────┘   └──────────┬──────────┘
                                                        │
                                                        ▼
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────────┐
│ VectorSearcher  │──▶│ TagExpander     │──▶│ VectorReshaper      │
│ KNN 向量检索    │   │ 核心标签补全    │   │ 动态Beta向量融合    │
│                 │   │ +共现扩展       │   │                     │
└─────────────────┘   └─────────────────┘   └──────────┬──────────┘
                                                        │
    ══════════════════ 可选阶段（modifiers） ═══════════│════════
                                                        │
              ┌─────────────────────────┬───────────────┴───────────────┐
              ▼                         ▼                               ▼
    ┌──────────────────┐    ┌──────────────────┐           ┌──────────────────┐
    │ TagMemoV9        │    │ TagMemoV10       │  互斥选择  │ RiverMemo        │
    │ (modifiers.tagMe │    │ (modifiers.tagMe │           │ (modifiers.tagMe │
    │  mo='v9')        │    │  mo='v10')       │           │  mo='riverMemo') │
    │ 浪潮传播增强     │    │ 拓扑V3增强       │           │ Ω泛函拓扑检索    │
    └────────┬─────────┘    └────────┬─────────┘           └────────┬─────────┘
             │                       │                              │
             └───────────┬───────────┘                              │
                         ▼                                          ▼
              ┌──────────────────┐                   ┌──────────────────────────┐
              │ GeodesicReranker │  (仅 TagMemo+)    │ (RiverMemo 内含排序)     │
              │ 测地线重排       │                   │                          │
              └────────┬─────────┘                   └──────────┬───────────────┘
                       │                                        │
                       └────────────────┬───────────────────────┘
                                        ▼
    ──── 后处理阶段 ────
              ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
              │ResultDeduplicator│──▶│ExternalReranker  │──▶│ TimeDecay         │
              │ SVD语义去重      │   │ 外部Rerank API   │   │ 时间衰减(可选)    │
              └──────────────────┘   └──────────────────┘   └────────┬─────────┘
                                                                       │
                   ┌──────────────────┐   ┌──────────────────┐        ▼
                   │ Expander         │──▶│ Associator       │──▶┌──────────────────┐
                   │ 展开父文件(可选) │   │ 关联发现(可选)   │  │ Truncator        │
                   └──────────────────┘   └──────────────────┘  │ 分数截断(可选)   │
                                                                       └────────┬─────────┘
                                                                                │
                                                                                ▼
                                                                       ┌──────────────────┐
                                                                       │ ResultFormatter  │
                                                                       │ 格式化输出       │
                                                                       └────────┬─────────┘
                                                                                │
                                                                                ▼
输出: SearchResult[] { chunkId, content, score, filePath, diaryName, vector, tags }
```

**可选阶段通过管道构建器注入：**

```js
const pipeline = createSearchPipeline({
  memoEngine: 'riverMemo',     // 'v9' | 'v10' | 'riverMemo' | null
  rerank: { enabled: true, mode: 'rrf', weight: 0.7 },
  timeDecay: { halfLifeDays: 30, minScore: 0.5 },
  truncate: 0.4,
  expand: true,
  associate: true,
});
```

**核心阶段说明：**

| 阶段 | 输入 | 输出 | 依赖 |
|------|------|------|------|
| QueryEmbedder | SearchRequest | { queryVector, request } | EmbeddingProvider |
| EPAProjector | { queryVector } | { queryVector, epaResult } | algorithms/epa |
| ResidualPyramid | { queryVector, epaResult } | { queryVector, epaResult, pyramidFeatures } | algorithms/residual-pyramid, VectorStore |
| VectorSearcher | { queryVector, diaryNames, k } | { candidates, ... } | VectorStore |
| TagExpander | { candidates, pyramidFeatures } | { candidates, expandedTags } | MetadataStore |
| VectorReshaper | { queryVector, expandedTags, epaResult, pyramidFeatures } | { reshapedVector, ... } | algorithms (动态 Beta) |

**可选阶段说明：**

| 阶段 | 触发条件 | 依赖 |
|------|----------|------|
| TagMemoV9 | modifiers.tagMemo='v9' | algorithms/wave-propagation, VectorStore |
| TagMemoV10 | modifiers.tagMemo='v10' | algorithms/topology, Rust N-API |
| RiverMemo | modifiers.tagMemo='riverMemo' | algorithms/topology, Rust N-API |
| GeodesicReranker | TagMemo+ 模式 | algorithms |
| ResultDeduplicator | 始终执行 | algorithms/svd |
| ExternalReranker | modifiers.rerank | HTTP API |
| TimeDecay | modifiers.timeDecay | - |
| Truncator | modifiers.truncate | - |
| Expander | modifiers.expand | MetadataStore |
| Associator | modifiers.associate | VectorStore, MetadataStore |

### 5.3 DeletePipeline（删除管道）

```
输入: { filePath } 或 { diaryName, fileName }
    │
    ▼
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│ FileLookup      │──▶│ ChunkLocator    │──▶│ VectorRemover   │
│ 查找文件元数据  │   │ 获取 chunk IDs  │   │ 从索引移除向量  │
└─────────────────┘   └─────────────────┘   └────────┬────────┘
                                                     │
                                                     ▼
┌─────────────────┐   ┌─────────────────────────────────────────┐
│ MetadataCleaner │──▶│ CooccurrenceBuilder (异步重建)          │
│ 删除DB记录+关联 │   │                                         │
└─────────────────┘   └─────────────────────────────────────────┘
    │
    ▼
输出: DeleteResult { success, removedChunks, removedTags }
```

### 5.4 TDBSearchPipeline（冷知识检索管道）

```
输入: SearchRequest { text, knowledgeBaseNames, k, modifiers }
    │
    ▼
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│ QueryEmbedder   │──▶│ BM25Searcher    │──▶│ VectorSearcher  │
│ 嵌入查询向量     │   │ 稀疏检索        │   │ 稠密向量检索    │
└─────────────────┘   └────────┬────────┘   └────────┬────────┘
                               │                      │
                               ▼                      ▼
                    ┌──────────────────────────────────────┐
                    │        CandidateMerger               │
                    │  合并 BM25 + 向量候选 + 图扩散       │
                    └──────────────────┬───────────────────┘
                                       │
                    ──── 后处理（同热记忆，但无 TagMemo/RiverMemo）────
                                       │
                                       ▼
                    ┌──────────┬───────┴───────┬──────────┐
                    ▼          ▼               ▼          ▼
              Reranker    Deduplicator     Truncator   Formatter
                    └──────────┴───────┬───────┴──────────┘
                                       ▼
输出: SearchResult[]
```

**TDB 与热记忆的关键差异：** 无 TagMemo/RiverMemo/Time/Associate，支持 BM25+ 图扩散，独立嵌入模型配置。

---

## 6. 公开 API 与配置

### 6.1 公开 API

```js
const { createMemoryEngine } = require('vcp-memory');

const engine = await createMemoryEngine({
  embedding: { /* 嵌入配置 */ },
  storage:   { /* 存储配置 */ },
  ragParams: { /* 算法参数 */ },
  watch:     { /* 文件监听 */ },
  tdb:       { /* 冷知识库配置 */ },
});

// ─── 摄入 ───
await engine.ingestFile({ path: './dailynote/小克/2026-07-13.md' });
await engine.ingestText({ content: '...', diaryName: '小克', tags: ['VCP', '记忆'] });

// ─── 检索 ───
const results = await engine.search({
  text: '记忆系统重构进展',
  diaryNames: ['小克'],
  k: 5,
  modifiers: {
    tagMemo: 'riverMemo',
    rerank: { mode: 'rrf', weight: 0.7 },
    truncate: 0.4,
    expand: true,
  },
});

// ─── 删除 ───
await engine.deleteFile({ filePath: './dailynote/小克/2026-07-13.md' });

// ─── TDB 冷知识检索 ───
const coldResults = await engine.tdbSearch({
  text: 'ContextBridge 如何共享检索能力',
  knowledgeBaseNames: ['VCP知识'],
  k: 5,
  modifiers: { rerank: true, truncate: 0.4 },
});

// ─── 生命周期 ───
await engine.shutdown();
```

### 6.2 高级 API（管道自定义）

```js
// 获取默认管道，然后自定义
const myPipeline = engine.createSearchPipeline({
  memoEngine: 'v9',
  stages: {
    afterVectorSearch: [myCustomFilterStage],
    replaceDeduplicator: myCustomDedupStage,
    skipExpander: true,
  },
});
const results = await myPipeline.run(searchRequest, engine.context);

// 直接使用算法层（脱离管道）
const { EPA, ResidualPyramid, GramSchmidt } = require('vcp-memory/algorithms');
const epa = new EPA({ basisMean, orthoBasis });
const { logicDepth, dominantAxes } = epa.project(queryVector);

// 直接使用阶段
const { VectorSearcher, ResultDeduplicator } = require('vcp-memory/stages');
```

### 6.3 配置结构

```js
await createMemoryEngine({
  // ─── 嵌入层 ───
  embedding: {
    provider: 'openai',           // 内置默认 | EmbeddingProvider 实例
    apiUrl: 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY,
    model: 'text-embedding-3-large',
    modelSig: 'text-embedding-3-large',  // 语义签名（缓存失效用）
    dimension: 3072,
    maxBatchItems: 32,
    maxToken: 8000,
    fallbackModels: ['gemini-embedding-2-preview'],
  },

  // ─── 存储层 ───
  storage: {
    storePath: './data/vectordb',
    rootPath: './data/dailynote',
    dimension: 3072,
    tagIndexCapacity: 50000,
    sqliteBusyTimeout: 5000,
    sqliteBusyRetryDelay: 100,
    indexSaveDelay: 120000,
    tagIndexSaveDelay: 300000,
    persistTagIndex: true,
    indexIdleTtl: 600000,
    indexIdleSweep: 60000,
    batchWindowMs: 1000,
    maxBatchSize: 50,
    deleteBatchWindowMs: 2000,
    maxDeleteBatchSize: 50,
    fullScanOnStartup: true,
  },

  // ─── 算法参数（对应 rag_params.json）───
  ragParams: {
    // 可直接传对象，或传文件路径让库自动加载
    // file: './rag_params.json',
    tagMemoVersioning: { activeVersion: 'v9', singleTrack: true },
    v9: { outboundMass: 0.95, wormholeGain: 1.35 },
    riverMemo: { enabled: false },
    activationMultiplier: [0.5, 1.5],
    dynamicBoostRange: [0.3, 2.0],
    coreBoostRange: [1.20, 1.40],
    deduplicationThreshold: 0.88,
    resultDeduplication: { semanticThreshold: 0.92, maxResults: 1000 },
  },

  // ─── 文件监听 ───
  watch: {
    enabled: true,
    ignoreFolders: ['VCP论坛'],
    ignorePrefixes: ['已整理'],
    ignoreSuffixes: ['夜伽'],
    tagBlacklist: [],
    maxTagsPerFile: 50,
    tagExpandMaxCount: 30,
  },

  // ─── TDB 冷知识库 ───
  tdb: {
    enabled: true,
    rootPath: './data/knowledge',
    storePath: './data/vectordb-tdb',
    dimension: 3072,
    model: 'gemini-embedding-2-preview',
    batchSize: 16,
  },

  // ─── 语言门控 ───
  languageGating: {
    enabled: true,
    penaltyUnknown: 0.05,
    penaltyCrossDomain: 0.1,
  },
});
```

### 6.4 配置默认值

所有配置有合理默认值，最小配置只需 `embedding.apiKey` 和路径。`ragParams` 可以传对象或文件路径（兼容现有 `rag_params.json`）。`embedding.provider` 接受字符串（用内置默认）或自定义 `EmbeddingProvider` 实例。

---

## 7. 迁移路径与实现策略

### 7.1 迁移分阶段策略

提取按依赖关系从底层到上层分 7 个阶段，每阶段可独立验证：

```
Phase 1: 包骨架  ->  Phase 2: 纯算法  ->  Phase 3: 接口+Provider
    ->  Phase 4: Stage  ->  Phase 5: Pipeline  ->  Phase 6: TDB  ->  Phase 7: 接入
```

### 7.2 Phase 1：包骨架

```
vcp-memory/
├── package.json        # deps: better-sqlite3, chokidar, @dqbd/tiktoken
├── index.js            # 导出 createMemoryEngine
├── src/
└── rust-vexus-lite/    # 原样复制（含预编译二进制）
```

### 7.3 Phase 2：纯算法提取（零 I/O 依赖，最先提取）

| 源文件 | 目标 | 改造 |
|--------|------|------|
| `EPAModule.js` (742行) | `src/algorithms/epa.js` | 移除 `db`/`vexusIndex` 构造参数，改为传入预加载的 basis 数据 |
| `ResidualPyramid.js` (395行) | `src/algorithms/residual-pyramid.js` | 移除 `tagIndex`/`db`，改为传入 tag 向量数组 |
| (新文件) | `src/algorithms/gram-schmidt.js` | 从 ResidualPyramid 提取纯正交化原语 |
| (新文件) | `src/algorithms/svd.js` | 从 EPAModule 提取纯加权 PCA |
| `modules/tagmemoV10/` (17文件) | `src/algorithms/topology/` | 整体移入，移除对 KnowledgeBaseManager 的回调引用 |

**验证：** 纯算法单测（输入向量 -> 输出特征，无 I/O）

### 7.4 Phase 3：接口 + Provider 提取

| 源文件 | 目标 | 改造 |
|--------|------|------|
| (新文件) | `src/interfaces/embedding-provider.js` | 定义接口 |
| (新文件) | `src/interfaces/vector-store.js` | 定义接口 |
| (新文件) | `src/interfaces/metadata-store.js` | 定义接口 |
| `EmbeddingUtils.js` (266行) | `src/providers/openai-embedding-provider.js` | 实现 EmbeddingProvider 接口 |
| `rust-vexus-lite/index.js` | `src/providers/vexus-vector-store.js` | 封装为 VectorStore 接口 |
| `modules/knowledgeBase/` (14文件) | `src/providers/sqlite-metadata-store.js` + `src/utils/` | 合并 SQLite 相关文件为 MetadataStore 实现 |

**验证：** Provider 集成测试（真实 SQLite + VexusIndex）

### 7.5 Phase 4：Stage 提取

| 源逻辑 | 目标 Stage | 改造 |
|--------|-----------|------|
| KnowledgeBaseManager `_flushBatch` | `stages/ingestion/*` | 拆分为 8 个独立阶段 |
| KnowledgeBaseManager `search` | `stages/retrieval/*` | 拆分为查询嵌入、KNN、BM25、合并 |
| KnowledgeBaseManager TagMemo 调用链 | `stages/memo/*` | 每个算法包装为一个 Stage |
| KnowledgeBaseManager 后处理 | `stages/postprocess/*` | 去重、Rerank、截断等各自独立 |
| `TagMemoEngine.js` (4137行) | `stages/memo/tagmemo-v9.js` + 内部算法 | 拆分：纯算法归 algorithms/，I/O 包装归 stage |
| `TagMemoV10Engine.js` (1777行) | `stages/memo/tagmemo-v10.js` | 同上 |
| `RiverMemoEngine.js` (839行) | `stages/memo/rivermemo.js` | 同上 |
| `ResultDeduplicator.js` (417行) | `stages/postprocess/result-deduplicator.js` | 几乎不变 |

### 7.6 Phase 5：Pipeline 组装 + Engine 工厂

| 源逻辑 | 目标 | 改造 |
|--------|------|------|
| KnowledgeBaseManager 初始化 | `src/engine.js` `createMemoryEngine()` | 单例 -> 工厂 |
| search/ingest/delete 流程 | `src/pipelines/*.js` | 组装 Stage 为管道 |
| `rag_params.json` 加载 | `src/config/rag-params-loader.js` | 独立配置加载器 |

**验证：** 端到端测试（摄入文件 -> 检索 -> 验证结果）

### 7.7 Phase 6：TDB 冷知识提取

| 源文件 | 目标 | 改造 |
|--------|------|------|
| `TDBKnowledge.js` (1290行) | `src/tdb/tdb-engine.js` + `src/tdb/tdb-pipelines.js` | 同样管道化 |

### 7.8 Phase 7：VCPToolBox 接入

```js
// server.js:
// - const knowledgeBaseManager = require('./KnowledgeBaseManager.js')
// + const { createMemoryEngine } = require('./vcp-memory')
// + const knowledgeBaseManager = await createMemoryEngine({...})

// Plugin.js:
// - setVectorDBManager(knowledgeBaseManager)  # 不变，engine 兼容旧接口
// - 适配层：engine 暴露旧 API 方法（search, applyTagBoostAsync 等）
```

**验证：** 在 VCPToolBox 中启动 server.js，验证 RAG 检索正常

### 7.9 兼容性策略

为避免一次性破坏 VCPToolBox，`engine.js` 返回的对象同时暴露：
- **新管道 API**：`engine.search()`, `engine.ingestFile()`, `engine.tdbSearch()`
- **旧兼容 API**：`engine.applyTagBoostAsync()`, `engine.runExternalFileMutation()`, `engine.getHealthStatus()` 等

旧 API 作为薄适配层委托到新管道，使 VCPToolBox 的插件和路由无需立即修改。

### 7.10 验证策略

每个 Phase 完成后验证：
1. **Phase 2**：纯算法单测（输入向量 -> 输出特征，无 I/O）
2. **Phase 3**：Provider 集成测试（真实 SQLite + VexusIndex）
3. **Phase 4-5**：端到端测试（摄入文件 -> 检索 -> 验证结果）
4. **Phase 7**：在 VCPToolBox 中启动 server.js，验证 RAG 检索正常

---

## 8. 现有文件清单

### 8.1 需要提取的源文件

| 文件 | 行数 | 目标位置 |
|------|------|----------|
| `KnowledgeBaseManager.js` | 2355 | 拆分到 `engine.js` + `pipelines/` + `stages/` |
| `TagMemoEngine.js` | 4137 | `stages/memo/tagmemo-v9.js` + `algorithms/` |
| `TagMemoV10Engine.js` | 1777 | `stages/memo/tagmemo-v10.js` + `algorithms/topology/` |
| `RiverMemoEngine.js` | 839 | `stages/memo/rivermemo.js` |
| `EPAModule.js` | 742 | `algorithms/epa.js` + `algorithms/svd.js` |
| `TDBKnowledge.js` | 1290 | `tdb/tdb-engine.js` + `tdb/tdb-pipelines.js` |
| `ResidualPyramid.js` | 395 | `algorithms/residual-pyramid.js` + `algorithms/gram-schmidt.js` |
| `ResultDeduplicator.js` | 417 | `stages/postprocess/result-deduplicator.js` |
| `EmbeddingUtils.js` | 266 | `providers/openai-embedding-provider.js` |
| `TextChunker.js` | 136 | `stages/ingestion/text-chunker.js` |
| `WorkerPool.js` | 130 | `utils/worker-pool.js` |
| `reset_vectordb.js` | 337 | `utils/reset-tool.js` |
| `modules/knowledgeBase/` (14文件) | ~4987 | 拆分到 `providers/` + `utils/` + `stages/` |
| `modules/tagmemoV10/` (17文件) | ~7536 | `algorithms/topology/` |
| `rust-vexus-lite/` | - | 原样打包 |
| `rag_params.json` | 346 | `config/` (兼容加载) |
| **合计** | ~25,000+ | |

### 8.2 不提取的文件（保留在 VCPToolBox）

- `Plugin/RAGDiaryPlugin/` - 上层插件
- `Plugin/DailyNote/` - 日记写入插件
- `Plugin/LightMemo/` - 主动回忆插件
- `Plugin/OneRing/` - 跨窗口记忆插件
- `Plugin/VCPTimeLine/` - 时间线插件
- `Plugin/AgentDream/` - 梦系统插件
- `routes/admin/rag.js` - 管理 API
- `docs/` - 文档

### 8.3 新建的文件

| 文件 | 用途 |
|------|------|
| `package.json` | 包定义 |
| `index.js` | 公开 API 入口 |
| `src/engine.js` | Engine 工厂 |
| `src/types.js` | JSDoc 类型 |
| `src/core/pipeline.js` | Pipeline 组合器 |
| `src/core/stage.js` | Stage 基类 |
| `src/core/context.js` | PipelineContext |
| `src/interfaces/*.js` | 3 个接口定义 |
| `src/config/default-config.js` | 默认配置 |
| `src/config/rag-params-loader.js` | 配置加载器 |
| `tests/**` | 测试文件 |

---

## 9. 依赖关系

### 9.1 npm 依赖

```json
{
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "chokidar": "^3.6.0",
    "@dqbd/tiktoken": "^1.0.0"
  },
  "optionalDependencies": {
    "triviumdb": "*"
  }
}
```

### 9.2 原生依赖

- `rust-vexus-lite` - Rust N-API 向量引擎（打包预编译二进制，6 平台）

### 9.3 对外暴露的入口

```js
// 主入口
const { createMemoryEngine } = require('vcp-memory');

// 算法层直接访问
const { EPA, ResidualPyramid, GramSchmidt, SVD } = require('vcp-memory/algorithms');

// 阶层直接访问
const { VectorSearcher, ResultDeduplicator, TagMemoV9 } = require('vcp-memory/stages');

// 接口定义（用于自定义实现）
const { EmbeddingProvider, VectorStore, MetadataStore } = require('vcp-memory/interfaces');

// 管道构建
const { Pipeline, Stage, createSearchPipeline, createIngestPipeline } = require('vcp-memory/core');
```

---

## 10. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| TagMemoEngine.js (4137行) 拆分复杂 | 高 | 保留内部逻辑完整性，仅拆分 I/O 边界 |
| RiverMemo Rust N-API 调用链复杂 | 高 | rust-vexus-lite 原样打包，不改 Rust 代码 |
| SQLite 健康管理/恢复逻辑复杂 | 中 | 合并到 sqlite-metadata-store.js，保留恢复逻辑 |
| VCPToolBox 插件依赖旧 API | 中 | 兼容层：engine 暴露旧 API 委托到新管道 |
| 单例 -> 工厂模式转换 | 中 | engine 对象保持兼容旧 singleton 访问模式 |
| 算法层解耦后性能回退 | 低 | 算法层仍直接调用 Rust N-API，不经过抽象层 |

---

## 附录 A: 当前系统调用链参考

### 摄入流程（当前）
```
server.js -> KnowledgeBaseManager._startWatcher() -> chokidar
  -> handleFile() -> _flushBatch()
    -> 读取文件 -> _extractTags() -> chunkText()
    -> getEmbeddingsBatch() -> DB transaction -> VexusIndex.add()
    -> _buildCooccurrenceMatrix()
```

### 检索流程（当前）
```
chatCompletionHandler -> messagePreprocessors -> RAGDiaryPlugin.preprocess()
  -> KnowledgeBaseManager.search()
    -> _preprocessQuery() -> epa.project() -> residualPyramid.analyze()
    -> _searchSpecificIndex() -> tagIndex.search()
    -> tag expansion -> vector reshape (dynamic beta)
    -> [TagMemo] TagMemoEngine.rerank()
    -> [RiverMemo] RiverMemoEngine.rerank()
    -> ResultDeduplicator.deduplicate()
    -> [Rerank] external API
    -> format -> inject RAG block
```

### ContextBridge 流程（当前）
```
Plugin.js -> RAGDiaryPlugin.getContextBridge() -> frozen object
  -> getAggregatedVector(), embedText(), searchDiary(), retrieveDiary()
  -> injected into plugins with requiresContextBridge: true
```
