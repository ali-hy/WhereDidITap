// F-341: the API version. Bump API_MINOR in every pull request that changes openapi.json (F-8).
export const API_MAJOR = 1;
export const API_MINOR: number = 0;
export const API_VERSION = `1.${String(API_MINOR)}` as `1.${number}`;
