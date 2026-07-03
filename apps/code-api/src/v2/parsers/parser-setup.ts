/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */
// Pre-load tree-sitter native binding before any parser spec runs.
//
// Root cause this guards against:
//   tree-sitter/index.js installs `Tree.prototype.rootNode` (plus a few
//   sibling getters on Tree / TreeCursor) via
//   `Object.defineProperty(..., { get(){ ... rootNode.call(this) ... }, configurable: true })`,
//   where `rootNode` is captured from `Tree.prototype` *at module-load
//   time* via destructure. Jest creates a fresh JS sandbox per spec
//   file, so `tree-sitter/index.js` re-executes for each spec — but the
//   native addon (and therefore `Tree.prototype`, which lives on it) is
//   shared across the whole process. On the second load,
//   `const {rootNode} = Tree.prototype` reads the *previous* sandbox's
//   installed getter; that getter checks `this instanceof Tree` against
//   `Tree.prototype` and returns `undefined`. The new getter then closes
//   over an undefined `rootNode` and silently returns `undefined` for
//   every tree it sees in this sandbox — observed by callers as
//   `Cannot read properties of undefined (reading 'namedChildren')`.
//
// Fix:
//   1. Reach the native binding directly via `node-gyp-build` BEFORE
//      `tree-sitter/index.js` ever runs in this process, and snapshot
//      the pristine native functions off `Tree.prototype` /
//      `TreeCursor.prototype`. The native binding is a singleton object
//      cached by Node by addon path, so we stash the snapshot ON THE
//      BINDING ITSELF (a shared symbol-keyed property). globalThis is
//      sandbox-local in Jest and cannot be used for cross-sandbox state.
//   2. Before every subsequent sandbox loads tree-sitter, re-install
//      those native functions as data properties on the shared
//      prototypes. tree-sitter's per-sandbox initializer then
//      destructures a real callable and installs a fresh (working) JS
//      getter that closes over it.
//
// We resolve `node-gyp-build` through tree-sitter's own dependency
// cone so this works under both npm (hoisted) and pnpm (where
// `node-gyp-build` is not a direct dep of this package).

const NATIVE_BAG = Symbol.for('engram-code.tree-sitter.nativeBag');

type NativeFn = (...args: unknown[]) => unknown;
type NativeBag = {
  treeRootNode?: NativeFn;
  cursorCurrentNode?: NativeFn;
  cursorStartPosition?: NativeFn;
  cursorEndPosition?: NativeFn;
};

function loadNativeBinding(): any {
  const path = require('path');
  const treeSitterDir = path.dirname(require.resolve('tree-sitter/package.json'));
  // pnpm does not hoist `node-gyp-build` as a direct dep of this package,
  // so resolve it through tree-sitter's own dependency cone.
  const ngbPath = require.resolve('node-gyp-build', { paths: [treeSitterDir] });
  return require(ngbPath)(treeSitterDir);
}

function readNativeFn(proto: object, key: string): NativeFn | undefined {
  const desc = Object.getOwnPropertyDescriptor(proto, key);
  if (!desc) return undefined;
  // Pristine prototype: native function lives as a data property.
  if (typeof desc.value === 'function') return desc.value as NativeFn;
  return undefined;
}

function installDataProp(proto: object, key: string, fn: NativeFn | undefined): void {
  if (!fn) return;
  Object.defineProperty(proto, key, {
    value: fn,
    configurable: true,
    writable: true,
  });
}

const binding = loadNativeBinding();

// First entry into this process: snapshot the pristine native functions
// before tree-sitter/index.js has had a chance to replace them with
// getters, and stash on the shared binding object (which is identity-
// shared across Jest sandboxes because Node caches native addons by
// path). Subsequent sandboxes see the bag and skip the snapshot step.
if (!(binding as any)[NATIVE_BAG]) {
  const bag: NativeBag = {
    treeRootNode: readNativeFn(binding.Tree.prototype, 'rootNode'),
    cursorCurrentNode: readNativeFn(binding.TreeCursor.prototype, 'currentNode'),
    cursorStartPosition: readNativeFn(binding.TreeCursor.prototype, 'startPosition'),
    cursorEndPosition: readNativeFn(binding.TreeCursor.prototype, 'endPosition'),
  };
  (binding as any)[NATIVE_BAG] = bag;
}

// Every sandbox (including the first): make sure the shared prototypes
// have the native functions as data properties before tree-sitter's
// index.js destructures them. On the first sandbox this is a no-op (the
// natives are already there); on later sandboxes it undoes the prior
// sandbox's getter replacement.
{
  const bag: NativeBag = (binding as any)[NATIVE_BAG];
  installDataProp(binding.Tree.prototype, 'rootNode', bag.treeRootNode);
  installDataProp(binding.TreeCursor.prototype, 'currentNode', bag.cursorCurrentNode);
  installDataProp(binding.TreeCursor.prototype, 'startPosition', bag.cursorStartPosition);
  installDataProp(binding.TreeCursor.prototype, 'endPosition', bag.cursorEndPosition);
}

require('tree-sitter');
require('tree-sitter-python');
require('tree-sitter-typescript');
require('tree-sitter-go');
require('tree-sitter-elixir');
require('tree-sitter-rust');
require('tree-sitter-swift');
