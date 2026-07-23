import type { FlowEngine, EngineEvent, SegmentResult, FlowNode, EngineInitConfig } from '../../types/flow-v2.js';
import { getLogger } from '../logger.js';

export class EngineRegistry {
  private engines: Map<string, FlowEngine> = new Map();
  private initializedEngines: Set<string> = new Set();
  private initConfigs: Map<string, EngineInitConfig> = new Map();
  private log = getLogger();

  register(engine: FlowEngine): void {
    this.engines.set(engine.name, engine);
    this.log.info('[EngineRegistry] Engine registered', { name: engine.name });
  }

  unregister(name: string): void {
    this.engines.delete(name);
    this.initializedEngines.delete(name);
    this.initConfigs.delete(name);
  }

  get(name: string): FlowEngine | undefined {
    return this.engines.get(name);
  }

  list(): FlowEngine[] {
    return Array.from(this.engines.values());
  }

  setInitConfig(engineName: string, config: EngineInitConfig): void {
    this.initConfigs.set(engineName, config);
  }

  isInitialized(name: string): boolean {
    return this.initializedEngines.has(name);
  }

  async getOrInitialize(name: string): Promise<FlowEngine> {
    const engine = this.engines.get(name);
    if (!engine) {
      throw new Error(`Engine not found: ${name}`);
    }

    if (!this.initializedEngines.has(name) && engine.initialize) {
      const initConfig = this.initConfigs.get(name);
      if (!initConfig) {
        throw new Error(`Init config not set, cannot initialize engine: ${name}`);
      }
      this.log.info('[EngineRegistry] Initializing engine', { name });
      await engine.initialize(initConfig);
      this.initializedEngines.add(name);
    }

    return engine;
  }

  findEngineForNode(nodeType: string, explicitEngine?: string): FlowEngine | undefined {
    if (explicitEngine) {
      return this.engines.get(explicitEngine);
    }

    for (const engine of this.engines.values()) {
      for (const pattern of engine.supportedNodeTypes) {
        if (this.matchNodeType(pattern, nodeType)) {
          return engine;
        }
      }
    }

    return undefined;
  }

  private matchNodeType(pattern: string, nodeType: string): boolean {
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -2);
      return nodeType.startsWith(prefix + '.') || nodeType === prefix;
    }
    return pattern === nodeType;
  }

  async executeSegment(
    engineName: string,
    segment: FlowNode[],
    variablePool: Record<string, unknown>,
    signal: AbortSignal,
    onEvent: (event: EngineEvent) => void,
  ): Promise<SegmentResult> {
    const engine = await this.getOrInitialize(engineName);
    return engine.executeSegment(segment, variablePool, signal, onEvent);
  }

  async disposeAll(): Promise<void> {
    const disposePromises: Promise<void>[] = [];
    for (const engine of this.engines.values()) {
      if (engine.dispose && this.initializedEngines.has(engine.name)) {
        disposePromises.push(engine.dispose());
      }
    }
    await Promise.all(disposePromises);
    this.initializedEngines.clear();
    this.log.info('[EngineRegistry] All engines disposed');
  }
}
