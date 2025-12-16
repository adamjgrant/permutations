export declare class Engine {
    private variables;
    private jsContext;
    private loadedModules;
    compile(script: string, baseDir?: string): void;
    private handleImport;
    generate(entryPoint: string): string;
    private evaluateNodes;
    private evaluateNode;
    private evaluateChoice;
    private evaluateInterpolation;
}
//# sourceMappingURL=engine.d.ts.map