# Model connections

Choose an adapter explicitly and enter the complete endpoint for that transport. The server does not infer a protocol from the model name or hostname.

Responses uses typed response events and input text content, with provider conversation storage disabled. Chat Completions and OpenRouter use chat delta chunks. Anthropic uses message and content block events. Only text deltas become prose. Reasoning, usage, errors and refusals stay outside the manuscript.

Capability checkboxes control temperature, top p, usage stream options, disabling storage, the Chat completion limit field, and Responses reasoning effort. Unsupported controls are disabled or omitted from the request. Changing adapters does not replace custom endpoints. Use the explicit default endpoint button when wanted.

Context counts use serialized UTF8 bytes divided by three as an estimate. Output capacity, the configured reasoning reserve and a safety margin are reserved first. Actual provider tokenization can differ. A 200000 or 500000 setting requires explicit capability confirmation. It is not proof that a provider supports that input or will remember it perfectly.

Requests contain explicit context rather than a persistent provider conversation. Disabling storage where supported is not a promise about every provider retention policy. Unknown prices or absent usage produce an unknown cost, never a fabricated zero.

Saving a connection makes no paid model request. The first requested writing or discussion action is the actual compatibility test. Live account compatibility and literary quality were not tested during development because live calls were not authorized.

Official protocol references consulted for implementation:

* https://developers.openai.com/api/docs/guides/streaming-responses
* https://platform.claude.com/docs/en/build-with-claude/streaming
* https://openrouter.ai/docs/api_reference/streaming
* https://docs.python.org/3/library/sqlite3.html
