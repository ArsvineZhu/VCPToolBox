# VCPToolBox 记忆系统提取实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 VCPToolBox 记忆系统提取为独立 npm 库 `vcp-memory`，采用管道式 IPO 架构。

**Architecture:** 7 阶段从底向上提取：包骨架 -> 纯算法 -> 接口+Provider -> Stage -> Pipeline -> TDB -> 接入。每阶段独立可验证。算法层零 I/O 依赖，阶段层包装算法并调用 Provider，管道层组合阶段。

**Tech Stack:** Node.js (CommonJS), Rust N-API (rust-vexus-lite), better-sqlite3, chokidar, @dqbd/tiktoken, node:test

**Spec:** `docs/superpowers/specs/2026-08-08-memory-extraction-design.md`

---

## Phase 1: 包骨架

### Task 1: 创建包目录结构和 package.json

**Files:**
- Create: `vcp-memory/package.json`
- Create: `vcp-memory/index.js`
- Create: `vcp-memory/src/core/pipeline.js`
- Create: `vcp-memory/src/core/stage.js`
- Create: `vcp-memory/src/core/context.js`

- [ ] **Step 1: 创建目录结构**

```powershell
$dirs = @(
    "vcp-memory/src/core",
    "vcp-memory/src/interfaces",
    "vcp-memory/src/providers",
    "vcp-memory/src/pipelines",
    "vcp-memory/src/stages/ingestion",
    "vcp-memory/src/stages/retrieval",
    "vcp-memory/src/stages/memo",
    "vcp-memory/src/stages/postprocess",
    "vcp-memory/src/stages/output",
    "vcp-memory/src/algorithms/topology",
    "vcp-memory/src/tdb",
    "vcp-memory/src/config",
    "vcp-memory/src/utils",
    "vcp-memory/tests/algorithms",
    "vcp-memory/tests/stages",
    "vcp-memory/tests/pipelines"
)
foreach ($d in $dirs) { New-Item -ItemType Directory -Path $d -Force }
```

- [ ] **Step 2: 创建 package.json**

Create `vcp-memory/package.json`:

```json
{
  "name": "vcp-memory",
  "version": "0.1.0",
  "description": "AI memory system with TagMemo wave algorithm, RiverMemo topology, EPA semantic analysis, and residual pyramid",
  "main": "index.js",
  "scripts": {
    "test": "node --test tests/"
  },
  "dependencies": {
    "@dqbd/tiktoken": "^1.0.22",
    "better-sqlite3": "^12.4.1",
    "chokidar": "^3.5.3"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

- [ ] **Step 3: 创建 Pipeline 核心基础设施**

Create `vcp-memory/src/core/stage.js`:

```js
'use strict';

/**
 * @abstract
 * Base class for all pipeline stages.
 * Each stage transforms input -> output via process().
 */
class Stage {
  /**
   * @param {any} input - Output from previous stage
   * @param {import('./context').PipelineContext} ctx - Shared context
   * @returns {Promise<any>} Output for next stage
   */
  async process(input, ctx) {
    throw new Error('Stage.process() must be implemented by subclass');
  }
}

module.exports = Stage;
```

Create `vcp-memory/src/core/pipeline.js`:

```js
'use strict';

/**
 * A pipeline composes stages sequentially.
 * Each stage's output feeds into the next stage's input.
 */
class Pipeline {
  /**
   * @param {import('./stage').Stage[]} stages
   */
  constructor(stages = []) {
    this.stages = stages;
  }

  /**
   * Run all stages in sequence.
   * @param {any} initialInput
   * @param {import('./context').PipelineContext} ctx
   * @returns {Promise<any>}
   */
  async run(initialInput, ctx) {
    let data = initialInput;
    for (const stage of this.stages) {
      data = await stage.process(data, ctx);
    }
    return data;
  }

  /**
   * Return a new Pipeline with an additional stage (immutable).
   * @param {import('./stage').Stage} stage
   * @returns {Pipeline}
   */
  pipe(stage) {
    return new Pipeline([...this.stages, stage]);
  }

  /**
   * Return a new Pipeline with a stage replaced by name.
   * @param {string} stageName
   * @param {import('./stage').Stage} newStage
   * @returns {Pipeline}
   */
  replace(stageName, newStage) {
    return new Pipeline(
      this.stages.map(s => (s.name === stageName ? newStage : s))
    );
  }
}

module.exports = Pipeline;
```

Create `vcp-memory/src/core/context.js`:

```js
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
```

- [ ] **Step 4: 创建 index.js 入口（占位）**

Create `vcp-memory/index.js`:

```js
'use strict';

const Pipeline = require('./src/core/pipeline');
const Stage = require('./src/core/stage');
const PipelineContext = require('./src/core/context');

module.exports = {
  Pipeline,
  Stage,
  PipelineContext,
  createMemoryEngine: null, // Phase 5 中实现
};
```

- [ ] **Step 5: 提交**

```bash
git add vcp-memory/
git commit -m "feat(vcp-memory): create package skeleton with pipeline core"
```

---

### Task 2: 复制 Rust N-API 引擎并验证加载

**Files:**
- Copy: `rust-vexus-lite/` -> `vcp-memory/rust-vexus-lite/`
- Create: `vcp-memory/tests/core/test-load-native.test.js`

- [ ] **Step 1: 复制 rust-vexus-lite 目录**

```powershell
Copy-Item -Path "rust-vexus-lite" -Destination "vcp-memory/rust-vexus-lite" -Recurse
```

- [ ] **Step 2: 写测试验证 Rust 引擎可加载**

Create `vcp-memory/tests/core/test-load-native.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

test('rust-vexus-lite can be required and exposes VexusIndex', () => {
  const native = require('../../rust-vexus-lite');
  assert.ok(native.VexusIndex, 'VexusIndex should be exported');
  assert.ok(typeof native.VexusIndex === 'function', 'VexusIndex should be a constructor');
});

test('VexusIndex can be instantiated with dimension and capacity', () => {
  const { VexusIndex } = require('../../rust-vexus-lite');
  const index = new VexusIndex(128, 1000);
  assert.ok(index, 'VexusIndex instance should be created');
  assert.ok(typeof index.add === 'function', 'add() should exist');
  assert.ok(typeof index.search === 'function', 'search() should exist');
});
```

- [ ] **Step 3: 运行测试**

```bash
node --test vcp-memory/tests/core/test-load-native.test.js
```

Expected: 2 tests pass.

- [ ] **Step 4: 提交**

```bash
git add vcp-memory/rust-vexus-lite/ vcp-memory/tests/core/
git commit -m "feat(vcp-memory): bundle rust-vexus-lite and verify native load"
```

---

## Phase 2: 纯算法提取

### Task 3: 提取 vector-codec 工具（零依赖，最简单）

**Files:**
- Create: `vcp-memory/src/utils/vector-codec.js` (from `modules/knowledgeBase/vectorCodec.js`)
- Test: `vcp-memory/tests/utils/test-vector-codec.test.js`

- [ ] **Step 1: 写失败测试**

Create `vcp-memory/tests/utils/test-vector-codec.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { decodeVectorBlob, encodeVectorBlob } = require('../../src/utils/vector-codec');

test('encodeVectorBlob converts Float32Array to Buffer', () => {
  const vec = new Float32Array([1.0, 2.0, 3.0, 4.0]);
  const buf = encodeVectorBlob(vec);
  assert.ok(Buffer.isBuffer(buf));
  assert.strictEqual(buf.length, 16); // 4 floats * 4 bytes
});

test('decodeVectorBlob converts Buffer back to Float32Array', () => {
  const original = new Float32Array([1.0, 2.0, 3.0, 4.0]);
  const buf = encodeVectorBlob(original);
  const decoded = decodeVectorBlob(buf, 4);
  assert.ok(decoded instanceof Float32Array);
  assert.deepStrictEqual(Array.from(decoded), [1.0, 2.0, 3.0, 4.0]);
});

test('decodeVectorBlob returns null for invalid dimension', () => {
  const buf = Buffer.alloc(16);
  assert.strictEqual(decodeVectorBlob(buf, 0), null);
  assert.strictEqual(decodeVectorBlob(buf, -1), null);
  assert.strictEqual(decodeVectorBlob(null, 4), null);
});

test('decodeVectorBlob passes through Float32Array unchanged', () => {
  const vec = new Float32Array([1.0, 2.0, 3.0]);
  const result = decodeVectorBlob(vec, 3);
  assert.strictEqual(result, vec);
});

test('decodeVectorBlob returns null for mismatched length', () => {
  const buf = Buffer.alloc(8); // 2 floats
  const result = decodeVectorBlob(buf, 4); // expects 4 floats
  assert.strictEqual(result, null);
});
```

- [ ] **Step 2: 验证测试失败**

```bash
node --test vcp-memory/tests/utils/test-vector-codec.test.js
```

Expected: FAIL with "Cannot find module '../../src/utils/vector-codec'"

- [ ] **Step 3: 创建 vector-codec.js**

Copy `modules/knowledgeBase/vectorCodec.js` to `vcp-memory/src/utils/vector-codec.js` without changes (it is already zero-dependency).

```powershell
Copy-Item "modules/knowledgeBase/vectorCodec.js" "vcp-memory/src/utils/vector-codec.js"
```

- [ ] **Step 4: 验证测试通过**

```bash
node --test vcp-memory/tests/utils/test-vector-codec.test.js
```

Expected: 5 tests pass.

- [ ] **Step 5: 提交**

```bash
git add vcp-memory/src/utils/vector-codec.js vcp-memory/tests/utils/
git commit -m "feat(vcp-memory): extract vector-codec utility"
```

---

### Task 4: 提取 text-preprocessor 工具（零依赖）

**Files:**
- Create: `vcp-memory/src/utils/text-preprocessor.js` (from `modules/knowledgeBase/textPreprocessor.js`)
- Test: `vcp-memory/tests/utils/test-text-preprocessor.test.js`

- [ ] **Step 1: 写失败测试**

Create `vcp-memory/tests/utils/test-text-preprocessor.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { prepareTextForEmbedding, extractTags, EMPTY_CONTENT } = require('../../src/utils/text-preprocessor');

test('prepareTextForEmbedding removes decorative emojis', () => {
  const result = prepareTextForEmbedding('hello 😀 world 🎉');
  assert.ok(!result.includes('😀'));
  assert.ok(!result.includes('🎉'));
  assert.ok(result.includes('hello'));
  assert.ok(result.includes('world'));
});

test('prepareTextForEmbedding returns EMPTY_CONTENT for non-string', () => {
  assert.strictEqual(prepareTextForEmbedding(null), EMPTY_CONTENT);
  assert.strictEqual(prepareTextForEmbedding(undefined), EMPTY_CONTENT);
  assert.strictEqual(prepareTextForEmbedding(123), EMPTY_CONTENT);
});

test('prepareTextForEmbedding returns EMPTY_CONTENT for empty string', () => {
  assert.strictEqual(prepareTextForEmbedding('   '), EMPTY_CONTENT);
  assert.strictEqual(prepareTextForEmbedding(''), EMPTY_CONTENT);
});

test('extractTags extracts tags from last line', () => {
  const content = 'Some diary content.\n\nTag: VCP, 记忆系统, 文档';
  const tags = extractTags(content);
  assert.ok(tags.includes('VCP'));
  assert.ok(tags.includes('记忆系统'));
  assert.ok(tags.includes('文档'));
});

test('extractTags returns empty array for content without tags', () => {
  const tags = extractTags('Just some text without tags.');
  assert.deepStrictEqual(tags, []);
});

test('extractTags handles multiple Tag lines at end', () => {
  const content = 'Content here.\nTag: first, second\nTag: third';
  const tags = extractTags(content);
  assert.ok(tags.includes('first'));
  assert.ok(tags.includes('second'));
  assert.ok(tags.includes('third'));
});

test('extractTags does not extract Tag lines from middle of content', () => {
  const content = 'Tag: should_not_extract\n\nMain content here.';
  const tags = extractTags(content);
  assert.deepStrictEqual(tags, []);
});

test('extractTags filters by blacklist', () => {
  const content = 'Content.\nTag: good, bad';
  const tags = extractTags(content, { tagBlacklist: ['bad'] });
  assert.ok(tags.includes('good'));
  assert.ok(!tags.includes('bad'));
});
```

- [ ] **Step 2: 验证测试失败**

```bash
node --test vcp-memory/tests/utils/test-text-preprocessor.test.js
```

Expected: FAIL with module not found.

- [ ] **Step 3: 创建 text-preprocessor.js**

Copy `modules/knowledgeBase/textPreprocessor.js` to `vcp-memory/src/utils/text-preprocessor.js` without changes.

```powershell
Copy-Item "modules/knowledgeBase/textPreprocessor.js" "vcp-memory/src/utils/text-preprocessor.js"
```

- [ ] **Step 4: 验证测试通过**

```bash
node --test vcp-memory/tests/utils/test-text-preprocessor.test.js
```

Expected: 8 tests pass.

- [ ] **Step 5: 提交**

```bash
git add vcp-memory/src/utils/text-preprocessor.js vcp-memory/tests/utils/test-text-preprocessor.test.js
git commit -m "feat(vcp-memory): extract text-preprocessor utility"
```

---

### Task 5: 提取 Gram-Schmidt 正交化原语

**Files:**
- Create: `vcp-memory/src/algorithms/gram-schmidt.js`
- Test: `vcp-memory/tests/algorithms/test-gram-schmidt.test.js`

- [ ] **Step 1: 写失败测试**

Create `vcp-memory/tests/algorithms/test-gram-schmidt.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  dotProduct,
  magnitude,
  normalize,
  orthogonalize,
  orthogonalProjection
} = require('../../src/algorithms/gram-schmidt');

test('dotProduct computes inner product', () => {
  const a = new Float32Array([1, 2, 3]);
  const b = new Float32Array([4, 5, 6]);
  assert.strictEqual(dotProduct(a, b), 32); // 1*4 + 2*5 + 3*6
});

test('magnitude computes L2 norm', () => {
  const v = new Float32Array([3, 4]);
  assert.strictEqual(magnitude(v), 5);
});

test('normalize returns unit vector', () => {
  const v = new Float32Array([3, 4]);
  const n = normalize(v);
  assert.strictEqual(magnitude(n), 1);
});

test('orthogonalize produces orthogonal basis (Modified Gram-Schmidt)', () => {
  const dim = 3;
  const vectors = [
    new Float32Array([1, 0, 0]),
    new Float32Array([1, 1, 0]),
    new Float32Array([1, 1, 1])
  ];
  const { basis, basisCoefficients } = orthogonalize(vectors, dim);

  // Each basis vector should be unit length
  for (const b of basis) {
    assert.ok(Math.abs(magnitude(b) - 1) < 1e-5, 'basis vector should be unit length');
  }

  // Basis vectors should be mutually orthogonal
  for (let i = 0; i < basis.length; i++) {
    for (let j = i + 1; j < basis.length; j++) {
      const dot = dotProduct(basis[i], basis[j]);
      assert.ok(Math.abs(dot) < 1e-5, `basis ${i} and ${j} should be orthogonal, dot=${dot}`);
    }
  }
  assert.strictEqual(basis.length, 3);
});

test('orthogonalize handles linearly dependent vectors', () => {
  const dim = 2;
  const vectors = [
    new Float32Array([1, 0]),
    new Float32Array([2, 0]) // collinear with first
  ];
  const { basis, basisCoefficients } = orthogonalize(vectors, dim);
  assert.strictEqual(basis.length, 1); // only 1 independent vector
  assert.strictEqual(basisCoefficients[1], 0); // second has no contribution
});

test('orthogonalProjection projects vector onto subspace and returns residual', () => {
  const dim = 3;
  const vector = new Float32Array([1, 1, 1]);
  const tags = [
    new Float32Array([1, 0, 0]),
    new Float32Array([0, 1, 0])
  ];
  const { projection, residual } = orthogonalProjection(vector, tags, dim);

  // Projection should be [1, 1, 0]
  assert.ok(Math.abs(projection[0] - 1) < 1e-5);
  assert.ok(Math.abs(projection[1] - 1) < 1e-5);
  assert.ok(Math.abs(projection[2]) < 1e-5);

  // Residual should be [0, 0, 1]
  assert.ok(Math.abs(residual[0]) < 1e-5);
  assert.ok(Math.abs(residual[1]) < 1e-5);
  assert.ok(Math.abs(residual[2] - 1) < 1e-5);

  // Energy conservation: ||v||^2 = ||P||^2 + ||R||^2
  const eOrig = magnitude(vector) ** 2;
  const eProj = magnitude(projection) ** 2;
  const eRes = magnitude(residual) ** 2;
  assert.ok(Math.abs(eOrig - (eProj + eRes)) < 1e-4, 'energy should be conserved');
});
```

- [ ] **Step 2: 验证测试失败**

```bash
node --test vcp-memory/tests/algorithms/test-gram-schmidt.test.js
```

Expected: FAIL with module not found.

- [ ] **Step 3: 实现 gram-schmidt.js**

Create `vcp-memory/src/algorithms/gram-schmidt.js`:

```js
'use strict';

/**
 * Gram-Schmidt orthogonalization primitives.
 * Extracted from ResidualPyramid.js and EPAModule.js.
 * Pure math, zero I/O dependencies.
 */

function dotProduct(v1, v2) {
  let sum = 0;
  for (let i = 0; i < v1.length; i++) sum += v1[i] * v2[i];
  return sum;
}

function magnitude(vec) {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  return Math.sqrt(sum);
}

function normalize(vec) {
  const mag = magnitude(vec);
  if (mag < 1e-9) return new Float32Array(vec.length);
  const result = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) result[i] = vec[i] / mag;
  return result;
}

/**
 * Modified Gram-Schmidt orthogonalization.
 * Converts a set of vectors into an orthonormal basis.
 * @param {Float32Array[]} vectors - Input vectors
 * @param {number} dim - Dimension of each vector
 * @returns {{ basis: Float32Array[], basisCoefficients: Float32Array }}
 */
function orthogonalize(vectors, dim) {
  const n = vectors.length;
  const basis = [];
  const basisCoefficients = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    let v = new Float32Array(vectors[i]);

    // Subtract projections onto existing basis vectors
    for (let j = 0; j < basis.length; j++) {
      const u = basis[j];
      const dot = dotProduct(v, u);
      for (let d = 0; d < dim; d++) {
        v[d] -= dot * u[d];
      }
    }

    // Normalize
    const mag = magnitude(v);
    if (mag > 1e-6) {
      for (let d = 0; d < dim; d++) v[d] /= mag;
      basis.push(v);
      basisCoefficients[i] = Math.abs(dotProduct(vectors[i], v));
    } else {
      basisCoefficients[i] = 0;
    }
  }

  return { basis, basisCoefficients };
}

/**
 * Compute orthogonal projection of a vector onto a subspace spanned by tags.
 * @param {Float32Array} vector - Query vector
 * @param {Float32Array[]} tagVectors - Tag vectors spanning the subspace
 * @param {number} dim - Dimension
 * @returns {{ projection: Float32Array, residual: Float32Array, orthogonalBasis: Float32Array[], basisCoefficients: Float32Array }}
 */
function orthogonalProjection(vector, tagVectors, dim) {
  const { basis, basisCoefficients } = orthogonalize(tagVectors, dim);

  // Compute total projection: P = Σ <vector, u_i> * u_i
  const projection = new Float32Array(dim);
  for (let i = 0; i < basis.length; i++) {
    const u = basis[i];
    const dot = dotProduct(vector, u);
    for (let d = 0; d < dim; d++) {
      projection[d] += dot * u[d];
    }
  }

  // Residual: R = vector - P
  const residual = new Float32Array(dim);
  for (let d = 0; d < dim; d++) {
    residual[d] = vector[d] - projection[d];
  }

  return { projection, residual, orthogonalBasis: basis, basisCoefficients };
}

module.exports = {
  dotProduct,
  magnitude,
  normalize,
  orthogonalize,
  orthogonalProjection
};
```

- [ ] **Step 4: 验证测试通过**

```bash
node --test vcp-memory/tests/algorithms/test-gram-schmidt.test.js
```

Expected: 6 tests pass.

- [ ] **Step 5: 提交**

```bash
git add vcp-memory/src/algorithms/gram-schmidt.js vcp-memory/tests/algorithms/test-gram-schmidt.test.js
git commit -m "feat(vcp-memory): extract Gram-Schmidt orthogonalization primitives"
```

---

### Task 6: 提取 SVD / 加权 PCA 算法

**Files:**
- Create: `vcp-memory/src/algorithms/svd.js` (from `EPAModule.js` `_computeWeightedPCA`, `_powerIteration`, `_clusterTags`, `_selectBasisDimension`)
- Test: `vcp-memory/tests/algorithms/test-svd.test.js`

- [ ] **Step 1: 写失败测试**

Create `vcp-memory/tests/algorithms/test-svd.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  clusterTags,
  computeWeightedPCA,
  powerIteration,
  selectBasisDimension
} = require('../../src/algorithms/svd');

test('clusterTags groups similar vectors into k clusters', () => {
  const dim = 4;
  const tags = [
    { id: 1, name: 'a', vector: new Float32Array([1, 0, 0, 0]) },
    { id: 2, name: 'b', vector: new Float32Array([0.9, 0.1, 0, 0]) },
    { id: 3, name: 'c', vector: new Float32Array([0, 1, 0, 0]) },
    { id: 4, name: 'd', vector: new Float32Array([0, 0.9, 0.1, 0]) },
    { id: 5, name: 'e', vector: new Float32Array([0, 0, 1, 0]) },
    { id: 6, name: 'f', vector: new Float32Array([0, 0, 0.9, 0.1]) },
    { id: 7, name: 'g', vector: new Float32Array([0.1, 0, 0, 0.9]) },
    { id: 8, name: 'h', vector: new Float32Array([0, 0.1, 0, 0.9]) }
  ];
  const result = clusterTags(tags, 4, dim);
  assert.strictEqual(result.vectors.length, 4);
  assert.strictEqual(result.labels.length, 4);
  assert.strictEqual(result.weights.length, 4);
  assert.ok(result.weights.every(w => w > 0), 'all clusters should have members');
});

test('computeWeightedPCA extracts principal components', () => {
  const dim = 4;
  // Create data with clear principal direction along [1,1,0,0]
  const vectors = [
    new Float32Array([1, 1, 0, 0]),
    new Float32Array([0.9, 0.9, 0.1, 0]),
    new Float32Array([1.1, 1.0, 0, 0.1]),
    new Float32Array([0, 0, 1, 1]),
    new Float32Array([0.1, 0, 0.9, 1.1])
  ];
  const weights = [1, 1, 1, 1, 1];
  const labels = ['a', 'b', 'c', 'd', 'e'];

  const result = computeWeightedPCA({ vectors, weights, labels }, dim, { maxBasisDim: 3 });
  assert.ok(result.U.length > 0, 'should produce at least one basis vector');
  assert.ok(result.S.length > 0, 'should produce at least one eigenvalue');
  assert.ok(result.meanVector, 'should produce mean vector');
  assert.strictEqual(result.U[0].length, dim, 'basis vector should have correct dimension');

  // First eigenvalue should be largest
  for (let i = 1; i < result.S.length; i++) {
    assert.ok(result.S[i] <= result.S[0], 'eigenvalues should be in descending order');
  }
});

test('selectBasisDimension selects components explaining 95% variance', () => {
  const S = [100, 5, 1, 0.1];
  const k = selectBasisDimension(S);
  assert.ok(k >= 1, 'should select at least 1 component');
  assert.ok(k <= 4, 'should not exceed available components');
});

test('selectBasisDimension returns at least 8 when possible', () => {
  const S = Array(20).fill(0).map((_, i) => 100 - i * 5);
  const k = selectBasisDimension(S);
  assert.ok(k >= 8, 'should return at least 8 components for well-distributed eigenvalues');
});
```

- [ ] **Step 2: 验证测试失败**

```bash
node --test vcp-memory/tests/algorithms/test-svd.test.js
```

Expected: FAIL with module not found.

- [ ] **Step 3: 实现 svd.js**

Create `vcp-memory/src/algorithms/svd.js`, extracting the pure math from `EPAModule.js` lines 450-694. Key changes: remove `this.db`, `this.config` references; accept dimension and config as function parameters.

```js
'use strict';

/**
 * Weighted PCA / SVD algorithms.
 * Extracted from EPAModule.js (_computeWeightedPCA, _clusterTags, _powerIteration, _selectBasisDimension).
 * Pure math, zero I/O dependencies.
 */

const { dotProduct, magnitude } = require('./gram-schmidt');

/**
 * Extract Float32Array from various vector formats (Buffer, Float32Array, etc.)
 * @param {Buffer|Float32Array|ArrayBufferView} vectorData
 * @param {number} dim
 * @returns {Float32Array}
 */
function extractFloat32(vectorData, dim) {
  if (vectorData instanceof Float32Array) return vectorData;
  const result = new Float32Array(dim);
  new Uint8Array(result.buffer).set(vectorData);
  return result;
}

/**
 * K-Means clustering of tag vectors.
 * @param {Array<{id:number, name:string, vector:Buffer|Float32Array}>} tags
 * @param {number} k - Number of clusters
 * @param {number} dim - Vector dimension
 * @returns {{ vectors: Float32Array[], labels: string[], weights: number[] }}
 */
function clusterTags(tags, k, dim) {
  const vectors = tags.map(t => extractFloat32(t.vector, dim));

  // Forgy initialization: random selection of k points
  let centroids = [];
  const indices = new Set();
  while (indices.size < k) indices.add(Math.floor(Math.random() * vectors.length));
  centroids = Array.from(indices).map(i => new Float32Array(vectors[i]));

  let clusterSizes = new Array(k).fill(0);
  const maxIter = 50;
  const tolerance = 1e-4;

  for (let iter = 0; iter < maxIter; iter++) {
    const clusters = Array.from({ length: k }, () => []);
    let movement = 0;

    // Assign
    vectors.forEach(v => {
      let maxSim = -Infinity, bestK = 0;
      centroids.forEach((c, i) => {
        let dot = 0;
        for (let d = 0; d < dim; d++) dot += v[d] * c[d];
        if (dot > maxSim) { maxSim = dot; bestK = i; }
      });
      clusters[bestK].push(v);
    });

    // Update
    const newCentroids = clusters.map((cvs, i) => {
      if (cvs.length === 0) return centroids[i];
      const newC = new Float32Array(dim);
      cvs.forEach(v => { for (let d = 0; d < dim; d++) newC[d] += v[d]; });
      let mag = 0;
      for (let d = 0; d < dim; d++) mag += newC[d] ** 2;
      mag = Math.sqrt(mag);
      if (mag > 1e-9) for (let d = 0; d < dim; d++) newC[d] /= mag;
      let distSq = 0;
      for (let d = 0; d < dim; d++) distSq += (newC[d] - centroids[i][d]) ** 2;
      movement += distSq;
      return newC;
    });

    clusterSizes = clusters.map(c => c.length);
    centroids = newCentroids;

    if (movement < tolerance) break;
  }

  // Label centroids by nearest original tag
  const labels = centroids.map(c => {
    let maxSim = -Infinity, closest = 'Unknown';
    vectors.forEach((v, i) => {
      let dot = 0;
      for (let d = 0; d < dim; d++) dot += c[d] * v[d];
      if (dot > maxSim) { maxSim = dot; closest = tags[i].name; }
    });
    return closest;
  });

  return { vectors: centroids, labels, weights: clusterSizes };
}

/**
 * Power iteration with re-orthogonalization to extract eigenvectors.
 * @param {Float32Array} matrix - Flattened n*n matrix
 * @param {number} n - Matrix dimension
 * @param {Float32Array[]} existingBasis - Already found eigenvectors (for deflation)
 * @param {boolean} strictOrthogonalization
 * @returns {{ vector: Float32Array, value: number }}
 */
function powerIteration(matrix, n, existingBasis, strictOrthogonalization = true) {
  let v = new Float32Array(n).map(() => Math.random() - 0.5);
  let lastVal = 0;

  for (let iter = 0; iter < 100; iter++) {
    const w = new Float32Array(n);

    // Matrix-Vector Multiplication
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) w[r] += matrix[r * n + c] * v[c];
    }

    // Re-orthogonalization against existing basis
    if (strictOrthogonalization && existingBasis && existingBasis.length > 0) {
      for (const prevV of existingBasis) {
        let dot = 0;
        for (let i = 0; i < n; i++) dot += w[i] * prevV[i];
        for (let i = 0; i < n; i++) w[i] -= dot * prevV[i];
      }
    }

    // Rayleigh Quotient
    let val = 0;
    for (let i = 0; i < n; i++) val += v[i] * w[i];

    // Normalize
    let mag = 0;
    for (let i = 0; i < n; i++) mag += w[i] ** 2;
    mag = Math.sqrt(mag);
    if (mag < 1e-9) break;

    for (let i = 0; i < n; i++) v[i] = w[i] / mag;

    if (Math.abs(val - lastVal) < 1e-6) { lastVal = val; break; }
    lastVal = val;
  }
  return { vector: v, value: lastVal };
}

/**
 * Weighted PCA via Gram matrix and power iteration.
 * @param {{ vectors: Float32Array[], weights: number[], labels: string[] }} clusterData
 * @param {number} dim - Vector dimension
 * @param {{ maxBasisDim?: number, strictOrthogonalization?: boolean }} options
 * @returns {{ U: Float32Array[], S: number[], meanVector: Float32Array, labels: string[] }}
 */
function computeWeightedPCA(clusterData, dim, options = {}) {
  const { vectors, weights } = clusterData;
  const n = vectors.length;
  const maxBasisDim = options.maxBasisDim || 64;
  const strictOrthogonalization = options.strictOrthogonalization !== undefined ? options.strictOrthogonalization : true;
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  // 1. Weighted mean
  const meanVector = new Float32Array(dim);
  for (let i = 0; i < n; i++) {
    const w = weights[i];
    for (let d = 0; d < dim; d++) meanVector[d] += vectors[i][d] * w;
  }
  for (let d = 0; d < dim; d++) meanVector[d] /= totalWeight;

  // 2. Center and scale: sqrt(w_i) * (v_i - mean)
  const centeredScaledVectors = vectors.map((v, i) => {
    const vec = new Float32Array(dim);
    const scale = Math.sqrt(weights[i]);
    for (let d = 0; d < dim; d++) vec[d] = (v[d] - meanVector[d]) * scale;
    return vec;
  });

  // 3. Gram matrix (n x n)
  const gram = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let dot = 0;
      for (let d = 0; d < dim; d++) dot += centeredScaledVectors[i][d] * centeredScaledVectors[j][d];
      gram[i * n + j] = gram[j * n + i] = dot;
    }
  }

  // 4. Power iteration with deflation
  const eigenvectors = [];
  const eigenvalues = [];
  const gramCopy = new Float32Array(gram);
  const maxBasis = Math.min(n, maxBasisDim);

  for (let k = 0; k < maxBasis; k++) {
    const { vector: v, value } = powerIteration(gramCopy, n, eigenvectors, strictOrthogonalization);
    if (value < 1e-6) break;

    eigenvectors.push(v);
    eigenvalues.push(value);

    // Deflation
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        gramCopy[i * n + j] -= value * v[i] * v[j];
      }
    }
  }

  // 5. Map back to original dimension: U_pca = X^T * v / sqrt(lambda)
  const U = eigenvectors.map((ev, idx) => {
    const lambda = eigenvalues[idx];
    const basis = new Float32Array(dim);
    for (let i = 0; i < n; i++) {
      const weight = ev[i];
      if (Math.abs(weight) > 1e-9) {
        for (let d = 0; d < dim; d++) basis[d] += weight * centeredScaledVectors[i][d];
      }
    }
    let mag = 0;
    for (let d = 0; d < dim; d++) mag += basis[d] ** 2;
    mag = Math.sqrt(mag);
    if (mag > 1e-9) for (let d = 0; d < dim; d++) basis[d] /= mag;
    return basis;
  });

  return { U, S: eigenvalues, meanVector, labels: clusterData.labels };
}

/**
 * Select number of basis dimensions explaining 95% variance.
 * @param {number[]} S - Eigenvalues in descending order
 * @returns {number}
 */
function selectBasisDimension(S) {
  const total = S.reduce((a, b) => a + b, 0);
  let cum = 0;
  for (let i = 0; i < S.length; i++) {
    cum += S[i];
    if (cum / total > 0.95) return Math.max(i + 1, 8);
  }
  return S.length;
}

module.exports = {
  extractFloat32,
  clusterTags,
  computeWeightedPCA,
  powerIteration,
  selectBasisDimension
};
```

- [ ] **Step 4: 验证测试通过**

```bash
node --test vcp-memory/tests/algorithms/test-svd.test.js
```

Expected: 4 tests pass.

- [ ] **Step 5: 提交**

```bash
git add vcp-memory/src/algorithms/svd.js vcp-memory/tests/algorithms/test-svd.test.js
git commit -m "feat(vcp-memory): extract weighted PCA / SVD algorithm"
```

---

### Task 7: 提取 EPA 纯算法模块

**Files:**
- Create: `vcp-memory/src/algorithms/epa.js` (from `EPAModule.js`, removing db/vexusIndex I/O)
- Test: `vcp-memory/tests/algorithms/test-epa.test.js`

**Key changes from EPAModule.js:**
- Remove constructor `(db, config)` -> accept `(basis, config)` where basis = `{ orthoBasis, basisMean, basisLabels, basisEnergies }`
- Remove `initialize()`, `_loadFromCache()`, `_saveToCache()`, `refreshInBackground()`, `_recomputeWithRust()`, `_loadBoundedTagSnapshot()`, `_computeBasisFromSnapshot()`, `_publishBasisCacheWithLease()` (all I/O, move to provider layer)
- Keep `project()`, `detectCrossDomainResonance()` as pure functions using pre-loaded basis
- Keep optional Rust acceleration via `config.vexusIndex` (if provided, use it; else JS fallback)
- Add `computeBasis(tags, dim, config)` static method wrapping `clusterTags` + `computeWeightedPCA` + `selectBasisDimension`

- [ ] **Step 1: 写失败测试**

Create `vcp-memory/tests/algorithms/test-epa.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { EPA } = require('../../src/algorithms/epa');

test('EPA.project returns empty result when not initialized', () => {
  const epa = new EPA({});
  const result = epa.project(new Float32Array([1, 0, 0]));
  assert.strictEqual(result.logicDepth, 0);
  assert.strictEqual(result.dominantAxes.length, 0);
});

test('EPA.project computes logic depth from orthogonal basis', () => {
  const dim = 4;
  // Simple basis: two orthogonal vectors
  const orthoBasis = [
    new Float32Array([1, 0, 0, 0]),
    new Float32Array([0, 1, 0, 0])
  ];
  const basisMean = new Float32Array([0, 0, 0, 0]);
  const basisLabels = ['axis-x', 'axis-y'];
  const basisEnergies = [1.0, 0.5];

  const epa = new EPA({ orthoBasis, basisMean, basisLabels, basisEnergies, dimension: dim });

  // Vector aligned with first axis -> low entropy -> high logic depth
  const focused = new Float32Array([1, 0, 0, 0]);
  const focusedResult = epa.project(focused);
  assert.ok(focusedResult.logicDepth > 0.5, 'focused vector should have high logic depth');

  // Vector spread across both axes -> high entropy -> low logic depth
  const spread = new Float32Array([1, 1, 0, 0]);
  const spreadResult = epa.project(spread);
  assert.ok(spreadResult.logicDepth < focusedResult.logicDepth, 'spread vector should have lower logic depth');
});

test('EPA.detectCrossDomainResonance detects multi-axis activation', () => {
  const dim = 4;
  const orthoBasis = [
    new Float32Array([1, 0, 0, 0]),
    new Float32Array([0, 1, 0, 0])
  ];
  const basisMean = new Float32Array([0, 0, 0, 0]);
  const basisLabels = ['domain-a', 'domain-b'];
  const basisEnergies = [1.0, 1.0];

  const epa = new EPA({ orthoBasis, basisMean, basisLabels, basisEnergies, dimension: dim });

  // Vector strongly activating both axes
  const crossDomain = new Float32Array([1, 1, 0, 0]);
  const result = epa.detectCrossDomainResonance(crossDomain);
  assert.ok(result.resonance > 0, 'should detect resonance');
  assert.ok(result.bridges.length > 0, 'should have bridges');
});

test('EPA.detectCrossDomainResonance returns zero for single-axis activation', () => {
  const dim = 4;
  const orthoBasis = [
    new Float32Array([1, 0, 0, 0]),
    new Float32Array([0, 1, 0, 0])
  ];
  const basisMean = new Float32Array([0, 0, 0, 0]);
  const basisLabels = ['domain-a', 'domain-b'];
  const basisEnergies = [1.0, 0.01];

  const epa = new EPA({ orthoBasis, basisMean, basisLabels, basisEnergies, dimension: dim });

  // Vector only activating first axis
  const singleDomain = new Float32Array([1, 0, 0, 0]);
  const result = epa.detectCrossDomainResonance(singleDomain);
  assert.strictEqual(result.resonance, 0);
  assert.strictEqual(result.bridges.length, 0);
});

test('EPA.computeBasis builds basis from tag vectors', () => {
  const dim = 4;
  const tags = [];
  // Generate 10 synthetic tags in 2 clusters
  for (let i = 0; i < 5; i++) {
    tags.push({
      id: i + 1,
      name: `cluster-a-${i}`,
      vector: new Float32Array([1 + Math.random() * 0.1, 0, 0, 0])
    });
  }
  for (let i = 0; i < 5; i++) {
    tags.push({
      id: i + 6,
      name: `cluster-b-${i}`,
      vector: new Float32Array([0, 0, 1 + Math.random() * 0.1, 0])
    });
  }

  const basis = EPA.computeBasis(tags, dim, { clusterCount: 4, maxBasisDim: 4 });
  assert.ok(basis.orthoBasis, 'should produce orthoBasis');
  assert.ok(basis.orthoBasis.length > 0, 'should have at least 1 basis vector');
  assert.ok(basis.basisMean, 'should produce basisMean');
  assert.strictEqual(basis.orthoBasis[0].length, dim);
});
```

- [ ] **Step 2: 验证测试失败**

```bash
node --test vcp-memory/tests/algorithms/test-epa.test.js
```

Expected: FAIL with module not found.

- [ ] **Step 3: 实现 epa.js**

Create `vcp-memory/src/algorithms/epa.js`:

```js
'use strict';

/**
 * EPA (Embedding Projection Analysis) - Pure algorithm.
 * Extracted from EPAModule.js, removing all db/vexusIndex I/O.
 * Basis data is provided at construction time or via setBasis().
 * Optional Rust acceleration via config.vexusIndex.
 */

const { clusterTags, computeWeightedPCA, selectBasisDimension } = require('./svd');
const { dotProduct } = require('./gram-schmidt');

class EPA {
  /**
   * @param {object} basis - Pre-loaded basis data
   * @param {Float32Array[]} [basis.orthoBasis] - Orthogonal basis vectors
   * @param {Float32Array} [basis.basisMean] - Mean vector for centering
   * @param {string[]} [basis.basisLabels] - Labels for each basis vector
   * @param {Float32Array|number[]} [basis.basisEnergies] - Eigenvalues
   * @param {object} [config] - Configuration
   * @param {number} [config.dimension=3072] - Vector dimension
   * @param {object} [config.vexusIndex] - Optional Rust N-API handle for acceleration
   * @param {boolean} [config.strictOrthogonalization=true]
   */
  constructor(basis = {}, config = {}) {
    this.config = {
      dimension: config.dimension || 3072,
      strictOrthogonalization: config.strictOrthogonalization !== undefined ? config.strictOrthogonalization : true,
      vexusIndex: config.vexusIndex || null,
      ...config
    };

    this.orthoBasis = basis.orthoBasis || null;
    this.basisMean = basis.basisMean || null;
    this.basisLabels = basis.basisLabels || null;
    this.basisEnergies = basis.basisEnergies || null;
    this._flattenedBasisCache = null;

    this.initialized = !!(this.orthoBasis && this.basisMean);
    if (this.initialized) this._refreshFlattenedBasisCache();
  }

  /**
   * Set or update basis data.
   * @param {object} basis
   */
  setBasis(basis) {
    this.orthoBasis = basis.orthoBasis;
    this.basisMean = basis.basisMean;
    this.basisLabels = basis.basisLabels;
    this.basisEnergies = basis.basisEnergies;
    this._flattenedBasisCache = null;
    this.initialized = !!(this.orthoBasis && this.basisMean);
    if (this.initialized) this._refreshFlattenedBasisCache();
  }

  /**
   * Project a vector onto the semantic space.
   * Returns logic depth (focus), dominant axes, and entropy.
   * @param {Float32Array} vector
   * @returns {{ projections: Float32Array|null, probabilities: Float32Array|null, entropy: number, logicDepth: number, dominantAxes: Array }}
   */
  project(vector) {
    if (!this.initialized || !this.orthoBasis) return this._emptyResult();

    const vec = vector instanceof Float32Array ? vector : new Float32Array(vector);
    const dim = vec.length;
    const K = this.orthoBasis.length;

    let projections, probabilities, entropy, totalEnergy;

    // Optional Rust acceleration
    if (this.config.vexusIndex && typeof this.config.vexusIndex.project === 'function') {
      try {
        const flattenedBasis = this._getFlattenedBasis();
        const result = this.config.vexusIndex.project(vec, flattenedBasis, this.basisMean, K);
        projections = new Float32Array(result.projections.map(x => x));
        probabilities = new Float32Array(result.probabilities.map(x => x));
        entropy = result.entropy;
        totalEnergy = result.totalEnergy;
      } catch (e) {
        // Fall through to JS
      }
    }

    if (!projections) {
      // JS fallback
      const centeredVec = new Float32Array(dim);
      for (let i = 0; i < dim; i++) centeredVec[i] = vec[i] - this.basisMean[i];

      projections = new Float32Array(K);
      totalEnergy = 0;

      for (let k = 0; k < K; k++) {
        let dot = 0;
        const basis = this.orthoBasis[k];
        for (let d = 0; d < dim; d++) dot += centeredVec[d] * basis[d];
        projections[k] = dot;
        totalEnergy += dot * dot;
      }

      if (totalEnergy < 1e-12) return this._emptyResult();

      probabilities = new Float32Array(K);
      entropy = 0;
      for (let k = 0; k < K; k++) {
        probabilities[k] = (projections[k] * projections[k]) / totalEnergy;
        if (probabilities[k] > 1e-9) {
          entropy -= probabilities[k] * Math.log2(probabilities[k]);
        }
      }
    }

    const normalizedEntropy = K > 1 ? entropy / Math.log2(K) : 0;

    const dominantAxes = [];
    for (let k = 0; k < K; k++) {
      if (probabilities[k] > 0.05) {
        dominantAxes.push({
          index: k,
          label: this.basisLabels[k],
          energy: probabilities[k],
          projection: projections[k]
        });
      }
    }
    dominantAxes.sort((a, b) => b.energy - a.energy);

    return {
      projections,
      probabilities,
      entropy: normalizedEntropy,
      logicDepth: 1 - normalizedEntropy,
      dominantAxes
    };
  }

  /**
   * Detect cross-domain resonance (multi-axis co-activation).
   * @param {Float32Array} vector
   * @returns {{ resonance: number, bridges: Array }}
   */
  detectCrossDomainResonance(vector) {
    const { dominantAxes } = this.project(vector);
    if (dominantAxes.length < 2) return { resonance: 0, bridges: [] };

    const bridges = [];
    const topAxis = dominantAxes[0];

    for (let i = 1; i < dominantAxes.length; i++) {
      const secondaryAxis = dominantAxes[i];
      const coActivation = Math.sqrt(topAxis.energy * secondaryAxis.energy);

      if (coActivation > 0.15) {
        bridges.push({
          from: topAxis.label,
          to: secondaryAxis.label,
          strength: coActivation,
          balance: Math.min(topAxis.energy, secondaryAxis.energy) / Math.max(topAxis.energy, secondaryAxis.energy)
        });
      }
    }

    const resonance = bridges.reduce((sum, b) => sum + b.strength, 0);
    return { resonance, bridges };
  }

  /**
   * Compute EPA basis from tag vectors (pure, no I/O).
   * @param {Array<{id:number, name:string, vector:Buffer|Float32Array}>} tags
   * @param {number} dim - Vector dimension
   * @param {{ clusterCount?:number, maxBasisDim?:number, strictOrthogonalization?:boolean }} options
   * @returns {{ orthoBasis: Float32Array[], basisMean: Float32Array, basisLabels: string[], basisEnergies: number[] }}
   */
  static computeBasis(tags, dim, options = {}) {
    const clusterCount = options.clusterCount || 64;
    const maxBasisDim = options.maxBasisDim || 64;

    const clusterData = clusterTags(tags, Math.min(tags.length, clusterCount), dim);
    const svdResult = computeWeightedPCA(clusterData, dim, {
      maxBasisDim,
      strictOrthogonalization: options.strictOrthogonalization
    });

    const { U, S, meanVector, labels } = svdResult;
    const K = selectBasisDimension(S);

    return {
      orthoBasis: U.slice(0, K),
      basisMean: meanVector,
      basisLabels: labels ? labels.slice(0, K) : clusterData.labels.slice(0, K),
      basisEnergies: S.slice(0, K)
    };
  }

  _refreshFlattenedBasisCache() {
    if (!this.orthoBasis || this.orthoBasis.length === 0) {
      this._flattenedBasisCache = null;
      return null;
    }
    const K = this.orthoBasis.length;
    const dim = this.orthoBasis[0].length;
    const flattened = new Float32Array(K * dim);
    for (let k = 0; k < K; k++) {
      flattened.set(this.orthoBasis[k], k * dim);
    }
    this._flattenedBasisCache = flattened;
    return flattened;
  }

  _getFlattenedBasis() {
    return this._flattenedBasisCache || this._refreshFlattenedBasisCache();
  }

  _emptyResult() {
    return { projections: null, probabilities: null, entropy: 1, logicDepth: 0, dominantAxes: [] };
  }
}

module.exports = { EPA };
```

- [ ] **Step 4: 验证测试通过**

```bash
node --test vcp-memory/tests/algorithms/test-epa.test.js
```

Expected: 5 tests pass.

- [ ] **Step 5: 提交**

```bash
git add vcp-memory/src/algorithms/epa.js vcp-memory/tests/algorithms/test-epa.test.js
git commit -m "feat(vcp-memory): extract EPA pure algorithm module"
```

---

### Task 8: 提取残差金字塔纯算法模块

**Files:**
- Create: `vcp-memory/src/algorithms/residual-pyramid.js` (from `ResidualPyramid.js`, removing tagIndex/db I/O)
- Test: `vcp-memory/tests/algorithms/test-residual-pyramid.test.js`

**Key changes from ResidualPyramid.js:**
- Remove constructor `(tagIndex, db, config)` -> accept `(config)` only
- `analyze()` now accepts `tagSearchFn` and `tagLookupFn` as parameters (dependency injection)
- Or: `analyze()` accepts pre-searched tag results for each level
- Keep all pure math methods (`_computeOrthogonalProjection`, `_computeHandshakes`, `_analyzeHandshakes`, `_extractPyramidFeatures`)
- Keep optional Rust acceleration via `config.vexusIndex`

- [ ] **Step 1: 写失败测试**

Create `vcp-memory/tests/algorithms/test-residual-pyramid.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { ResidualPyramid } = require('../../src/algorithms/residual-pyramid');

test('ResidualPyramid.analyze returns empty result for zero-energy vector', () => {
  const rp = new ResidualPyramid({ dimension: 4 });
  const zeroVec = new Float32Array([0, 0, 0, 0]);
  const result = rp.analyze(zeroVec, { searchFn: async () => [], lookupFn: async () => [] });
  assert.strictEqual(result.levels.length, 0);
  assert.strictEqual(result.features.depth, 0);
});

test('ResidualPyramid.analyze decomposes vector into pyramid levels', async () => {
  const dim = 4;
  const tagDb = [
    { id: 1, name: 'tag-a', vector: new Float32Array([1, 0, 0, 0]) },
    { id: 2, name: 'tag-b', vector: new Float32Array([0, 1, 0, 0]) },
    { id: 3, name: 'tag-c', vector: new Float32Array([0, 0, 1, 0]) }
  ];

  // Mock search: return closest tags by dot product
  const searchFn = async (queryVec, topK) => {
    const scored = tagDb.map(t => ({
      id: t.id,
      score: tagDb[0].vector.reduce((sum, v, i) => sum + v * queryVec[i], 0)
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  };

  // Mock lookup: return tag vectors by IDs
  const lookupFn = async (ids) => {
    return tagDb.filter(t => ids.includes(t.id));
  };

  const rp = new ResidualPyramid({ dimension: dim, maxLevels: 2, topK: 3 });
  const queryVec = new Float32Array([1, 0.5, 0, 0]);
  const result = await rp.analyze(queryVec, { searchFn, lookupFn });

  assert.ok(result.levels.length > 0, 'should have at least 1 level');
  assert.ok(result.totalExplainedEnergy > 0, 'should explain some energy');
  assert.ok(result.features.coverage >= 0 && result.features.coverage <= 1);
  assert.ok(result.features.novelty >= 0 && result.features.novelty <= 1);
  assert.ok(result.finalResidual, 'should have final residual');
});

test('ResidualPyramid.extractFeatures computes coverage and novelty', () => {
  const rp = new ResidualPyramid({ dimension: 4 });
  const pyramid = {
    levels: [{
      level: 0,
      tags: [],
      handshakeFeatures: {
        directionCoherence: 0.5,
        patternStrength: 0.7,
        noveltySignal: 0.5,
        noiseSignal: 0.15
      }
    }],
    totalExplainedEnergy: 0.8,
    finalResidual: new Float32Array([0.1, 0, 0, 0])
  };

  const features = rp.extractFeatures(pyramid);
  assert.ok(features.coverage > 0.7 && features.coverage <= 1.0);
  assert.ok(features.novelty >= 0 && features.novelty <= 1);
  assert.ok(features.coherence === 0.7);
  assert.ok(features.tagMemoActivation >= 0 && features.tagMemoActivation <= 1);
});

test('ResidualPyramid.extractFeatures handles empty pyramid', () => {
  const rp = new ResidualPyramid({ dimension: 4 });
  const features = rp.extractFeatures({ levels: [], totalExplainedEnergy: 0 });
  assert.strictEqual(features.depth, 0);
  assert.strictEqual(features.coverage, 0);
  assert.strictEqual(features.novelty, 1);
});
```

- [ ] **Step 2: 验证测试失败**

```bash
node --test vcp-memory/tests/algorithms/test-residual-pyramid.test.js
```

Expected: FAIL with module not found.

- [ ] **Step 3: 实现 residual-pyramid.js**

Create `vcp-memory/src/algorithms/residual-pyramid.js`:

```js
'use strict';

/**
 * Residual Pyramid - Pure algorithm.
 * Extracted from ResidualPyramid.js, removing tagIndex/db I/O.
 * Tag search and lookup are injected as functions.
 * Optional Rust acceleration via config.vexusIndex.
 */

const { orthogonalProjection, dotProduct, magnitude } = require('./gram-schmidt');

class ResidualPyramid {
  /**
   * @param {object} config
   * @param {number} [config.maxLevels=3] - Maximum pyramid levels
   * @param {number} [config.topK=10] - Tags to search per level
   * @param {number} [config.minEnergyRatio=0.1] - Stop when residual energy < 10%
   * @param {number} [config.dimension=3072] - Vector dimension
   * @param {object} [config.vexusIndex] - Optional Rust N-API handle
   */
  constructor(config = {}) {
    this.config = {
      maxLevels: config.maxLevels || 3,
      topK: config.topK || 10,
      minEnergyRatio: config.minEnergyRatio || 0.1,
      dimension: config.dimension || 3072,
      vexusIndex: config.vexusIndex || null,
      ...config
    };
  }

  /**
   * Analyze a query vector through the residual pyramid.
   * @param {Float32Array} queryVector
   * @param {object} fns - Injected I/O functions
   * @param {(queryVec: Float32Array, topK: number) => Promise<Array<{id:number, score:number}>>} fns.searchFn
   * @param {(ids: number[]) => Promise<Array<{id:number, name:string, vector:Float32Array|Buffer}>>} fns.lookupFn
   * @returns {Promise<object>} Pyramid analysis result
   */
  async analyze(queryVector, { searchFn, lookupFn }) {
    const dim = this.config.dimension;
    const pyramid = {
      levels: [],
      totalExplainedEnergy: 0,
      finalResidual: null,
      features: {}
    };

    let currentVector = queryVector instanceof Float32Array ? queryVector : new Float32Array(queryVector);
    const originalMagnitude = magnitude(currentVector);
    const originalEnergy = originalMagnitude * originalMagnitude;

    if (originalEnergy < 1e-12) {
      return this._emptyResult(dim);
    }

    let currentResidual = new Float32Array(currentVector);

    for (let level = 0; level < this.config.maxLevels; level++) {
      // 1. Search nearest tags for current residual
      let tagResults;
      try {
        tagResults = await searchFn(currentResidual, this.config.topK);
      } catch (e) {
        break;
      }
      if (!tagResults || tagResults.length === 0) break;

      // 2. Look up tag vectors
      const tagIds = tagResults.map(r => Number(r.id));
      const rawTags = await lookupFn(tagIds);
      if (!rawTags || rawTags.length === 0) break;

      // 3. Orthogonal projection
      const tagVectors = rawTags.map(t => this._extractFloat32(t.vector));
      const { projection, residual, basisCoefficients } = this._computeOrthogonalProjection(
        currentResidual, tagVectors
      );

      // 4. Energy calculations
      const residualEnergy = magnitude(residual) ** 2;
      const currentEnergy = magnitude(currentResidual) ** 2;
      const energyExplainedByLevel = Math.max(0, currentEnergy - residualEnergy) / originalEnergy;

      // 5. Handshake analysis
      const handshakes = this._computeHandshakes(currentResidual, tagVectors);

      pyramid.levels.push({
        level,
        tags: rawTags.map((t, i) => {
          const res = tagResults.find(r => Number(r.id) === t.id);
          return {
            id: t.id,
            name: t.name,
            similarity: res ? res.score : 0,
            contribution: basisCoefficients[i] || 0,
            handshakeMagnitude: handshakes.magnitudes[i]
          };
        }),
        projectionMagnitude: magnitude(projection),
        residualMagnitude: magnitude(residual),
        residualEnergyRatio: residualEnergy / originalEnergy,
        energyExplained: energyExplainedByLevel,
        handshakeFeatures: this._analyzeHandshakes(handshakes, dim)
      });

      pyramid.totalExplainedEnergy += energyExplainedByLevel;
      currentResidual = residual;

      if ((residualEnergy / originalEnergy) < this.config.minEnergyRatio) break;
    }

    pyramid.finalResidual = currentResidual;
    pyramid.features = this.extractFeatures(pyramid);
    return pyramid;
  }

  /**
   * Compute orthogonal projection using Gram-Schmidt.
   * Uses Rust acceleration if available, else JS fallback.
   */
  _computeOrthogonalProjection(vector, tagVectors) {
    const dim = this.config.dimension;
    const n = tagVectors.length;

    // Rust acceleration
    if (this.config.vexusIndex && typeof this.config.vexusIndex.computeOrthogonalProjection === 'function') {
      try {
        const flattenedTags = new Float32Array(n * dim);
        for (let i = 0; i < n; i++) {
          flattenedTags.set(this._extractFloat32(tagVectors[i]), i * dim);
        }
        const result = this.config.vexusIndex.computeOrthogonalProjection(vector, flattenedTags, n);
        return {
          projection: new Float32Array(result.projection.map(x => x)),
          residual: new Float32Array(result.residual.map(x => x)),
          basisCoefficients: new Float32Array(result.basisCoefficients.map(x => x))
        };
      } catch (e) {
        // Fall through to JS
      }
    }

    // JS fallback - use extracted gram-schmidt module
    return orthogonalProjection(vector, tagVectors, dim);
  }

  _computeHandshakes(query, tagVectors) {
    const dim = this.config.dimension;
    const n = tagVectors.length;

    // Rust acceleration
    if (this.config.vexusIndex && typeof this.config.vexusIndex.computeHandshakes === 'function') {
      try {
        const flattenedTags = new Float32Array(n * dim);
        for (let i = 0; i < n; i++) {
          flattenedTags.set(this._extractFloat32(tagVectors[i]), i * dim);
        }
        const result = this.config.vexusIndex.computeHandshakes(query, flattenedTags, n);
        const directions = [];
        for (let i = 0; i < n; i++) {
          directions.push(new Float32Array(result.directions.slice(i * dim, (i + 1) * dim).map(x => x)));
        }
        return { magnitudes: result.magnitudes.map(x => x), directions };
      } catch (e) {
        // Fall through to JS
      }
    }

    // JS fallback
    const magnitudes = [];
    const directions = [];
    for (let i = 0; i < n; i++) {
      const tagVec = this._extractFloat32(tagVectors[i]);
      const delta = new Float32Array(dim);
      let magSq = 0;
      for (let d = 0; d < dim; d++) {
        delta[d] = query[d] - tagVec[d];
        magSq += delta[d] * delta[d];
      }
      const mag = Math.sqrt(magSq);
      magnitudes.push(mag);
      const dir = new Float32Array(dim);
      if (mag > 1e-9) {
        for (let d = 0; d < dim; d++) dir[d] = delta[d] / mag;
      }
      directions.push(dir);
    }
    return { magnitudes, directions };
  }

  _analyzeHandshakes(handshakes, dim) {
    const n = handshakes.magnitudes.length;
    if (n === 0) return null;

    const avgDirection = new Float32Array(dim);
    for (let i = 0; i < n; i++) {
      for (let d = 0; d < dim; d++) avgDirection[d] += handshakes.directions[i][d];
    }
    for (let d = 0; d < dim; d++) avgDirection[d] /= n;

    const directionCoherence = magnitude(avgDirection);

    let pairwiseSimSum = 0;
    let pairCount = 0;
    const limit = Math.min(n, 5);
    for (let i = 0; i < limit; i++) {
      for (let j = i + 1; j < limit; j++) {
        pairwiseSimSum += Math.abs(dotProduct(handshakes.directions[i], handshakes.directions[j]));
        pairCount++;
      }
    }
    const avgPairwiseSim = pairCount > 0 ? pairwiseSimSum / pairCount : 0;

    return {
      directionCoherence,
      patternStrength: avgPairwiseSim,
      noveltySignal: directionCoherence,
      noiseSignal: (1 - directionCoherence) * (1 - avgPairwiseSim)
    };
  }

  extractFeatures(pyramid) {
    if (pyramid.levels.length === 0) {
      return { depth: 0, coverage: 0, novelty: 1, coherence: 0, tagMemoActivation: 0, expansionSignal: 1 };
    }

    const level0 = pyramid.levels[0];
    const handshake = level0.handshakeFeatures;

    const coverage = Math.min(1.0, pyramid.totalExplainedEnergy);
    const coherence = handshake ? handshake.patternStrength : 0;

    const residualRatio = 1 - coverage;
    const directionalNovelty = handshake ? handshake.noveltySignal : 0;
    const novelty = (residualRatio * 0.7) + (directionalNovelty * 0.3);

    return {
      depth: pyramid.levels.length,
      coverage,
      novelty,
      coherence,
      tagMemoActivation: coverage * coherence * (1 - (handshake?.noiseSignal || 0)),
      expansionSignal: novelty
    };
  }

  _extractFloat32(vectorData) {
    if (vectorData instanceof Float32Array) return vectorData;
    const result = new Float32Array(this.config.dimension);
    new Uint8Array(result.buffer).set(vectorData);
    return result;
  }

  _emptyResult(dim) {
    return {
      levels: [],
      totalExplainedEnergy: 0,
      finalResidual: new Float32Array(dim),
      features: { depth: 0, coverage: 0, novelty: 1, coherence: 0, tagMemoActivation: 0, expansionSignal: 1 }
    };
  }
}

module.exports = { ResidualPyramid };
```

- [ ] **Step 4: 验证测试通过**

```bash
node --test vcp-memory/tests/algorithms/test-residual-pyramid.test.js
```

Expected: 4 tests pass.

- [ ] **Step 5: 提交**

```bash
git add vcp-memory/src/algorithms/residual-pyramid.js vcp-memory/tests/algorithms/test-residual-pyramid.test.js
git commit -m "feat(vcp-memory): extract residual pyramid pure algorithm"
```

---

### Task 9: 更新 index.js 导出算法层

**Files:**
- Modify: `vcp-memory/index.js`

- [ ] **Step 1: 更新 index.js**

```js
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
```

- [ ] **Step 2: 运行全部测试**

```bash
node --test vcp-memory/tests/
```

Expected: All tests pass.

- [ ] **Step 3: 提交**

```bash
git add vcp-memory/index.js
git commit -m "feat(vcp-memory): export algorithms and utilities from index.js"
```

---

### Task 10: 提取 text-chunker 工具（参数化配置）

**Files:**
- Create: `vcp-memory/src/utils/text-chunker.js` (from `TextChunker.js`, removing process.env)
- Test: `vcp-memory/tests/utils/test-text-chunker.test.js`

**Key changes from TextChunker.js:**
- Remove `require('dotenv').config()` and `process.env` reads
- Accept config as constructor/factory parameter
- Lazy-init tiktoken encoding (avoid top-level side effects)

- [ ] **Step 1: 写失败测试**

Create `vcp-memory/tests/utils/test-text-chunker.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { chunkText } = require('../../src/utils/text-chunker');

test('chunkText returns empty array for empty input', () => {
  assert.deepStrictEqual(chunkText(''), []);
  assert.deepStrictEqual(chunkText(null), []);
  assert.deepStrictEqual(chunkText(undefined), []);
});

test('chunkText returns short text as single chunk', () => {
  const result = chunkText('Hello world.', { maxTokens: 100, overlapTokens: 10 });
  assert.strictEqual(result.length, 1);
  assert.ok(result[0].includes('Hello'));
});

test('chunkText splits long text into multiple chunks', () => {
  const longText = 'This is a sentence. '.repeat(200);
  const result = chunkText(longText, { maxTokens: 50, overlapTokens: 5 });
  assert.ok(result.length > 1, 'should produce multiple chunks');
  for (const chunk of result) {
    assert.ok(chunk.length > 0, 'each chunk should be non-empty');
  }
});

test('chunkText respects maxTokens parameter', () => {
  const text = 'One. Two. Three. Four. Five. Six. Seven. Eight. Nine. Ten.';
  const result = chunkText(text, { maxTokens: 5, overlapTokens: 1 });
  assert.ok(result.length > 1, 'should split into multiple chunks for small maxTokens');
});

test('chunkText handles Chinese text', () => {
  const text = '这是第一句话。这是第二句话。这是第三句话。';
  const result = chunkText(text, { maxTokens: 100, overlapTokens: 10 });
  assert.ok(result.length >= 1);
  assert.ok(result[0].includes('第一句话'));
});
```

- [ ] **Step 2: 验证测试失败**

```bash
node --test vcp-memory/tests/utils/test-text-chunker.test.js
```

Expected: FAIL with module not found.

- [ ] **Step 3: 实现 text-chunker.js**

Create `vcp-memory/src/utils/text-chunker.js`:

```js
'use strict';

let _encoding = null;

function getEncoding() {
  if (!_encoding) {
    const { get_encoding } = require('@dqbd/tiktoken');
    _encoding = get_encoding('cl100k_base');
  }
  return _encoding;
}

/**
 * Smart text chunker. Splits text into chunks by sentences,
 * respecting max token limits with overlap.
 * @param {string} text - Text to chunk
 * @param {{ maxTokens?: number, overlapTokens?: number }} [options]
 * @returns {string[]}
 */
function chunkText(text, options = {}) {
  if (!text) return [];

  const maxTokens = options.maxTokens || 6800; // 8000 * 0.85
  const overlapTokens = options.overlapTokens || Math.floor(maxTokens * 0.1);
  const encoding = getEncoding();

  const sentences = text.split(/(?<=[。？！.!?\n])/g);
  const chunks = [];
  let currentChunk = '';
  let currentTokens = 0;

  for (let i = 0; i < sentences.length; i++) {
    let sentence = sentences[i];
    let sentenceTokens = encoding.encode(sentence).length;

    if (sentenceTokens > maxTokens) {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
        currentTokens = 0;
      }
      const forceSplitChunks = forceSplitLongText(sentence, maxTokens, overlapTokens, encoding);
      chunks.push(...forceSplitChunks);
      continue;
    }

    if (currentTokens + sentenceTokens > maxTokens) {
      chunks.push(currentChunk.trim());

      let overlapChunk = '';
      let overlapTokenCount = 0;
      for (let j = i - 1; j >= 0; j--) {
        const prevSentence = sentences[j];
        const prevSentenceTokens = encoding.encode(prevSentence).length;
        if (overlapTokenCount + prevSentenceTokens > overlapTokens) break;
        overlapChunk = prevSentence + overlapChunk;
        overlapTokenCount += prevSentenceTokens;
      }
      currentChunk = overlapChunk;
      currentTokens = overlapTokenCount;
    }

    currentChunk += sentence;
    currentTokens += sentenceTokens;
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

function forceSplitLongText(text, maxTokens, overlapTokens, encoding) {
  const chunks = [];
  const tokens = encoding.encode(text);
  const safeOverlap = Math.min(overlapTokens, Math.max(0, maxTokens - 1));
  const decoder = new TextDecoder('utf-8');

  let start = 0;
  while (start < tokens.length) {
    let end = Math.min(start + maxTokens, tokens.length);

    if (end < tokens.length) {
      const chunkTokens = tokens.slice(start, end);
      let chunkTextStr = decoder.decode(chunkTokens);

      const breakPoints = ['\n', '。', '！', '？', '，', '；', '：', ' ', '\t'];
      let bestBreakPoint = -1;

      for (let i = chunkTextStr.length - 1; i >= Math.max(0, chunkTextStr.length - 200); i--) {
        if (breakPoints.includes(chunkTextStr[i])) {
          bestBreakPoint = i + 1;
          break;
        }
      }

      let finalChunkText = chunkTextStr;
      if (bestBreakPoint > 0) {
        const candidateText = chunkTextStr.substring(0, bestBreakPoint);
        const newTokens = encoding.encode(candidateText);
        if (newTokens.length > safeOverlap || newTokens.length === (end - start)) {
          finalChunkText = candidateText;
          end = start + newTokens.length;
        }
      }

      chunks.push(finalChunkText.trim());
    } else {
      const chunkTokens = tokens.slice(start);
      chunks.push(decoder.decode(chunkTokens).trim());
    }

    start = Math.max(start + 1, end - safeOverlap);
  }

  return chunks.filter(chunk => chunk.length > 0);
}

module.exports = { chunkText };
```

- [ ] **Step 4: 验证测试通过**

```bash
node --test vcp-memory/tests/utils/test-text-chunker.test.js
```

Expected: 5 tests pass.

- [ ] **Step 5: 提交**

```bash
git add vcp-memory/src/utils/text-chunker.js vcp-memory/tests/utils/test-text-chunker.test.js
git commit -m "feat(vcp-memory): extract text chunker with parameterized config"
```

---

## Phase 3-7: 任务级大纲

以下阶段将在 Phase 1-2 完成后，各自生成详细计划。此处提供任务级概要。

### Phase 3: 接口 + Provider 提取

| Task | 描述 | 源文件 | 目标 |
|------|------|--------|------|
| 3.1 | 定义 EmbeddingProvider 接口 | (新) | `src/interfaces/embedding-provider.js` |
| 3.2 | 定义 VectorStore 接口 | (新) | `src/interfaces/vector-store.js` |
| 3.3 | 定义 MetadataStore 接口 | (新) | `src/interfaces/metadata-store.js` |
| 3.4 | 实现 OpenAI 兼容 EmbeddingProvider | `EmbeddingUtils.js` | `src/providers/openai-embedding-provider.js` |
| 3.5 | 实现 VexusVectorStore | `rust-vexus-lite/index.js` + `modules/knowledgeBase/indexRepository.js` | `src/providers/vexus-vector-store.js` |
| 3.6 | 实现 SqliteMetadataStore | `modules/knowledgeBase/` (schemaManager, databaseCoordinator, sqliteHealthManager, sqliteQueryUtils, diaryMetadataCache, tagConsistencyService, migrationVectorCache, memoryProfiler) | `src/providers/sqlite-metadata-store.js` + `src/utils/` |

**验证：** Provider 集成测试（真实 SQLite + VexusIndex）

### Phase 4: Stage 提取

| Task | 描述 | 源逻辑 | 目标 |
|------|------|--------|------|
| 4.1 | 摄入阶段：FileReader, TagExtractor, TextChunker | `KnowledgeBaseManager._flushBatch` | `src/stages/ingestion/file-reader.js`, `tag-extractor.js`, `text-chunker.js` |
| 4.2 | 摄入阶段：ChunkEmbedder, TagEmbedder | `KnowledgeBaseManager._flushBatch` | `src/stages/ingestion/chunk-embedder.js`, `tag-embedder.js` |
| 4.3 | 摄入阶段：MetadataWriter, VectorIndexer, CooccurrenceBuilder | `KnowledgeBaseManager._flushBatch` | `src/stages/ingestion/metadata-writer.js`, `vector-indexer.js`, `cooccurrence-builder.js` |
| 4.4 | 检索阶段：QueryEmbedder, VectorSearcher, BM25Searcher, CandidateMerger | `KnowledgeBaseManager.search` | `src/stages/retrieval/*.js` |
| 4.5 | Memo 阶段：EPAProjector, ResidualPyramid, TagExpander, VectorReshaper | `KnowledgeBaseManager.search` | `src/stages/memo/*.js` |
| 4.6 | Memo 阶段：TagMemoV9 | `TagMemoEngine.js` (4137行) | `src/stages/memo/tagmemo-v9.js` + `src/algorithms/wave-propagation.js` |
| 4.7 | Memo 阶段：TagMemoV10, RiverMemo | `TagMemoV10Engine.js`, `RiverMemoEngine.js` | `src/stages/memo/tagmemo-v10.js`, `rivermemo.js` |
| 4.8 | 后处理阶段：ResultDeduplicator, ExternalReranker, TimeDecay, Truncator, Expander, Associator | `ResultDeduplicator.js`, `KnowledgeBaseManager` | `src/stages/postprocess/*.js` |
| 4.9 | 输出阶段：ResultFormatter | `KnowledgeBaseManager.search` | `src/stages/output/result-formatter.js` |
| 4.10 | 拓扑组件迁移 | `modules/tagmemoV10/` (17文件) | `src/algorithms/topology/` |

**验证：** 阶段单测

### Phase 5: Pipeline 组装 + Engine 工厂

| Task | 描述 | 源逻辑 | 目标 |
|------|------|--------|------|
| 5.1 | 实现 IngestPipeline | `KnowledgeBaseManager._flushBatch` | `src/pipelines/ingest-pipeline.js` |
| 5.2 | 实现 SearchPipeline | `KnowledgeBaseManager.search` | `src/pipelines/search-pipeline.js` |
| 5.3 | 实现 DeletePipeline | `KnowledgeBaseManager._handleDelete` | `src/pipelines/delete-pipeline.js` |
| 5.4 | 实现 createMemoryEngine 工厂 | `KnowledgeBaseManager.initialize` | `src/engine.js` |
| 5.5 | 实现 RAG 参数加载器 | `rag_params.json` | `src/config/rag-params-loader.js` |
| 5.6 | 实现默认配置 | `config.env` 参数 | `src/config/default-config.js` |
| 5.7 | 实现旧 API 兼容层 | `KnowledgeBaseManager` 公开方法 | `src/engine.js` 适配方法 |
| 5.8 | 更新 index.js 导出 | - | `index.js` |

**验证：** 端到端测试（摄入文件 -> 检索 -> 验证结果）

### Phase 6: TDB 冷知识提取

| Task | 描述 | 源文件 | 目标 |
|------|------|--------|------|
| 6.1 | 提取 TDB 引擎 | `TDBKnowledge.js` (1290行) | `src/tdb/tdb-engine.js` |
| 6.2 | 实现 TDB 检索管道 | `TDBKnowledge.js` search 逻辑 | `src/tdb/tdb-search-pipeline.js` |
| 6.3 | 适配 TriviumDB | `TDBKnowledge.js` | `src/tdb/triviumdb-adapter.js` |

**验证：** TDB 检索测试

### Phase 7: VCPToolBox 接入

| Task | 描述 | 源文件 | 目标 |
|------|------|--------|------|
| 7.1 | 修改 server.js 使用新库 | `server.js:113,1524,1532` | `require('./vcp-memory')` |
| 7.2 | 修改 Plugin.js 依赖注入 | `Plugin.js:945-951` | 适配 engine 对象 |
| 7.3 | 修改 admin 路由 | `routes/admin/rag.js` | 适配 engine 方法 |
| 7.4 | 验证 VCPToolBox 启动和 RAG 检索 | - | - |
| 7.5 | 清理旧文件（可选） | `KnowledgeBaseManager.js` 等 | 移除或保留为 re-export |

**验证：** 在 VCPToolBox 中启动 server.js，验证 RAG 检索正常

---

## Self-Review

### Spec coverage

| Spec section | Covered by |
|---|---|
| §2 整体架构 - 管道式 IPO | Task 1 (Pipeline/Stage/Context), Phase 5 (pipelines) |
| §3 模块结构 | Task 1 (directory structure), all tasks create files in spec locations |
| §4.1 数据类型 | Task 1 (JSDoc in context.js), Phase 4-5 (types in stages/pipelines) |
| §4.2 EmbeddingProvider | Phase 3 Task 3.1, 3.4 |
| §4.3 VectorStore | Phase 3 Task 3.2, 3.5 |
| §4.4 MetadataStore | Phase 3 Task 3.3, 3.6 |
| §4.5 Stage/Pipeline | Task 1 (core/pipeline.js, stage.js, context.js) |
| §5.1 IngestPipeline | Phase 5 Task 5.1 |
| §5.2 SearchPipeline | Phase 5 Task 5.2 |
| §5.3 DeletePipeline | Phase 5 Task 5.3 |
| §5.4 TDBSearchPipeline | Phase 6 Task 6.2 |
| §6 公开 API | Phase 5 Task 5.4, 5.8 |
| §7 迁移路径 | Phase 1-7 structure matches spec §7 |
| Algorithms (EPA, ResidualPyramid, Gram-Schmidt, SVD) | Task 5-8 |

### Placeholder scan

No TBD/TODO in Phase 1-2 tasks. Phase 3-7 are intentionally outlines pending their own detailed plans - this is noted explicitly.

### Type consistency

- `EPA` class: constructor accepts `{ orthoBasis, basisMean, basisLabels, basisEnergies }` + config - consistent across test and implementation
- `ResidualPyramid` class: constructor accepts `config` only; `analyze()` accepts `{ searchFn, lookupFn }` - consistent across test and implementation
- `orthogonalProjection()` from gram-schmidt.js used by residual-pyramid.js - signatures match
- `clusterTags()` and `computeWeightedPCA()` from svd.js used by epa.js - signatures match
- `Pipeline.run(initialInput, ctx)` and `Stage.process(input, ctx)` - consistent

### Gaps

- Phase 3-7 need detailed plans (noted as next steps)
- `wave-propagation.js` algorithm (from TagMemoEngine) not yet detailed - will be in Phase 4 Task 4.6
- Topology components (17 files from modules/tagmemoV10/) migration not yet detailed - will be in Phase 4 Task 4.10
