# Named model connections

The normal flow is provider, key, model discovery or manual model entry, Test, Save and Use. Save validates syntax and local ownership without DNS or a model request. Test performs a minimal real request through the selected transport, with a 20 second browser deadline. It may consume billable tokens. A saved profile is not a tested profile, and a successful small test is not a large context or literary quality certification.

## Profiles and routing

Stable profile IDs are independent of writer and helper roles. Add, Change, Copy, Test, Use, Remove, Fetch models and Details are implemented. Multiple models from one provider remain independent. The header picker assigns the open novel's writer. Global defaults and explicit novel overrides are separate. Helper resolution uses a novel override, then the global helper, then that novel's writer. Choosing the writer itself as the helper is supported without duplicating credentials. Requests await pending assignment changes and capture the resolved configuration; later selection changes do not retarget a running job.

Legacy primary and helper IDs remain ordinary named profiles, so old receipts still identify them. Adapter, endpoint, model, parameters, limits, pricing and retention choices migrate. The server retains its legacy configuration for recovery. No missing memory only key is invented. Removing a profile explains the affected roles, clears those assignments, preserves other profiles and receipts, and falls back predictably to the remaining default writer.

Metadata always persists in the browser and, when available, in the independent local configuration. Saving while the service is unavailable retains browser metadata and shows relay setup pending. Reopen it and Save after reconnecting. An unsaved key pending in page memory cannot survive a page restart.

## Presets and transport

| Preset           | Default transport  | Editable endpoint starting point                                 |
| ---------------- | ------------------ | ---------------------------------------------------------------- |
| Claude           | Anthropic Messages | api.anthropic.com/v1/messages                                    |
| OpenAI           | OpenAI Responses   | api.openai.com/v1/responses                                      |
| OpenRouter       | OpenRouter Chat    | openrouter.ai/api/v1/chat/completions                            |
| Gemini           | Compatible Chat    | generativelanguage.googleapis.com/v1beta/openai/chat/completions |
| DeepSeek         | Compatible Chat    | api.deepseek.com/v1/chat/completions                             |
| Z.ai GLM         | Compatible Chat    | api.z.ai/api/paas/v4/chat/completions                            |
| Hermes Agent     | Compatible Chat    | Explicit local /v1/chat/completions                              |
| Local and Custom | Compatible Chat    | Author supplied endpoint                                         |

Models start blank. A preset is a configuration starting point, not proof that a particular model is available. Fetch models uses the configured provider's authenticated models endpoint and returns a sorted picker. Reported context, output, reasoning and parameter metadata is cached against adapter, endpoint and model. Explicit overrides stay authoritative. Missing metadata means unknown support, not no support. Manually entered models survive discovery failure. Changing an endpoint or adapter does not automatically replace a custom URL; Build endpoint from base URL is an explicit action.

Responses uses typed events, Chat and OpenRouter use chat deltas, and Anthropic uses message and content block events. Incremental SSE handling supports split UTF8, split events, comments, empty deltas, usage only events, unknown event types, refusals, output limits, malformed completion, interruption and errors after text. Only prose text becomes manuscript material. Public provider supplied thought summaries or reasoning content remain secondary receipt data, never manuscript text. The application does not retrieve hidden internal reasoning.

## Model controls

Reasoning intentions include Off, Low, Medium, High, XHigh and Max, with Minimal retained for supported legacy models. Explicit or reported supported levels govern mapping. Lower supported equivalents and models that cannot disable reasoning are explained. Separate serializers cover Responses effort, OpenRouter reasoning, Claude adaptive or token budget thinking, DeepSeek and GLM thinking, compatible Gemini effort or budget, Hermes model_options, Qwen enable_thinking and Kimi compatible extensions. Model specific support still needs the chosen endpoint's Test. Gemini effort and token budget are mutually exclusive.

Sampling covers temperature, top p, top k, min p, presence, frequency and repetition penalties, seed and stop sequences. Unset values stay absent. Numeric precision remains intact. Native transports send their supported knobs only; custom compatible extensions require explicit capability configuration. Values that cannot be sent remain stored with a reason rather than disappearing. Output limit and context reserve use the selected profile snapshot. Optional prices must be finite and nonnegative; unknown prices remain unknown.

Assistant opening, a compatible public thinking seed and structured prefill are separate modes. Responses has no pretend assistant prefill. Structured prefill requires explicitly configured compatible Chat JSON schema support. Literary templates support literal openings, bounded slots, a hidden heading with [[keep]], and explicit stop markers. Only a valid completed decoded prose field becomes the candidate. Invalid or incomplete JSON remains a separate recoverable job artifact. JSON wrappers and control markers are never inserted as prose. Structured output is held until decoding completes; ordinary prose streams normally. Test prefill is explicit and can be billable. Presets do not import RP character voice or forced scene header rules.

Native web lookup is available only with declared support on Responses, Anthropic or OpenRouter. OpenRouter uses its native engine setting rather than silently paying for an external search fallback. Search is off by default and never enabled for helper JSON. Claude prompt caching has an explicit ephemeral system block option. Other transports retain provider reported cache accounting rather than inventing cached usage.

Receipts show connection, model, request purpose, reported input and output, cache reads and writes when reported, local input estimate, effective output allowance, known rates, estimated cost, duration and finish reason. Foreground writing and optional Story Brain work are distinct. Missing usage or required cache prices produce unknown cost, not zero. Usage never controls the response stream.

Recognizable authentication, permission, model, endpoint, parameter, rate, quota, timeout, DNS and TLS failures receive redacted classifications. Browser direct failures honestly combine connectivity and CORS because the browser does not reveal which failed. Malformed streams, refusal and interruption remain distinct. Prior redacted test and refusal observations remain in profile Details under their exact model, endpoint and transport identity. They do not disable settings on another model. No automatic paid compatibility retries or model changes occur. Inspect the failed setting, adjust it, and explicitly Test or Try another. Partial output remains recoverable under its original source.

## Keys and security

The local relay is preferred. Remember this API key on this device is explicit. Otherwise the key remains in service memory and is absent after restart. Named metadata persists in either case. An explicit loopback model may allow unauthenticated operation; remote profiles with no key show Key needed. Keys are separate references, not role duplicates. Editing a copied key or choosing a different retention policy preserves the other profile's key.

Connection file format 2 uses atomic replacement, fsync and restrictive permissions. Those permissions are not encryption. Previously remembered keys can remain in owned legacy recovery files; keep the device directory private. Corrupt configuration retains a bounded recovery copy and warns rather than inventing a key. A future format fails without modification. Normal manuscript backups contain only nonsecret profiles, selections, appearance and literary styles.

Browser direct is explicit, uses CORS and verified browser TLS, follows no redirects, omits ambient credentials and binds page memory keys to the exact configured origin. It does not persist browser keys or send the local session token upstream. A browser refusal is never bypassed. Relay use rechecks DNS and all resolved addresses, pins a validated destination, keeps TLS verification, forbids arbitrary tools and cross host redirects, and permits loopback only by explicit configuration. Saving offline does not weaken these use time checks.

## Context and evidence

Counts remain an estimate of serialized UTF8 bytes divided by three. Output, request framing, reasoning reserve and a safety margin are reserved. Advertised or manually confirmed 200000 and 500000 capacities are not proof of provider acceptance or memory quality. Stateless requests keep discarded branches and other novels out of provider conversation state. Storage is disabled where supported, without promising that this eliminates every retention policy.

Tests use synthetic local providers, actual HTTP and browser direct boundaries, real IndexedDB and SQLite, and pure serializers. They do not establish account compatibility, live native web behaviour, live prompt cache pricing or literary quality. See VERIFICATION.md and RELEASE_1_2.md.

Primary references consulted:

- https://developers.openai.com/api/docs/guides/streaming-responses
- https://platform.claude.com/docs/en/build-with-claude/streaming
- https://openrouter.ai/docs/api_reference/streaming
- https://ai.google.dev/gemini-api/docs/openai
- Read only CozyTavern provider and connection sources at a52ff50bcf35240b68e786bad10f83ac01f6e2da, independently adapted rather than imported.
