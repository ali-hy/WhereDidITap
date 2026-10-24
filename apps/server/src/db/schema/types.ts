import { customType } from "drizzle-orm/pg-core";

/** `bytea` as a Node Buffer. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});
