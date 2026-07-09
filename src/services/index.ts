export * from "@/services/stock-service";
// yield/ is a plain module of functions - re-exported as a namespace so it's still used as
// `YieldService.getCumulativeYields(...)` etc. at call sites.
export * as YieldService from "@/services/yield";
