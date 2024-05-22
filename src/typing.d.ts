type OmitFirst<T extends Array<any>> = T extends [any, ...infer R] ? R : never;

export type BoundFunction<T extends (...args: any[]) => any> = (...args: OmitFirst<Parameters<T>>) => ReturnType<T>;
