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
    if (tool.origin !== this.origin) throw new DOMException("Wrong origin", "SecurityError");
    const transported = structuredClone(input);
    const registered = this.tools.get(tool.name);
    if (!registered) throw new DOMException('Gone', 'NotFoundError');
    const controller = new AbortController();
    return new Promise((resolve, reject) => {
      const abort = () => { reject(options?.signal?.reason); controller.abort(options?.signal?.reason); };
      options?.signal?.addEventListener('abort', abort, { once: true });
      registered.execute(transported, { signal: controller.signal }).then(value => {
        if (controller.signal.aborted) return;
        try { const json = JSON.stringify(value); if (json === undefined) throw Error('No JSON'); resolve(json); }
        catch { reject(new DOMException('Result serialization failed', 'OperationError')); }
      }, () => { if (!controller.signal.aborted) reject(new DOMException('Callback failed', 'OperationError')); })
        .finally(() => options?.signal?.removeEventListener('abort', abort));
    });
  }
}
