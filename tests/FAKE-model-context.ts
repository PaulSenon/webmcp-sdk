/** FAKE of the draft algorithms, not evidence of browser conformance. */
import type { ModelContextLike, ModelContextConsumerLike, ModelContextTool, RegisteredTool } from '../src/index.js';
export class FakeModelContext extends EventTarget implements ModelContextLike, ModelContextConsumerLike {
  tools = new Map<string, ModelContextTool>();
  window = {} as Window;
  origin = 'https://fake.example';
  async registerTool(tool: ModelContextTool, options?: { signal?: AbortSignal }) {
    options?.signal?.throwIfAborted();
    if (this.tools.has(tool.name)) throw new DOMException('Duplicate', 'InvalidStateError');
    this.tools.set(tool.name, tool);
    const change = () => this.dispatchEvent(new Event('toolchange'));
    options?.signal?.addEventListener('abort', () => { this.tools.delete(tool.name); change(); }, { once: true });
    change();
  }
  async getTools(): Promise<readonly RegisteredTool[]> {
    return [...this.tools.values()].map(({ execute, ...tool }) => ({ ...tool, window: this.window, origin: this.origin }));
  }
  async executeTool(tool: RegisteredTool, input: object = {}, options?: { signal?: AbortSignal }): Promise<string> {
    options?.signal?.throwIfAborted();
    const registered = this.tools.get(tool.name);
    if (!registered) throw new DOMException('Gone', 'NotFoundError');
    const controller = new AbortController();
    return new Promise((resolve, reject) => {
      const abort = () => { reject(options?.signal?.reason); controller.abort(options?.signal?.reason); };
      options?.signal?.addEventListener('abort', abort, { once: true });
      registered.execute(input, { signal: controller.signal }).then(value => resolve(JSON.stringify(value)),
        () => reject(new DOMException('Callback failed', 'OperationError')))
        .finally(() => options?.signal?.removeEventListener('abort', abort));
    });
  }
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
