export * from "@/services/stock-service";
// yield-service.ts is a plain module of functions (no instance state, so no
// need for a class) - re-exported as a namespace so it's still used as
// `YieldService.getCumulativeYields(...)` etc. at call sites.
export * as YieldService from "@/services/yield-service";
