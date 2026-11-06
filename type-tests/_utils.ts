/** Minimal type-assertion helpers (no runtime, no dependency). */
export type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
export type Expect<T extends true> = T;
/** Declares a value of type T without producing one. Type tests are never executed. */
export declare function value<T>(): T;
/** Mutual assignability, for types whose display form may differ (intersections). */
export type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
