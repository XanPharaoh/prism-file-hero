# OmniRoute free-model selection for Prism File Hero

Measured 2026-10-19 against the operator's OmniRoute gateway. Nothing in this file is a benchmark
quote, a model card, or a guess: every row is an HTTP response recorded in
`survey-*.jsonl`, produced by `scripts/feature-audit/omniroute-survey.mjs` sending the **Worker's own
payload shape** (`{model, messages, temperature, max_tokens: 4096}`) so the measurement transfers.

The probe never sends a customer document. The vision ground truth is a statement page rendered
locally by this repo (`MERIDIAN BANK`, account `4471-99-1`, `TAKEALOT −1,245.67`), and the long-form
ground truth is a 12-row ledger whose totals appear nowhere in the rows.

## What was measured

Three stages, applied in order, each a filter on the survivors of the last:

| stage | question | pass condition |
| :-- | :-- | :-- |
| text | does this route answer at all | HTTP 200 and the requested token |
| vision | can it read a bank statement **image** | names the bank *and* the account from the rendered page |
| long-form | can it do the arithmetic it will be asked to do | names `5883.34`, `13384.14`, `17500.80` **and** `2000.00` |

The two sums are not present in the prompt's ledger rows, so an echo of the rows cannot pass
long-form. That property is the whole point of the test: the failure mode that matters for this app
is a model transcribing plausible numbers it did not compute.

### A grading bug that inverted the first result, and the correction

The first long-form pass required `content.length > 120` alongside correct figures. It reported
**1/14** models passing. Re-reading the recorded responses showed nine models had answered
*correctly and briefly* — the best answer any model produced was
`"5883.34\n13384.14\n17500.80\n2000.00"`, 33 characters — and was graded a failure for being concise.
The length floor was measuring verbosity, not accuracy. Grading now compares extracted numeric tokens
against the four targets to the cent, and records length separately. Re-run: **7/14 pass**.

This is recorded rather than quietly fixed, because a metric that rewards long answers on a financial
tool is a metric that rewards padding.

## The result

`✓` = HTTP 200 and correct · `✗` = HTTP 200 and wrong · `—` = no usable answer (status shown)

| model | text | vision (ms) | long-form (ms) | verdict |
| :-- | :-- | :-- | :-- | :-- |
| `kilocode/cohere/north-mini-code:free` | ✓ | ✓ 5 541 | ✓ 11 152 | **primary** |
| `kilocode/nvidia/nemotron-3-super-120b-a12b:free` | ✓ | ✓ 26 162 | ✓ 9 460 | **secondary** |
| `openai-compatible-chat-…/gemma-4-26b-a4b-it:free` | ✓ | ✓ 19 807 | ✓ 24 788 | passed, not deployable — see below |
| `kilocode/kilo-auto/free` | ✓ | ✓ 25 725 | ✓ 1 823 | passed, not deployable — see below |
| `kilocode/poolside/laguna-xs-2.1:free` | ✓ | ✗ 45 000 | ✓ 25 585 | arithmetic only |
| `kilocode/dots-studio/dots-3-note-preview:free` | ✓ | ✗ 45 002 | ✓ 14 238 | arithmetic only |
| `kilocode/nvidia/nemotron-3-ultra-550b-a55b:free` | ✓ | ✗ 34 567 | ✓ 42 802 | **rejected** — see below |
| `kilocode/poolside/laguna-s-2.1:free` | ✓ | ✗ 45 001 | ✗ 3 674 | **rejected** — see below |
| `kilocode/liquid/lfm-2.5-2.6b:free` | ✓ | ✗ 18 615 | ✗ 5 615 | **rejected** — see below |
| `kilocode/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | ✓ | ✗ 1 240 (502) | ✗ 684 (502) | unavailable |
| `kilocode/nvidia/nemotron-3.5-lightning:free` | ✓ | ✗ timeout | ✗ timeout | too slow to be usable |
| `cl/*` (the Cline pool) | — 402 | — | — | dead: *"All 1 connection(s) credits exhausted"* |
| `tokenrouter/nvidia/…` | — 403 | — | — | rejected by the upstream |
| `zenmux/z-ai/glm-4.7-flash-free` | ✓ | ✗ timeout | ✗ timeout | too slow to be usable |

45 000 ms means the 45 s probe ceiling, not a measurement.

### The two rejections that actually matter

**`nemotron-3-ultra-550b-a55b:free` answers 200 and says it cannot see the image.** Its recorded
response is a fluent refusal ("I cannot see any image attached") — the gateway drops the image parts
upstream of the model. A status-code-only health check passes it, and a user watching
`pdf-to-excel` would get a confident summary of a document the model never received. This is exactly
the class of failure the vision stage exists to catch; latency is irrelevant next to it.

**`laguna-s-2.1` and `lfm-2.5-2.6b` return wrong totals with no hedge.** Measured answers:
`5933.27 / 13393.64 / largest 245.67` and `6456.98 / 12500.00`, against `5883.34 / 13384.14 /
2000.00`. Both HTTP 200, both fluent, both arithmetically false. On a tool whose stated product
promise is that it *refuses to export a number it cannot re-derive*, these must never be a silent
substitute for a correct one.

### Two that passed but cannot go in the code map

`gemma-4-26b-a4b-it:free` is reached through a per-deployment connector id
(`openai-compatible-chat-945f5589-…`). Hardcoding it would put a machine-specific identifier in a
deployed Worker, and it would break for anyone who is not this exact OmniRoute install.

`kilo-auto` is a router alias — the concrete model behind the name is chosen per request, so a
"pass" here does not predict which model answers next time. Non-reproducible output is the wrong
property for a metered, plan-gated feature.

## The combo, and how it is wired

```
OMNIROUTE_BASE_URL = https://<tunnel>/v1        # unset ⇒ the paid chain, exactly as before
OMNIROUTE_TOOLS    = ocr,ocr-to-md,pdf-to-excel,pdf-to-word,compare,pdf-summary,pdf-qa,grammar-check
OMNIROUTE_API_KEY  = (not required by this gateway for chat)
```

Per tool, the gateway contributes **two** chain entries, so one dead free connection falls through to
a second free model before it reaches a paid key:

* image-bearing tools → `north-mini-code:free`, then `nemotron-3-super-120b-a12b:free`
  (the order of their measured vision latency: 5.5 s against 26.2 s)
* `grammar-check` (the one tool that sends no images) → the reverse order, leading with the model that
  answered the ledger fastest, 9.5 s against 11.2 s
* `redact` → **never routed to a chat model**, even when listed in `OMNIROUTE_TOOLS`. It runs against
  `nvidia/gliner-pii`, a named-entity model. A chat model guessing at PII spans is how a redaction
  silently misses one, and free tokens are not worth that trade. The refusal is asserted in
  `tests/omnirouteProviderChain.test.ts`, not left to configuration discipline.

Chain position: the free entries go **in front of** the paid providers, which remain as fallback.
That is what removes subscribers from the paid queue without removing the guarantee that a request
still succeeds when a free pool is spent — the measured `402` above is why `shouldTryNextProvider`
now treats 402 as retryable.

## Verified through the real Worker, not just the unit test

`scripts/feature-audit/omniroute-e2e-check.mjs` drives `/api/ai` on a throwaway `wrangler dev`
instance (port 8789) that holds **no paid provider keys**, so the free gateway is the only thing that
could possibly answer. A pro plan is seeded for a synthetic localtest subject, the meter is read back
afterwards, and the unlisted tool is checked separately. Output in `e2e-worker-probe.txt`:

```
PASS ocr: /api/ai answered 200 through the free gateway
PASS ocr: the answer came from a measured free model, not a paid provider
PASS ocr: the statement text actually came back          (2 929 ms wall clock)
PASS pdf-summary: 200 from the free gateway              (8 489 ms wall clock)
PASS meter: both gateway calls settled, no dangling PENDING
PASS gate: an unlisted tool has no provider here (502, not a silent 200)
```

The gateway echoes the **upstream** model id and strips the pool alias — the Worker requested
`kilocode/cohere/north-mini-code:free` and the response says `cohere/north-mini-code:free`. The probe
matches on the tail and says so in a comment, rather than asserting the catalogue id and failing
against a correct answer.

Wall clock varied by a factor of five between runs on the same model (2.9 s and 14.6 s for the same
`ocr` payload). Treat the latencies above as a floor and an ordering signal, not as a capacity model.

## What must be true before this serves production traffic

Cloudflare Workers cannot open a connection to a Tailnet address. The gateway was reachable for every
measurement in this file because the probe runs on a machine inside the tailnet; the deployed Worker
is not that machine. So:

1. **A public HTTPS tunnel in front of the gateway.** The code refuses a plaintext `http://` base URL
   outside `localtest`, because these request bodies carry document text and PII — the tailnet
   `http://…:20128` address is a localtest-only convenience, and `wrangler.toml` says so.
2. **The tunnel must not be a public open proxy.** A chat endpoint that accepts unauthenticated
   requests from anywhere is a billable one. `OMNIROUTE_API_KEY` exists for this.
3. **Free-pool rate limits are not a capacity plan.** `kilocode` free tiers are third-party quotas that
   the measured `402` proves can be exhausted. The paid fallback is what makes that survivable; it is
   not an optimisation.
4. **`AI_PROXY_ENABLED=false` still stops everything**, free gateway included — the switch is checked
   before authentication, before any reservation, and before the chain is built.
