const count = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : null;
export function usageCounts(usage = {}) {
  usage = usage || {};
  return {
    input: count(usage.input_tokens ?? usage.prompt_tokens),
    output: count(usage.output_tokens ?? usage.completion_tokens),
    cached: count(
      usage.cache_read_input_tokens ??
        usage.input_tokens_details?.cached_tokens ??
        usage.prompt_tokens_details?.cached_tokens ??
        null,
    ),
    cacheWrite: count(usage.cache_creation_input_tokens),
  };
}
export function requestCost(usage, c) {
  const u = usageCounts(usage);
  if (
    u.input == null ||
    u.output == null ||
    c.inputPrice == null ||
    c.outputPrice == null
  )
    return null;
  if (
    (u.cached > 0 && c.cachedPrice == null) ||
    (u.cacheWrite > 0 && c.cacheWritePrice == null)
  )
    return null;
  const input =
    c.adapter === "anthropic"
      ? u.input
      : Math.max(0, u.input - (u.cached || 0));
  return (
    (input * c.inputPrice +
      u.output * c.outputPrice +
      (u.cached || 0) * (c.cachedPrice || 0) +
      (u.cacheWrite || 0) * (c.cacheWritePrice || 0)) /
    1000000
  );
}
