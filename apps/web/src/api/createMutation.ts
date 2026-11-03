// F-205: a create mutation with an idempotency key that survives retries of the same input.
import { canonicalJson } from "@budmon/shared";
import {
  createMutation,
  useQueryClient,
  type MutateOptions,
  type CreateMutationResult,
  type QueryKey,
} from "@tanstack/solid-query";

type Created = { id: string; createdAt: string };

/** The mutation's variables: the input and the key bound to this call (B-1). */
interface Vars<I> {
  input: I;
  key: string;
}

export function createCreateMutation<I>(opts: {
  mutationFn: (input: I, idempotencyKey: string) => Promise<Created>;
  invalidate: readonly QueryKey[];
}): CreateMutationResult<Created, unknown, I> {
  const queryClient = useQueryClient();
  let key = crypto.randomUUID();
  /** The canonical input of the last call, while it hasn't succeeded. */
  let failedInput: string | undefined;

  /** The key for a new call: a manual retry with unchanged input after a failure reuses it. */
  const bind = (input: I): Vars<I> => {
    const canonical = canonicalJson(input);
    if (failedInput !== canonical) key = crypto.randomUUID();
    failedInput = canonical;
    return { input, key };
  };

  const inner = createMutation(() => ({
    meta: { idempotent: true },
    // Automatic retries get the same variables, so each call's retries keep that call's key.
    mutationFn: (vars: Vars<I>) => opts.mutationFn(vars.input, vars.key),
    onSuccess: async () => {
      failedInput = undefined;
      await Promise.all(
        opts.invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
    },
  }));

  // The caller's API takes the input; the key is bound when the call is made. Per-call callbacks
  // see the input as their variables, as they would without the key.
  type Options = MutateOptions<Created, unknown, I> | undefined;
  const unwrap = (options: Options): MutateOptions<Created, unknown, Vars<I>> | undefined =>
    options === undefined
      ? undefined
      : {
          ...(options.onSuccess === undefined
            ? {}
            : { onSuccess: (d, v, r, c) => options.onSuccess?.(d, v.input, r, c) }),
          ...(options.onError === undefined
            ? {}
            : { onError: (e, v, r, c) => options.onError?.(e, v.input, r, c) }),
          ...(options.onSettled === undefined
            ? {}
            : { onSettled: (d, e, v, r, c) => options.onSettled?.(d, e, v.input, r, c) }),
        };
  const mutate = (input: I, options?: Options): void => {
    inner.mutate(bind(input), unwrap(options));
  };
  const mutateAsync = (input: I, options?: Options): Promise<Created> =>
    inner.mutateAsync(bind(input), unwrap(options));
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === "mutate") return mutate;
      if (prop === "mutateAsync") return mutateAsync;
      if (prop === "variables") return target.variables?.input;
      return Reflect.get(target, prop, receiver) as unknown;
    },
  }) as unknown as CreateMutationResult<Created, unknown, I>;
}
