import { expect } from 'chai';
import { pathToFileURL } from 'url';

describe('squooshhqx initSync', function () {
  it('initializes wasm and forwards resize arguments', async function () {
    const origModule = WebAssembly.Module;
    const origInstance = WebAssembly.Instance;

    let recordedArgs = null;
    const memory = new WebAssembly.Memory({ initial: 1 });
    const mem32 = new Uint32Array(memory.buffer);
    let stackPtr = 16;
    let heapPtr = 32;

    const stubExports = {
      memory,
      __wbindgen_add_to_stack_pointer(n) {
        stackPtr += n;
        return stackPtr;
      },
      __wbindgen_malloc(size) {
        const ptr = heapPtr;
        heapPtr += size;
        return ptr;
      },
      __wbindgen_free() {},
      resize(retptr, ptr, len, w, h, f) {
        recordedArgs = [ptr, len, w, h, f];
        mem32[retptr / 4] = ptr;
        mem32[retptr / 4 + 1] = len;
      }
    };

    class ModuleStub {
      constructor(bytes) {
        this.bytes = bytes;
      }
    }
    class InstanceStub {
      constructor(module, imports) {
        this.module = module;
        this.imports = imports;
        this.exports = stubExports;
      }
    }

    WebAssembly.Module = ModuleStub;
    WebAssembly.Instance = InstanceStub;

    try {
      const modPath = pathToFileURL('js/vendor/hqx/squooshhqx.js').href + `?t=${Date.now()}`;
      const { initSync, resize } = await import(modPath);
      const wasmExports = initSync(new Uint8Array(0));
      expect(wasmExports).to.equal(stubExports);

      const input = Uint32Array.from([1, 2, 3, 4]);
      const out = resize(input, 2, 2, 3);
      expect(recordedArgs).to.eql([32, input.length, 2, 2, 3]);
      expect(Array.from(out)).to.eql(Array.from(input));
    } finally {
      WebAssembly.Module = origModule;
      WebAssembly.Instance = origInstance;
    }
  });
});
