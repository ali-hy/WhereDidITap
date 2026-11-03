// F-346: the contract root and the shared contract building blocks.
import { metaContract } from "./meta/metaContract.js";

export * from "./common/money.js";
export * from "./common/dates.js";
export * from "./common/ids.js";
export * from "./common/version.js";
export * from "./common/errors.js";
export * from "./common/create.js";
export * from "./common/cursor.js";
export * from "./meta/metaContract.js";
export * from "./rules/listProcedures.js";

export const contract = {
  meta: metaContract,
  // Modules add their keys.
};
